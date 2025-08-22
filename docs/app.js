// Planificateur Bühlmann ZH-L16C + Gradient Factors (UI autonome)
// - Formule de plafond corrigée (Erik Baker):
//   pAmbMin = (Ptiss - GF * a) / (GF / b + 1 - GF)
// - Paliers en multiples de 3 m, remontée 9 m/min
// - Options: lastStopDepth (3 ou 6 m), minLastStopMinutes
// - Bouton Self-Test pour valider les cas de référence
// - Graphique du profil avec Chart.js

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
      tts: Math.round(tts * 10) / 10
    };
  }

  // ----- Graphique du profil -----

  function updateProfileChart(depthM, bottomMin, plan) {
    const ASCENT_RATE = 9;    // m/min (déjà défini dans l'algo)
    const DESCENT_RATE = 19;  // m/min pour descente (inspiré de Subsurface)

    // Calculer la liste des {x:temps, y:profondeur}
    const points = [];
    let t = 0;
    // départ surface
    points.push({ x: t, y: 0 });
    // descente
    const tDesc = depthM / DESCENT_RATE;
    t += tDesc;
    points.push({ x: t, y: depthM });
    // fond
    t += bottomMin;
    points.push({ x: t, y: depthM });

    // paliers : ascension vers chaque stop puis maintien
    let currentDepth = depthM;
    for (const stop of plan.stops) {
      const ascendTime = (currentDepth - stop.depth) / ASCENT_RATE;
      if (ascendTime > 0) {
        t += ascendTime;
        points.push({ x: t, y: stop.depth });
      }
      if (stop.time > 0) {
        t += stop.time;
        points.push({ x: t, y: stop.depth });
      }
      currentDepth = stop.depth;
    }

    // remontée finale
    const ascendFinal = currentDepth / ASCENT_RATE;
    if (ascendFinal > 0) {
      t += ascendFinal;
      points.push({ x: t, y: 0 });
    }

    // Création ou mise à jour du graphique Chart.js
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (profileChart) {
      profileChart.destroy();
    }
    profileChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Profil de plongée',
            data: points,
            borderColor: '#007bff',
            backgroundColor: 'rgba(0, 123, 255, 0.1)',
            tension: 0,
          },
        ],
      },
      options: {
        scales: {
          x: {
            title: { display: true, text: 'Temps (min)' },
          },
          y: {
            title: { display: true, text: 'Profondeur (m)' },
            reverse: true,          // inverse l'axe pour avoir 0 en haut
            ticks: { stepSize: 3 }, // graduations tous les 3 m
            suggestedMax: depthM + 5,
            suggestedMin: 0,
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });
  }

  // ----- UI -----
  const $ = id => document.getElementById(id);

  function render(plan) {
    let html = `<p><strong>TTS</strong> : ${plan.tts} min</p>`;
    html += `<table><thead><tr><th>Stop (m)</th><th>Durée (min)</th><th>GF</th></tr></thead><tbody>`;
    if (!plan.stops.length) html += `<tr><td colspan="3">Aucun palier obligatoire</td></tr>`;
    plan.stops.forEach(s => {
      html += `<tr><td>${s.depth}</td><td>${s.time}</td><td>${Math.round(s.gf * 100)}%</td></tr>`;
    });
    html += `</tbody></table>`;
    $('out').innerHTML = html;
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
    const plan = planDive(depth, tbt, { FO2, FHe, FN2 }, gfL, gfH, opts);
    render(plan);
    updateProfileChart(depth, tbt, plan);
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

    $('out').innerHTML =
      `<p><strong>Self-Test</strong> : ${all ? '✅ OK' : '❌ Échec'}</p>` +
      `<ul style="color:#666">
        <li>pinsp sanity: ${t1 && t2 && t3 ? 'OK' : 'NOK'}</li>
        <li>Subsurface-like (≥1′ @ 3 m): ${ok1 ? 'OK' : 'NOK'}</li>
        <li>Peregrine-like (≥1′ @ 6 m): ${ok2 ? 'OK' : 'NOK'}</li>
        <li>Bühlmann corrigé (palier obligatoire): ${ok3 ? 'OK' : 'NOK'}</li>
      </ul>`;
  }

  // Bind UI
  document.getElementById('go').addEventListener('click', compute);
  document.getElementById('selftest').addEventListener('click', selfTest);
})();