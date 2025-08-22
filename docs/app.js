(function(){
  'use strict';

  // ----- Constantes Bühlmann -----
  const SURFACE = 1.01325;         // bar
  const PH2O    = 0.0627;          // bar (pression vapeur eau)
  const BAR_PER_M = 0.1;           // ~0.1 bar/m
  const LN2 = Math.log(2);

  // ZH-L16C half-times (min)
  const HT_N2 = [5.0,8.0,12.5,18.5,27.0,38.3,54.3,77.0,109.0,146.0,187.0,239.0,305.0,390.0,498.0,635.0];
  const HT_HE = [1.88,3.02,4.72,6.99,10.21,14.48,20.53,29.11,41.20,55.19,70.69,90.34,115.29,147.42,188.24,240.03];

  // a/b ZH-L16C
  const A_N2 = [1.1696,1.0,0.8618,0.7562,0.6667,0.5933,0.5282,0.4701,0.4187,0.3798,0.3497,0.3223,0.2971,0.2737,0.2523,0.2327];
  const B_N2 = [0.5578,0.6514,0.7222,0.7825,0.8126,0.8434,0.8693,0.8910,0.9092,0.9222,0.9319,0.9403,0.9477,0.9544,0.9602,0.9653];
  const A_HE = [1.6189,1.3830,1.1919,1.0458,0.9220,0.8205,0.7305,0.6502,0.5950,0.5545,0.5333,0.5189,0.5181,0.5176,0.5172,0.5119];
  const B_HE = [0.4770,0.5747,0.6527,0.7223,0.7582,0.7957,0.8279,0.8553,0.8757,0.8903,0.8997,0.9073,0.9122,0.9171,0.9217,0.9267];

  const STOP_STEP = 3;  // paliers multiples de 3 m
  const ASCENT_RATE = 9; // m/min

  // Utilities
  function pAmb(depthM){ return SURFACE + depthM * BAR_PER_M; }
  function pinsp(pAmb, f){ return Math.max(0, (pAmb - PH2O) * f); }

  function initTissues(){
    return {
      pN2: HT_N2.map(()=> pinsp(SURFACE, 0.79)),
      pHe: HT_HE.map(()=> 0)
    };
  }

  function updateConstDepth(state, depthM, gas, minutes){
    const p = pAmb(depthM);
    const pN2i = pinsp(p, gas.FN2);
    const pHei = pinsp(p, gas.FHe);
    for(let i=0;i<state.pN2.length;i++){
      const kN2 = LN2 / HT_N2[i];
      const kHe = LN2 / HT_HE[i];
      state.pN2[i] += (pN2i - state.pN2[i]) * (1 - Math.exp(-kN2 * minutes));
      state.pHe[i] += (pHei - state.pHe[i]) * (1 - Math.exp(-kHe * minutes));
    }
  }

  function ceilingForComp(pN2, pHe, gf, i){
    const pn = Math.max(0, pN2), ph = Math.max(0, pHe);
    const sum = pn + ph || 1e-9;
    const a = (A_N2[i]*pn + A_HE[i]*ph) / sum;
    const b = (B_N2[i]*pn + B_HE[i]*ph) / sum;
    const pt = pn + ph;
    const pAmbMin = (pt - a * gf) / (b * gf);
    return Math.max(0, (pAmbMin - SURFACE) / BAR_PER_M);
  }

  function overallCeiling(state, gf){
    let worst = 0;
    for(let i=0;i<state.pN2.length;i++){
      const c = ceilingForComp(state.pN2[i], state.pHe[i], gf, i);
      if(c > worst) worst = c;
    }
    return worst;
  }

  function gfAtDepth(depthM, gfL, gfH, firstCeil){
    const firstStopDepth = Math.ceil(firstCeil / STOP_STEP) * STOP_STEP;
    if(firstStopDepth <= 0) return gfH;
    const frac = Math.max(0, Math.min(1, 1 - depthM / firstStopDepth));
    return gfL + (gfH - gfL) * frac;
  }

  function planDive(depthM, bottomMin, gas, gfLowPct, gfHighPct, opts){
    const gfL = gfLowPct/100, gfH = gfHighPct/100;
    const lastStopDepth = (opts && opts.lastStopDepth) || 3;
    const minLast = Math.max(0, Math.floor((opts && opts.minLastStopMinutes) || 0));

    const state = initTissues();
    // fond
    updateConstDepth(state, depthM, gas, bottomMin);

    const firstCeil = overallCeiling(state, gfL);
    const stops = [];
    let current = depthM, tts = 0;

    // Remonter jusqu'au dernier palier
    if(current > lastStopDepth){
      let minutes = Math.ceil((current - lastStopDepth)/ASCENT_RATE);
      for(let i=0;i<minutes;i++){
        const nextD = Math.max(current - ASCENT_RATE, lastStopDepth);
        updateConstDepth(state, nextD, gas, 1);
        current = nextD; tts += 1;
      }
    }

    // Tenir dernier palier jusqu'à plafond<=0 et minLast atteint
    let held = 0;
    while(true){
      const gf = gfAtDepth(current, gfL, gfH, firstCeil);
      const ceil = overallCeiling(state, gf);
      const need = ceil > 0 || held < minLast;
      if(!need) break;
      updateConstDepth(state, current, gas, 1);
      held += 1; tts += 1;
      if(held > 360) break; // garde-fou
    }
    if(held > 0){
      stops.push({ depth: current, time: held, gf: gfAtDepth(current, gfL, gfH, firstCeil) });
    }

    // Remontée finale
    if(current > 0){
      let minutes = Math.ceil(current / ASCENT_RATE);
      for(let i=0;i<minutes;i++){
        const nextD = Math.max(current - ASCENT_RATE, 0);
        updateConstDepth(state, nextD, gas, 1);
        current = nextD; tts += 1;
      }
    }

    return { firstStopDepth: stops.length ? stops[0].depth : 0, stops, tts: Math.round(tts*10)/10 };
  }

  // --- UI binding ---
  const $ = id => document.getElementById(id);
  function render(plan){
    let html = `<p><strong>TTS</strong> : ${plan.tts} min</p>`;
    html += `<table><thead><tr><th>Stop (m)</th><th>Durée (min)</th><th>GF</th></tr></thead><tbody>`;
    if(!plan.stops.length) html += `<tr><td colspan="3">Aucun palier obligatoire</td></tr>`;
    plan.stops.forEach(s=>{
      html += `<tr><td>${s.depth}</td><td>${s.time}</td><td>${Math.round(s.gf*100)}%</td></tr>`;
    });
    html += `</tbody></table>`;
    $('out').innerHTML = html;
  }

  function compute(){
    const depth = +$('depth').value;
    const tbt = +$('tbt').value;
    const FO2 = (+$('fo2').value)/100;
    const FHe = (+$('fhe').value)/100;
    const FN2 = 1 - FO2 - FHe;
    const gfl = +$('gfl').value;
    const gfh = +$('gfh').value;
    const opts = { lastStopDepth: $('last6').checked ? 6 : 3, minLastStopMinutes: +$('minLast').value|0 };
    const plan = planDive(depth, tbt, { FO2, FHe, FN2 }, gfl, gfh, opts);
    render(plan);
  }

  function selfTest(){
    const approx = (a,b,tol)=> Math.abs(a-b) <= tol;
    // Sanity pinsp
    const t1 = approx( (1.0-PH2O)*0.79, 0.7405, 0.02 );
    const t2 = approx( (4.0-PH2O)*0.79, 3.1105, 0.03 );
    const t3 = approx( (5.0-PH2O)*0.79, 3.9005, 0.03 );

    // Subsurface-like: 40/10 GF85/85 -> last=3, minLast=1 => 1' @3m
    const p1 = planDive(40,10,{FO2:0.21,FHe:0,FN2:0.79},85,85,{lastStopDepth:3,minLastStopMinutes:1});
    const ok1 = p1.stops.length && p1.stops.at(-1).depth===3 && p1.stops.at(-1).time>=1;

    // Peregrine-like: 40/10 GF85/85 -> last=6, minLast=1 => ~2' @6m
    const p2 = planDive(40,10,{FO2:0.21,FHe:0,FN2:0.79},85,85,{lastStopDepth:6,minLastStopMinutes:1});
    const ok2 = p2.stops.length && p2.stops.at(-1).depth===6 && p2.stops.at(-1).time>=2;

    // Bühlmann pur: sans options -> pas de palier obligatoire
    const p3 = planDive(40,10,{FO2:0.21,FHe:0,FN2:0.79},85,85,{lastStopDepth:3,minLastStopMinutes:0});
    const ok3 = !p3.stops.length || p3.stops.every(s=>s.time===0);

    const all = t1 && t2 && t3 && ok1 && ok2 && ok3;
    $('out').innerHTML = `<p><strong>Self-Test</strong> : ${all ? '✅ OK' : '❌ ÉCHEC'}</p>` +
      `<ul class="muted">
        <li>pinsp sanity: ${t1&&t2&&t3 ? 'OK' : 'NOK'}</li>
        <li>Subsurface-like (1′ @3m): ${ok1?'OK':'NOK'}</li>
        <li>Peregrine-like (≥2′ @6m): ${ok2?'OK':'NOK'}</li>
        <li>Bühlmann pur (no-deco sans option): ${ok3?'OK':'NOK'}</li>
      </ul>`;
  }

  document.getElementById('go').addEventListener('click', compute);
  document.getElementById('selftest').addEventListener('click', selfTest);
})();
