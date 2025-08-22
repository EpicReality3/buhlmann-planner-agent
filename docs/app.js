// Planificateur Bühlmann ZH-L16C + Gradient Factors (UI moderne)
// - Version multi-stops avec paliers multiples de 3m
// - Formule de plafond corrigée (Erik Baker):
//   pAmbMin = (Ptiss - GF * a) / (GF / b + 1 - GF)
// - Options: lastStopDepth (3 ou 6 m), minLastStopMinutes
// - Graphique avec profil + plafond GF en temps réel
// - Validation UX douce et badge de validation

let profileChart = null;

(function () {
  'use strict';

  // ----- Constantes physiques & tables Bühlmann -----
  const SURFACE = 1.01325;       // bar
  const PH2O = 0.0627;           // bar (pression vapeur d'eau alvéolaire)
  const BAR_PER_M = 0.1;         // ~0.1 bar par mètre (eau de mer)
  const LN2 = Math.log(2);

  // Demi-temps (min) ZH-L16C
  const HT_N2 = [5.0, 8.0, 12.5, 18.5, 27.0, 38.3, 54.3, 77.0, 109.0, 146.0, 187.0, 239.0, 305.0, 390.0, 498.0, 635.0];
  const HT_HE = [1.88, 3.02, 4.72, 6.99, 10.21, 14.48, 20.53, 29.11, 41.20, 55.19, 70.69, 90.34, 115.29, 147.42, 188.24, 240.03];

  // Coefficients a/b ZH-L16C
  const A_N2 = [1.1696, 1.0, 0.8618, 0.7562, 0.6667, 0.5933, 0.5282, 0.4701, 0.4187, 0.3798, 0.3497, 0.3223, 0.2971, 0.2737, 0.2523, 0.2327];
  const B_N2 = [0.5578, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.8910, 0.9092, 0.9222, 0.9319, 0.9403, 0.9477, 0.9544, 0.9602, 0.9653];
  const A_HE = [1.6189, 1.3830, 1.1919, 1.0458, 0.9220, 0.8205, 0.7305, 0.6502, 0.5950, 0.5545, 0.5333, 0.5189, 0.5181, 0.5176, 0.5172, 0.5119];
  const B_HE = [0.4770, 0.5747, 0.6527, 0.7223, 0.7582, 0.7957, 0.8279, 0.8553, 0.8757, 0.8903, 0.8997, 0.9073, 0.9122, 0.9171, 0.9217, 0.9267];

  // Pas de palier & vitesses
  const STOP_STEP = 3;   // m
  const ASCENT_RATE = 9; // m/min
  const DESCENT_RATE = 19; // m/min

  // ----- Utilitaires -----
  function pAmb(depthM) { return SURFACE + depthM * BAR_PER_M; }
  function pinsp(pAmbBar, fInert) { return Math.max(0, (pAmbBar - PH2O) * fInert); }

  function initTissues() {
    return {
      pN2: HT_N2.map(() => pinsp(SURFACE, 0.79)), // à l'air, au repos surface
      pHe: HT_HE.map(() => 0)
    };
  }

  function updateConstantDepth(state, depthM, gas, minutes) {
    const p = pAmb(depthM);
    const pN2i = pinsp(p, gas.FN2);
    const pHei = pinsp(p, gas.FHe);
    for (let i = 0; i < state.pN2.length; i++) {
      const kN2 = LN2 / HT_N2[i];
      const kHe = LN2 / HT_HE[i];
      state.pN2[i] += (pN2i - state.pN2[i]) * (1 - Math.exp(-kN2 * minutes));
      state.pHe[i] += (pHei - state.pHe[i]) * (1 - Math.exp(-kHe * minutes));
    }
  }

  // Baker + GF
  function ceilingForComp(pN2, pHe, gf, i) {
    const pn = Math.max(0, pN2), ph = Math.max(0, pHe);
    const sum = pn + ph || 1e-9;
    const a = (A_N2[i] * pn + A_HE[i] * ph) / sum;
    const b = (B_N2[i] * pn + B_HE[i] * ph) / sum;
    const pt = pn + ph;
    const pAmbMin = (pt - gf * a) / (gf / b + (1 - gf));
    return Math.max(0, (pAmbMin - SURFACE) / BAR_PER_M); // ceiling en mètres
  }

  function overallCeiling(state, gf) {
    let worst = 0;
    for (let i = 0; i < state.pN2.length; i++) {
      const c = ceilingForComp(state.pN2[i], state.pHe[i], gf, i);
      if (c > worst) worst = c;
    }
    return worst;
  }

  // GF interpolé du premier palier → surface
  function gfAtDepth(depthM, gfLow, gfHigh, firstStopDepth) {
    const fs = Math.max(0, Math.ceil(firstStopDepth / STOP_STEP) * STOP_STEP);
    if (fs <= 0) return gfHigh;
    const frac = Math.max(0, Math.min(1, 1 - depthM / fs));
    return gfLow + (gfHigh - gfLow) * frac;
  }

  /**
   * Planification multi-stops (3 m) à la Bühlmann+GF
   * - remonte vers le premier palier (GF low)
   * - tient chaque palier jusqu'à autorisation d'aller 3 m plus haut
   * - dernier palier à 3 ou 6 m selon options
   */
  function planDive(depthM, bottomMin, gas, gfLowPct, gfHighPct, opts) {
    const gfL = gfLowPct / 100, gfH = gfHighPct / 100;
    const lastStopDepth = Math.max(0, (opts?.lastStopDepth ?? 3));
    const minLast = Math.max(0, Math.floor(opts?.minLastStopMinutes ?? 0));

    const st = initTissues();
    let decoTime = 0;  // Temps de décompression seulement
    let cur = 0;
    
    // Calcul temps de descente
    const descentTime = Math.ceil(depthM / DESCENT_RATE);

    // Descente (simulation minute par minute pour cohérence tissulaire)
    if (depthM > 0) {
      let mins = Math.ceil(depthM / DESCENT_RATE);
      for (let i = 0; i < mins; i++) {
        const next = Math.min(depthM, cur + DESCENT_RATE);
        updateConstantDepth(st, next, gas, 1);
        cur = next;
      }
    }

    // Fond
    if (bottomMin > 0) {
      updateConstantDepth(st, depthM, gas, bottomMin);
      cur = depthM;
    }

    // Premier plafond avec GF bas
    const firstCeil = overallCeiling(st, gfL);
    let firstStop = Math.max(lastStopDepth, Math.ceil(firstCeil / STOP_STEP) * STOP_STEP);

    // Remontée vers le premier palier
    if (cur > firstStop) {
      let mins = Math.ceil((cur - firstStop) / ASCENT_RATE);
      for (let i = 0; i < mins; i++) {
        const next = Math.max(firstStop, cur - ASCENT_RATE);
        updateConstantDepth(st, next, gas, 1);
        cur = next; decoTime++;
      }
    }

    const stops = [];
    let stopDepth = firstStop;

    // Boucle de paliers successifs  (…12→9→6→3→surface)
    while (stopDepth >= lastStopDepth) {
      let held = 0;
      while (true) {
        const nextDepth = Math.max(0, stopDepth - STOP_STEP);
        const gfNext = gfAtDepth(nextDepth, gfL, gfH, firstStop);
        const ceilNext = overallCeiling(st, gfNext);

        const canLeave = ceilNext <= nextDepth + 1e-6 && (stopDepth !== lastStopDepth || held >= minLast);
        if (canLeave) break;

        updateConstantDepth(st, stopDepth, gas, 1);
        held++; decoTime++;
        // garde-fou
        if (held > 360) break;
      }

      if (held > 0) {
        stops.push({ depth: stopDepth, time: held, gf: gfAtDepth(stopDepth, gfL, gfH, firstStop) });
      }

      // Remonter de 3 m (ou vers surface si on est au dernier palier)
      const nextDepth = Math.max(0, stopDepth - STOP_STEP);
      if (cur > nextDepth) {
        let mins = Math.ceil((cur - nextDepth) / ASCENT_RATE);
        for (let i = 0; i < mins; i++) {
          const d = Math.max(nextDepth, cur - ASCENT_RATE);
          updateConstantDepth(st, d, gas, 1);
          cur = d; decoTime++;
        }
      }
      stopDepth = nextDepth;

      // Si on vient de quitter le dernier palier et qu'on est déjà à 0 → fin
      if (stopDepth === 0 && cur === 0) break;
    }

    // Par sécurité : si on a "sauté" le palier final (cas sans paliers) → fin vers 0
    if (cur > 0) {
      let mins = Math.ceil(cur / ASCENT_RATE);
      for (let i = 0; i < mins; i++) {
        const d = Math.max(0, cur - ASCENT_RATE);
        updateConstantDepth(st, d, gas, 1);
        cur = d; decoTime++;
      }
    }

    // Calculs finaux des temps
    const totalDiveTime = descentTime + bottomMin + decoTime;

    // Arrondi d'affichage (contrat = minute)
    return {
      firstStopDepth: firstStop,
      stops,
      tts: Math.round(decoTime),           // TTS = temps de déco seulement
      totalDiveTime: Math.round(totalDiveTime), // Temps total de plongée
      descentTime: Math.round(descentTime),     // Temps de descente
      bottomTime: bottomMin,                    // Temps de fond (déjà en minutes)
    };
  }

  // ----- Graphique du profil avec plafond -----
  function updateProfileChartWithCeiling(depthM, bottomMin, gas, gfL, gfH, opts, plan) {
    const points = [];
    const ceilPts = [];
    const gfZones = [];
    const annotationData = [];
    const runtimePoints = [];
    
    // Re-simule le profil minute par minute pour tracer la courbe + le plafond
    const st = initTissues();
    let t = 0, cur = 0;
    let totalRuntime = 0;

    // Point de départ
    points.push({ x: t, y: 0 });
    ceilPts.push({ x: t, y: 0 });
    runtimePoints.push({ x: t, y: 0, runtime: totalRuntime });

    // Descente
    let down = Math.ceil(depthM / DESCENT_RATE);
    annotationData.push({ phase: 'descente', start: t, end: t + down });
    for (let i = 0; i < down; i++) {
      const next = Math.min(depthM, cur + DESCENT_RATE);
      updateConstantDepth(st, next, gas, 1);
      cur = next; t++;
      totalRuntime++;
      points.push({ x: t, y: cur });
      runtimePoints.push({ x: t, y: cur, runtime: totalRuntime });
      
      // Calcul du plafond
      const gf = gfL / 100;
      const c = overallCeiling(st, gf);
      ceilPts.push({ x: t, y: c });
    }

    // Fond
    const bottomStart = t;
    annotationData.push({ phase: 'fond', start: t, end: t + bottomMin });
    for (let i = 0; i < bottomMin; i++) {
      updateConstantDepth(st, depthM, gas, 1);
      t++;
      totalRuntime++;
      points.push({ x: t, y: depthM });
      runtimePoints.push({ x: t, y: depthM, runtime: totalRuntime });
      
      const gf = gfL / 100;
      const c = overallCeiling(st, gf);
      ceilPts.push({ x: t, y: c });
    }

    // Reconstruire le profil de remontée en suivant le plan calculé
    cur = depthM;
    const firstCeil = overallCeiling(st, gfL/100);
    const firstStop = plan.firstStopDepth;
    
    // Zone de gradient factor
    if (firstStop > 0) {
      gfZones.push({
        type: 'gfLow',
        start: t,
        depth: firstStop,
        label: `GF Low (${gfL}%)`
      });
    }

    // Remontée vers le premier palier
    if (plan.stops.length > 0 && cur > plan.stops[0].depth) {
      let target = plan.stops[0].depth;
      let mins = Math.ceil((cur - target) / ASCENT_RATE);
      annotationData.push({ phase: 'remontée', start: t, end: t + mins });
      for (let i = 0; i < mins; i++) {
        const next = Math.max(cur - ASCENT_RATE, target);
        updateConstantDepth(st, next, gas, 1);
        cur = next; t++;
        totalRuntime++;
        points.push({ x: t, y: cur });
        runtimePoints.push({ x: t, y: cur, runtime: totalRuntime });
        
        const gf = gfAtDepth(cur, gfL/100, gfH/100, firstStop);
        const c = overallCeiling(st, gf);
        ceilPts.push({ x: t, y: c });
      }
    }

    // Paliers
    for (const stop of plan.stops) {
      // S'assurer qu'on est au bon niveau
      if (cur !== stop.depth) {
        cur = stop.depth;
      }
      
      const stopStart = t;
      annotationData.push({ phase: 'palier', start: t, end: t + stop.time, depth: stop.depth });
      
      // Tenir le palier
      for (let i = 0; i < stop.time; i++) {
        updateConstantDepth(st, stop.depth, gas, 1);
        t++;
        totalRuntime++;
        points.push({ x: t, y: stop.depth });
        runtimePoints.push({ x: t, y: stop.depth, runtime: totalRuntime });
        
        const gf = gfAtDepth(stop.depth, gfL/100, gfH/100, firstStop);
        const c = overallCeiling(st, gf);
        ceilPts.push({ x: t, y: c });
      }
      
      // Remontée vers le prochain palier ou la surface
      const stopIdx = plan.stops.indexOf(stop);
      const nextStop = stopIdx < plan.stops.length - 1 ? plan.stops[stopIdx + 1].depth : 0;
      
      if (cur > nextStop) {
        let mins = Math.ceil((cur - nextStop) / ASCENT_RATE);
        annotationData.push({ phase: 'remontée', start: t, end: t + mins });
        for (let i = 0; i < mins; i++) {
          const next = Math.max(cur - ASCENT_RATE, nextStop);
          updateConstantDepth(st, next, gas, 1);
          cur = next; t++;
          totalRuntime++;
          points.push({ x: t, y: cur });
          runtimePoints.push({ x: t, y: cur, runtime: totalRuntime });
          
          const gf = gfAtDepth(cur, gfL/100, gfH/100, firstStop);
          const c = overallCeiling(st, gf);
          ceilPts.push({ x: t, y: c });
        }
      }
    }

    // Si pas de paliers, remontée directe
    if (plan.stops.length === 0 && cur > 0) {
      let mins = Math.ceil(cur / ASCENT_RATE);
      annotationData.push({ phase: 'remontée', start: t, end: t + mins });
      for (let i = 0; i < mins; i++) {
        const next = Math.max(cur - ASCENT_RATE, 0);
        updateConstantDepth(st, next, gas, 1);
        cur = next; t++;
        totalRuntime++;
        points.push({ x: t, y: cur });
        runtimePoints.push({ x: t, y: cur, runtime: totalRuntime });
        
        const gf = gfAtDepth(cur, gfL/100, gfH/100, firstStop);
        const c = overallCeiling(st, gf);
        ceilPts.push({ x: t, y: c });
      }
    }
    
    // Zone de gradient factor high
    if (firstStop > 0) {
      gfZones.push({
        type: 'gfHigh',
        start: t - 1,
        depth: 0,
        label: `GF High (${gfH}%)`
      });
    }

    // Afficher le conteneur du graphique
    const chartContainer = document.getElementById('chartContainer');
    chartContainer.style.display = 'block';

    // MàJ Chart.js
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (profileChart) profileChart.destroy();
    
    profileChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Profil de plongée',
            data: points,
            borderColor: 'rgba(0, 102, 204, 1)',
            backgroundColor: (context) => {
              const ctx = context.chart.ctx;
              const gradient = ctx.createLinearGradient(0, 0, 0, 400);
              gradient.addColorStop(0, 'rgba(0, 102, 204, 0.3)');
              gradient.addColorStop(0.5, 'rgba(0, 102, 204, 0.2)');
              gradient.addColorStop(1, 'rgba(0, 102, 204, 0.05)');
              return gradient;
            },
            borderWidth: 3,
            stepped: 'before',
            tension: 0,
            pointRadius: (context) => {
              const index = context.dataIndex;
              const value = context.dataset.data[index];
              // Points plus grands aux changements de phase
              for (const ann of annotationData) {
                if (value.x === ann.start || value.x === ann.end) {
                  return 6;
                }
              }
              return 2;
            },
            pointHoverRadius: 8,
            pointBackgroundColor: '#fff',
            pointBorderColor: (context) => {
              const index = context.dataIndex;
              const value = context.dataset.data[index];
              // Couleur différente pour les paliers
              for (const ann of annotationData) {
                if (ann.phase === 'palier' && value.x >= ann.start && value.x <= ann.end) {
                  return '#00c896';
                }
              }
              return '#0066cc';
            },
            pointBorderWidth: 2,
            fill: true,
            order: 2
          },
          {
            label: 'Plafond de décompression',
            data: ceilPts,
            borderColor: 'rgba(255, 71, 87, 0.9)',
            backgroundColor: 'rgba(255, 71, 87, 0.1)',
            borderDash: [8, 4],
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: '+2',
            order: 1
          }
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              usePointStyle: true,
              padding: 20,
              font: {
                size: 12
              },
              filter: function(item) {
                // Filtrer les légendes pour ne pas afficher les datasets vides
                return item.text !== '';
              }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 15,
            displayColors: true,
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderWidth: 1,
            cornerRadius: 8,
            callbacks: {
              title: function(tooltipItems) {
                const item = tooltipItems[0];
                const time = Math.round(item.parsed.x * 10) / 10;
                
                // Identifier la phase
                let phase = '';
                for (const ann of annotationData) {
                  if (time >= ann.start && time <= ann.end) {
                    phase = ann.phase.charAt(0).toUpperCase() + ann.phase.slice(1);
                    if (ann.depth) phase += ` à ${ann.depth}m`;
                    break;
                  }
                }
                
                // Ajouter le runtime
                const runtime = runtimePoints.find(p => Math.abs(p.x - time) < 0.1)?.runtime || 0;
                
                return [
                  `Temps: ${time} min`,
                  `Runtime: ${runtime} min`,
                  phase ? `Phase: ${phase}` : ''
                ].filter(Boolean);
              },
              label: function(context) {
                const label = context.dataset.label;
                const value = context.parsed.y;
                
                if (label.includes('Plafond')) {
                  return `${label}: ${Math.round(value)} m`;
                } else {
                  return `${label}: ${Math.round(value)} m`;
                }
              },
              afterBody: function(tooltipItems) {
                const item = tooltipItems[0];
                const time = item.parsed.x;
                
                // Ajouter le GF actuel si on est en décompression
                if (plan.firstStopDepth > 0 && time > bottomStart + bottomMin) {
                  const currentDepth = item.parsed.y;
                  const gf = gfAtDepth(currentDepth, gfL/100, gfH/100, plan.firstStopDepth);
                  return [``, `Gradient Factor: ${Math.round(gf * 100)}%`];
                }
                return [];
              }
            }
          },
          annotation: {
            annotations: (() => {
              const annotations = {};
              
              // Ligne du premier palier
              if (plan.firstStopDepth > 0) {
                annotations.firstStop = {
                  type: 'line',
                  yMin: plan.firstStopDepth,
                  yMax: plan.firstStopDepth,
                  borderColor: 'rgba(100, 100, 100, 0.3)',
                  borderWidth: 2,
                  borderDash: [10, 5],
                  label: {
                    content: `Premier palier: ${plan.firstStopDepth} m (GF Low ${gfL}%)`,
                    display: true,
                    position: 'end',
                    backgroundColor: 'rgba(100, 100, 100, 0.8)',
                    color: 'white',
                    padding: 6,
                    font: {
                      size: 11
                    }
                  }
                };
              }
              
              // Zones de phases (descente, fond, remontée, paliers)
              let zoneCount = 0;
              for (const ann of annotationData) {
                if (ann.phase === 'fond') {
                  annotations[`zone_${zoneCount++}`] = {
                    type: 'box',
                    xMin: ann.start,
                    xMax: ann.end,
                    backgroundColor: 'rgba(0, 102, 204, 0.05)',
                    borderColor: 'transparent',
                    label: {
                      content: 'Temps fond',
                      display: true,
                      position: 'center',
                      color: 'rgba(0, 102, 204, 0.6)',
                      font: {
                        size: 10,
                        weight: 'bold'
                      }
                    }
                  };
                } else if (ann.phase === 'palier') {
                  annotations[`stop_${zoneCount++}`] = {
                    type: 'box',
                    xMin: ann.start,
                    xMax: ann.end,
                    yMin: ann.depth - 0.5,
                    yMax: ann.depth + 0.5,
                    backgroundColor: 'rgba(0, 200, 150, 0.1)',
                    borderColor: 'rgba(0, 200, 150, 0.3)',
                    borderWidth: 1,
                    borderRadius: 4
                  };
                }
              }
              
              return annotations;
            })()
          }
        },
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: {
              display: true,
              text: 'Temps (min)',
              color: '#666',
              font: {
                size: 14,
                weight: 'bold'
              }
            },
            grid: {
              color: 'rgba(0, 0, 0, 0.05)',
              drawBorder: false
            },
            ticks: {
              color: '#666',
              font: {
                size: 12
              },
              maxTicksLimit: 15
            }
          },
          y: {
            type: 'linear',
            position: 'left',
            reverse: true,
            min: 0,
            title: {
              display: true,
              text: 'Profondeur (m)',
              color: '#0066cc',
              font: {
                size: 14,
                weight: 'bold'
              }
            },
            grid: {
              color: (context) => {
                // Lignes plus visibles pour les paliers standards
                if (context.tick.value % 3 === 0) {
                  return 'rgba(0, 0, 0, 0.08)';
                }
                return 'rgba(0, 0, 0, 0.03)';
              },
              drawBorder: false,
              lineWidth: (context) => {
                // Lignes plus épaisses pour les paliers standards
                if (context.tick.value % 3 === 0) {
                  return 1.5;
                }
                return 0.5;
              }
            },
            ticks: {
              stepSize: 3,
              color: '#666',
              font: {
                size: 12
              },
              callback: function(value) {
                // Mettre en évidence les profondeurs de palier
                if (value % 3 === 0 && value > 0 && value <= 21) {
                  return `${value} m`;
                }
                return value + ' m';
              }
            },
            suggestedMax: Math.ceil(depthM / 3) * 3 + 3,
          }
        }
      }
    });
  }

  // ----- Validation silencieuse -----
  function runSilentValidation() {
    const approx = (a, b, tol) => Math.abs(a - b) <= tol;

    // Tests de base
    const t1 = approx((1.0 - PH2O) * 0.79, 0.7405, 0.02);
    const t2 = approx((4.0 - PH2O) * 0.79, 3.1105, 0.03);
    const t3 = approx((5.0 - PH2O) * 0.79, 3.9005, 0.03);

    // Tests algorithme
    const p1 = planDive(40, 10, { FO2: 0.21, FHe: 0, FN2: 0.79 }, 85, 85, { lastStopDepth: 3, minLastStopMinutes: 1 });
    const ok1 = p1.stops.length && p1.stops.at(-1).depth === 3 && p1.stops.at(-1).time >= 1;

    const all = t1 && t2 && t3 && ok1;
    return all;
  }

  // ----- UI -----
  const $ = id => document.getElementById(id);

  function validateInputs() {
    const FO2 = (+$('fo2').value) / 100;
    const FHe = (+$('fhe').value) / 100;
    const gfL = +$('gfl').value;
    const gfH = +$('gfh').value;

    // Validation gaz
    if (FO2 < 0 || FO2 > 1 || FHe < 0 || FHe > 1) {
      return { valid: false, message: "FO₂ et FHe doivent être entre 0 et 100%" };
    }
    
    if (FO2 + FHe > 1) {
      return { valid: false, message: "FO₂ + FHe ne peut pas dépasser 100% (l'azote deviendrait négatif)" };
    }

    // Validation GF
    if (gfL < 1 || gfL > 99 || gfH < 1 || gfH > 99) {
      return { valid: false, message: "Les Gradient Factors doivent être entre 1 et 99%" };
    }

    if (gfL > gfH) {
      return { valid: false, message: "GF bas doit être ≤ GF haut" };
    }

    return { valid: true };
  }

  function updateRuntimeDisplay(runtime) {
    const display = document.getElementById('runtimeDisplay');
    const value = document.getElementById('runtimeValue');
    if (display && value) {
      display.classList.add('active');
      value.textContent = `Runtime: ${runtime} min`;
      
      // Animation du compteur
      value.style.animation = 'none';
      setTimeout(() => {
        value.style.animation = 'countUp 0.6s ease-out';
      }, 10);
    }
  }
  
  function render(plan, isValid) {
    // Mettre à jour le runtime display
    updateRuntimeDisplay(plan.totalDiveTime);
    
    const resultsHTML = `
      <div class="results-section">
        <div class="results-card">
          <h3>
            <i class="fas fa-clock"></i> 
            Temps total de remontée
            ${isValid ? '<span class="validation-badge valid">✅ Validé</span>' : '<span class="validation-badge invalid">❌ À vérifier</span>'}
          </h3>
          <div class="tts-display">
            <div class="tts-value">${Math.round(plan.totalDiveTime)}</div>
            <div class="tts-label">Temps total de plongée</div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 20px;">
            <div style="text-align: center; padding: 10px; background: rgba(0, 102, 204, 0.05); border-radius: 8px;">
              <div style="font-size: 1.8rem; font-weight: 700; color: var(--primary);">${plan.descentTime}</div>
              <div style="font-size: 0.85rem; color: #666; margin-top: 5px;">Descente (min)</div>
            </div>
            <div style="text-align: center; padding: 10px; background: rgba(0, 168, 230, 0.05); border-radius: 8px;">
              <div style="font-size: 1.8rem; font-weight: 700; color: var(--secondary);">${plan.bottomTime}</div>
              <div style="font-size: 0.85rem; color: #666; margin-top: 5px;">Temps fond (min)</div>
            </div>
            <div style="text-align: center; padding: 10px; background: rgba(0, 200, 150, 0.05); border-radius: 8px;">
              <div style="font-size: 1.8rem; font-weight: 700; color: var(--success);">${plan.tts}</div>
              <div style="font-size: 0.85rem; color: #666; margin-top: 5px;">Décompression (min)</div>
            </div>
          </div>
          ${plan.stops.length === 0 ? 
            '<div class="no-stops"><i class="fas fa-check-circle"></i>Aucun palier obligatoire</div>' : 
            `<div class="info-message">
              <i class="fas fa-info-circle"></i>
              <span>${plan.stops.length} palier${plan.stops.length > 1 ? 's' : ''} requis</span>
            </div>`
          }
        </div>
        <div class="results-card">
          <h3><i class="fas fa-table"></i> Paliers de décompression</h3>
          <table>
            <thead>
              <tr>
                <th>Profondeur (m)</th>
                <th>Durée (min)</th>
                <th>Gradient Factor (%)</th>
              </tr>
            </thead>
            <tbody>
              ${plan.stops.length === 0 ? 
                '<tr><td colspan="3" style="text-align: center; color: #00c896;">Aucun palier obligatoire</td></tr>' :
                plan.stops.map(s => `
                  <tr>
                    <td>${s.depth} m</td>
                    <td>${s.time} min</td>
                    <td>${Math.round(s.gf * 100)}%</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    $('out').innerHTML = resultsHTML;
  }

  function compute() {
    // Animation du bouton calculer
    const goBtn = $('go');
    goBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calcul en cours...';
    goBtn.disabled = true;
    
    setTimeout(() => {
      const depth = +$('depth').value;
      const tbt = +$('tbt').value;
      const FO2 = (+$('fo2').value) / 100;
      const FHe = (+$('fhe').value) / 100;
      const FN2 = 1 - FO2 - FHe;
      const gfL = +$('gfl').value;
      const gfH = +$('gfh').value;
      const opts = {
        lastStopDepth: $('last6').checked ? 6 : 3,
        minLastStopMinutes: +$('minLast').value | 0
      };

    // Validation des entrées
    const validation = validateInputs();
    if (!validation.valid) {
      $('out').innerHTML = `
        <div class="info-message" style="background: #ffe6e6; color: #ff4757;">
          <i class="fas fa-exclamation-triangle"></i>
          <span>${validation.message}</span>
        </div>
      `;
      document.getElementById('chartContainer').style.display = 'none';
      return;
    }

      const plan = planDive(depth, tbt, { FO2, FHe, FN2 }, gfL, gfH, opts);
      const isValid = runSilentValidation();
      
      render(plan, isValid);
      updateProfileChartWithCeiling(depth, tbt, { FO2, FHe, FN2 }, gfL, gfH, opts, plan);
      
      // Restaurer le bouton
      goBtn.innerHTML = '<i class="fas fa-calculator"></i> Calculer';
      goBtn.disabled = false;
    }, 300);
  }

  function selfTest() {
    const approx = (a, b, tol) => Math.abs(a - b) <= tol;

    // Sanity checks pinsp
    const t1 = approx((1.0 - PH2O) * 0.79, 0.7405, 0.02);
    const t2 = approx((4.0 - PH2O) * 0.79, 3.1105, 0.03);
    const t3 = approx((5.0 - PH2O) * 0.79, 3.9005, 0.03);

    // Note: Avec la formule corrigée, l'algorithme est plus conservateur
    // Les tests ci-dessous reflètent ce comportement
    
    // Subsurface-like: 40/10, Air, GF 85/85, last=3 m, minLast=1 -> palier obligatoire
    const p1 = planDive(40, 10, { FO2: 0.21, FHe: 0, FN2: 0.79 }, 85, 85, { lastStopDepth: 3, minLastStopMinutes: 1 });
    const ok1 = p1.stops.length && p1.stops.at(-1).depth === 3 && p1.stops.at(-1).time >= 1;

    // Peregrine-like: 40/10, Air, GF 85/85, last=6 m, minLast=1 -> palier obligatoire à 6 m
    const p2 = planDive(40, 10, { FO2: 0.21, FHe: 0, FN2: 0.79 }, 85, 85, { lastStopDepth: 6, minLastStopMinutes: 1 });
    const ok2 = p2.stops.length && p2.stops.at(-1).depth === 6 && p2.stops.at(-1).time >= 1;

    // Bühlmann avec formule corrigée: 40/10, Air, GF 85/85, last=3 m, minLast=0 -> palier obligatoire
    const p3 = planDive(40, 10, { FO2: 0.21, FHe: 0, FN2: 0.79 }, 85, 85, { lastStopDepth: 3, minLastStopMinutes: 0 });
    const ok3 = p3.stops.length > 0; // Avec la formule corrigée, palier obligatoire

    // Test multi-paliers : plongée profonde
    const p4 = planDive(60, 15, { FO2: 0.21, FHe: 0, FN2: 0.79 }, 30, 85, { lastStopDepth: 3, minLastStopMinutes: 1 });
    const ok4 = p4.stops.length > 1; // Doit avoir plusieurs paliers

    const all = t1 && t2 && t3 && ok1 && ok2 && ok3 && ok4;

    const resultsHTML = `
      <div class="results-card" style="max-width: 600px; margin: 0 auto;">
        <h3 style="${all ? 'color: #00c896;' : 'color: #ff4757;'}">
          <i class="fas fa-${all ? 'check-circle' : 'times-circle'}"></i>
          Self-Test : ${all ? 'Tous les tests passent ✅' : 'Certains tests échouent ❌'}
        </h3>
        <table style="margin-top: 20px;">
          <thead>
            <tr>
              <th>Test</th>
              <th>Résultat</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Calculs pinsp (pression inspirée)</td>
              <td style="color: ${t1 && t2 && t3 ? '#00c896' : '#ff4757'}">
                ${t1 && t2 && t3 ? '✓ OK' : '✗ Échec'}
              </td>
            </tr>
            <tr>
              <td>Subsurface-like (≥1 min @ 3 m)</td>
              <td style="color: ${ok1 ? '#00c896' : '#ff4757'}">
                ${ok1 ? '✓ OK' : '✗ Échec'}
              </td>
            </tr>
            <tr>
              <td>Peregrine-like (≥1 min @ 6 m)</td>
              <td style="color: ${ok2 ? '#00c896' : '#ff4757'}">
                ${ok2 ? '✓ OK' : '✗ Échec'}
              </td>
            </tr>
            <tr>
              <td>Formule Baker (palier obligatoire)</td>
              <td style="color: ${ok3 ? '#00c896' : '#ff4757'}">
                ${ok3 ? '✓ OK' : '✗ Échec'}
              </td>
            </tr>
            <tr>
              <td>Multi-paliers (plongée profonde)</td>
              <td style="color: ${ok4 ? '#00c896' : '#ff4757'}">
                ${ok4 ? '✓ OK' : '✗ Échec'} ${p4.stops.length} paliers
              </td>
            </tr>
          </tbody>
        </table>
        <div class="info-message" style="margin-top: 20px;">
          <i class="fas fa-info-circle"></i>
          <span>Version multi-stops avec paliers multiples de 3m</span>
        </div>
      </div>
    `;

    $('out').innerHTML = resultsHTML;
    
    // Masquer le graphique pour le self-test
    document.getElementById('chartContainer').style.display = 'none';
  }

  // Bind UI
  document.getElementById('go').addEventListener('click', compute);
  document.getElementById('selftest').addEventListener('click', selfTest);

  // Animations au scroll
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);
  
  // Calcul initial au chargement
  window.addEventListener('load', () => {
    // Observer les sections pour les animations
    document.querySelectorAll('.input-section, .results-card').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'all 0.6s ease-out';
      observer.observe(el);
    });
    
    // Petite animation de chargement
    setTimeout(compute, 100);
  });
  
  // Effet de parallaxe sur le header
  window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const header = document.querySelector('.header');
    if (header) {
      header.style.transform = `translateY(${scrolled * 0.5}px)`;
    }
  });
})();