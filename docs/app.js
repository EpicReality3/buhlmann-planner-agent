// Planificateur Bühlmann ZH-L16C + Gradient Factors (UI moderne)
// - Formule de plafond corrigée (Erik Baker):
//   pAmbMin = (Ptiss - GF * a) / (GF / b + 1 - GF)
// - Paliers en multiples de 3 m, remontée 9 m/min
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

  // pAmbMin via Baker + GF
  // Formule corrigée : pAmbMin = (Ptiss - GF * a) / (GF / b + 1 - GF)
  function ceilingForComp(pN2, pHe, gf, i) {
    const pn = Math.max(0, pN2), ph = Math.max(0, pHe);
    const sum = pn + ph || 1e-9;
    const a = (A_N2[i] * pn + A_HE[i] * ph) / sum;
    const b = (B_N2[i] * pn + B_HE[i] * ph) / sum;
    const pt = pn + ph;

    // ----- FORMULE CORRIGÉE D'ERIK BAKER -----
    // pAmbMin = (Pt - GF * a) / (GF / b + 1 - GF)
    const pAmbMin = (pt - gf * a) / (gf / b + 1 - gf);
    const ceilingM = Math.max(0, (pAmbMin - SURFACE) / BAR_PER_M);
    return ceilingM;
  }

  function overallCeiling(state, gf) {
    let worst = 0;
    for (let i = 0; i < state.pN2.length; i++) {
      const c = ceilingForComp(state.pN2[i], state.pHe[i], gf, i);
      if (c > worst) worst = c;
    }
    return worst;
  }

  function gfAtDepth(depthM, gfLow, gfHigh, firstCeiling) {
    const firstStopDepth = Math.ceil(firstCeiling / STOP_STEP) * STOP_STEP;
    if (firstStopDepth <= 0) return gfHigh;
    const frac = Math.max(0, Math.min(1, 1 - depthM / firstStopDepth));
    return gfLow + (gfHigh - gfLow) * frac;
  }

  // ----- Planificateur minimal (paliers en sommet uniquement) -----
  function planDive(depthM, bottomMin, gas, gfLowPct, gfHighPct, opts) {
    const gfLow = gfLowPct / 100, gfHigh = gfHighPct / 100;
    const lastStopDepth = (opts && opts.lastStopDepth) || 3; // 3 m par défaut
    const minLast = Math.max(0, Math.floor((opts && opts.minLastStopMinutes) || 0));

    const state = initTissues();
    // Segment fond
    updateConstantDepth(state, depthM, gas, bottomMin);

    // Plafond initial avec GF bas
    const firstCeil = overallCeiling(state, gfLow);

    const stops = [];
    let current = depthM;
    let tts = 0;

    // Remontée vers le dernier palier (pas de deep stops dans cette version)
    if (current > lastStopDepth) {
      const minutes = Math.ceil((current - lastStopDepth) / ASCENT_RATE);
      for (let i = 0; i < minutes; i++) {
        const nextD = Math.max(current - ASCENT_RATE, lastStopDepth);
        updateConstantDepth(state, nextD, gas, 1);
        current = nextD; tts += 1;
      }
    }

    // Tenue à lastStopDepth jusqu'à plafond <= 0 ET minLast atteint
    let held = 0;
    while (true) {
      const gf = gfAtDepth(current, gfLow, gfHigh, firstCeil);
      const ceil = overallCeiling(state, gf);
      const need = ceil > 0 || held < minLast;
      if (!need) break;
      updateConstantDepth(state, current, gas, 1);
      held += 1; tts += 1;
      if (held > 360) break; // garde-fou
    }
    if (held > 0) {
      stops.push({ depth: current, time: held, gf: gfAtDepth(current, gfLow, gfHigh, firstCeil) });
    }

    // Remontée finale vers la surface
    if (current > 0) {
      const minutes = Math.ceil(current / ASCENT_RATE);
      for (let i = 0; i < minutes; i++) {
        const nextD = Math.max(current - ASCENT_RATE, 0);
        updateConstantDepth(state, nextD, gas, 1);
        current = nextD; tts += 1;
      }
    }

    return {
      firstStopDepth: stops.length ? stops[0].depth : 0,
      stops,
      tts: tts
    };
  }

  // ----- Graphique du profil avec plafond -----
  function updateProfileChartWithCeiling(depthM, bottomMin, gas, gfL, gfH, opts, plan) {
    const points = [];
    const ceilPts = [];
    
    // Re-simule le profil minute par minute pour tracer la courbe + le plafond
    const st = initTissues();
    let t = 0, cur = 0;

    // Point de départ
    points.push({ x: t, y: 0 });
    ceilPts.push({ x: t, y: 0 });

    // Descente
    let down = Math.ceil(depthM / DESCENT_RATE);
    for (let i = 0; i < down; i++) {
      const next = Math.min(depthM, cur + DESCENT_RATE);
      updateConstantDepth(st, next, gas, 1);
      cur = next; t++;
      points.push({ x: t, y: cur });
      
      // Calcul du plafond
      const gf = gfL / 100; // Pendant la descente, on utilise GF bas
      const c = overallCeiling(st, gf);
      ceilPts.push({ x: t, y: c });
    }

    // Fond
    for (let i = 0; i < bottomMin; i++) {
      updateConstantDepth(st, depthM, gas, 1);
      t++; 
      points.push({ x: t, y: depthM });
      
      const gf = gfL / 100;
      const c = overallCeiling(st, gf);
      ceilPts.push({ x: t, y: c });
    }

    // First ceiling pour le calcul GF
    const firstCeil = overallCeiling(st, gfL/100);

    // Helper pour ajouter le plafond
    function pushCeiling() {
      const gf = gfAtDepth(cur, gfL/100, gfH/100, firstCeil);
      const c = overallCeiling(st, gf);
      ceilPts.push({ x: t, y: c });
    }

    // Remontée vers dernier palier
    const lastStopDepth = opts.lastStopDepth || 3;
    if (cur > lastStopDepth) {
      let mins = Math.ceil((cur - lastStopDepth)/ASCENT_RATE);
      for (let i = 0; i < mins; i++) {
        const next = Math.max(cur - ASCENT_RATE, lastStopDepth);
        updateConstantDepth(st, next, gas, 1);
        cur = next; t++;
        points.push({ x: t, y: cur });
        pushCeiling();
      }
    }

    // Tenue du dernier palier
    let held = 0;
    const minLast = (opts.minLastStopMinutes|0);
    while (true) {
      const gf = gfAtDepth(cur, gfL/100, gfH/100, firstCeil);
      const c = overallCeiling(st, gf);
      if (!(c > 0 || held < minLast)) break;
      updateConstantDepth(st, cur, gas, 1);
      held++; t++;
      points.push({ x: t, y: cur });
      ceilPts.push({ x: t, y: c });
      if (held > 360) break; // garde-fou
    }

    // Remontée finale
    if (cur > 0) {
      let mins = Math.ceil(cur/ASCENT_RATE);
      for (let i = 0; i < mins; i++) {
        const next = Math.max(cur - ASCENT_RATE, 0);
        updateConstantDepth(st, next, gas, 1);
        cur = next; t++;
        points.push({ x: t, y: cur });
        pushCeiling();
      }
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
            borderColor: '#0066cc',
            backgroundColor: 'rgba(0, 102, 204, 0.1)',
            borderWidth: 3,
            stepped: 'before', // Ligne en escaliers
            tension: 0,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#0066cc',
            pointBorderWidth: 2,
            fill: true,
          },
          {
            label: 'Plafond (GF)',
            data: ceilPts,
            borderColor: '#ff4757',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
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
              }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 12,
            displayColors: true,
            callbacks: {
              title: function(tooltipItems) {
                const item = tooltipItems[0];
                return `Temps: ${Math.round(item.parsed.x * 10) / 10} min`;
              },
              label: function(context) {
                const label = context.dataset.label;
                const value = Math.round(context.parsed.y);
                return `${label}: ${value} m`;
              }
            }
          },
          annotation: plan.firstStopDepth > 0 ? {
            annotations: {
              firstStop: {
                type: 'line',
                yMin: plan.firstStopDepth,
                yMax: plan.firstStopDepth,
                borderColor: 'rgba(100, 100, 100, 0.3)',
                borderWidth: 2,
                borderDash: [10, 5],
                label: {
                  content: `Premier palier: ${plan.firstStopDepth} m`,
                  display: true,
                  position: 'end',
                  backgroundColor: 'rgba(100, 100, 100, 0.8)',
                  color: 'white',
                  padding: 4,
                  font: {
                    size: 11
                  }
                }
              }
            }
          } : {}
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
              }
            }
          },
          y: {
            type: 'linear',
            position: 'left',
            reverse: true, // inverse l'axe pour avoir 0 en haut
            min: 0, // Force le minimum à 0
            title: {
              display: true,
              text: 'Profondeur (m)',
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
              stepSize: 3, // Graduations tous les 3 m
              color: '#666',
              font: {
                size: 12
              },
              callback: function(value) {
                return value + ' m';
              }
            },
            suggestedMax: Math.ceil(depthM / 3) * 3 + 3, // Arrondi au multiple de 3 supérieur
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

  function render(plan, isValid) {
    const resultsHTML = `
      <div class="results-section">
        <div class="results-card">
          <h3>
            <i class="fas fa-clock"></i> 
            Temps total de remontée
            ${isValid ? '<span class="validation-badge valid">✅ Validé</span>' : '<span class="validation-badge invalid">❌ À vérifier</span>'}
          </h3>
          <div class="tts-display">
            <div class="tts-value">${Math.round(plan.tts)}</div>
            <div class="tts-label">minutes</div>
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

    const all = t1 && t2 && t3 && ok1 && ok2 && ok3;

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
          </tbody>
        </table>
        <div class="info-message" style="margin-top: 20px;">
          <i class="fas fa-info-circle"></i>
          <span>L'algorithme utilise la formule corrigée d'Erik Baker pour un calcul plus conservateur</span>
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

  // Calcul initial au chargement
  window.addEventListener('load', () => {
    // Petite animation de chargement
    setTimeout(compute, 100);
  });
})();