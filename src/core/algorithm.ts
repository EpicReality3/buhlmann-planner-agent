import { A_HE, A_N2, B_HE, B_N2, HALF_TIMES_N2, HALF_TIMES_HE } from './constants';
import { GasMix, TissueState, DecompressionStop, DecompressionPlan } from './models';
import { depthToPressure, computePinsp } from './utils';

// --- constantes & helpers ---
const SURFACE = 1.01325;
const PH2O = 0.0627;
const BAR_PER_M = 0.1;
const LN2 = Math.log(2);

const STOP_STEP = 3;     // paliers multiples de 3 m
const ASCENT_RATE = 9;   // m/min (remontée)
const DESCENT_RATE = 19; // m/min (descente)

function pAmb(depthM: number) { return SURFACE + depthM * BAR_PER_M; }
function pinsp(pAmbBar: number, fInert: number) { return Math.max(0, (pAmbBar - PH2O) * fInert); }

function initTissues(): TissueState {
  return {
    pN2: HALF_TIMES_N2.map(() => pinsp(SURFACE, 0.79)),
    pHe: HALF_TIMES_HE.map(() => 0),
  };
}

function updateConstantDepth(state: TissueState, depthM: number, gas: GasMix, minutes: number) {
  const p = pAmb(depthM);
  const pN2i = pinsp(p, gas.FN2);
  const pHei = pinsp(p, gas.FHe);
  for (let i = 0; i < state.pN2.length; i++) {
    const kN2 = LN2 / HALF_TIMES_N2[i];
    const kHe = LN2 / HALF_TIMES_HE[i];
    state.pN2[i] += (pN2i - state.pN2[i]) * (1 - Math.exp(-kN2 * minutes));
    state.pHe[i] += (pHei - state.pHe[i]) * (1 - Math.exp(-kHe * minutes));
  }
}

/**
 * Calcule le plafond pour un compartiment tissulaire donné
 * Utilise la formule d'Erik Baker pour les Gradient Factors :
 * pAmbMin = (Ptiss - GF * a) / (GF / b + 1 - GF)
 * 
 * Référence: Erik Baker - "Clearing Up The Confusion About Deep Stops"
 */
function ceilingForComp(pN2: number, pHe: number, gf: number, i: number) {
  const pn = Math.max(0, pN2), ph = Math.max(0, pHe);
  const sum = pn + ph || 1e-9;
  const a = (A_N2[i] * pn + A_HE[i] * ph) / sum;
  const b = (B_N2[i] * pn + B_HE[i] * ph) / sum;
  const pt = pn + ph;
  const pAmbMin = (pt - gf * a) / (gf / b + (1 - gf));
  return Math.max(0, (pAmbMin - SURFACE) / BAR_PER_M); // ceiling en mètres
}

function overallCeiling(state: TissueState, gf: number) {
  let worst = 0;
  for (let i = 0; i < state.pN2.length; i++) {
    const c = ceilingForComp(state.pN2[i], state.pHe[i], gf, i);
    if (c > worst) worst = c;
  }
  return worst;
}

// GF interpolé du premier palier → surface
function gfAtDepth(depthM: number, gfLow: number, gfHigh: number, firstStopDepth: number) {
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
export function planDecompression(
  depthM: number, bottomMin: number, gas: GasMix,
  gfLow: number, gfHigh: number,
  opts?: { lastStopDepth?: number; minLastStopMinutes?: number }
): DecompressionPlan {
  const lastStopDepth = Math.max(0, (opts?.lastStopDepth ?? 3));
  const minLast = Math.max(0, Math.floor(opts?.minLastStopMinutes ?? 0));

  const st = initTissues();
  let tts = 0;
  let cur = 0;

  // Descente (simulation minute par minute pour cohérence tissulaire)
  if (depthM > 0) {
    let mins = Math.ceil(depthM / DESCENT_RATE);
    for (let i = 0; i < mins; i++) {
      const next = Math.min(depthM, cur + DESCENT_RATE);
      updateConstantDepth(st, next, gas, 1);
      cur = next; tts++;
    }
  }

  // Fond
  if (bottomMin > 0) {
    updateConstantDepth(st, depthM, gas, bottomMin);
    cur = depthM; tts += bottomMin;
  }

  // Premier plafond avec GF bas
  const firstCeil = overallCeiling(st, gfLow);
  let firstStop = Math.max(lastStopDepth, Math.ceil(firstCeil / STOP_STEP) * STOP_STEP);

  // Remontée vers le premier palier
  if (cur > firstStop) {
    let mins = Math.ceil((cur - firstStop) / ASCENT_RATE);
    for (let i = 0; i < mins; i++) {
      const next = Math.max(firstStop, cur - ASCENT_RATE);
      updateConstantDepth(st, next, gas, 1);
      cur = next; tts++;
    }
  }

  const stops: DecompressionStop[] = [];
  let stopDepth = firstStop;

  // Boucle de paliers successifs  (…12→9→6→3→surface)
  while (stopDepth >= lastStopDepth) {
    let held = 0;
    while (true) {
      const nextDepth = Math.max(0, stopDepth - STOP_STEP);
      const gfNext = gfAtDepth(nextDepth, gfLow, gfHigh, firstStop);
      const ceilNext = overallCeiling(st, gfNext);

      const canLeave = ceilNext <= nextDepth + 1e-6 && (stopDepth !== lastStopDepth || held >= minLast);
      if (canLeave) break;

      updateConstantDepth(st, stopDepth, gas, 1);
      held++; tts++;
      // garde-fou
      if (held > 360) break;
    }

    if (held > 0) {
      stops.push({ depth: stopDepth, time: held, gf: gfAtDepth(stopDepth, gfLow, gfHigh, firstStop) });
    }

    // Remonter de 3 m (ou vers surface si on est au dernier palier)
    const nextDepth = Math.max(0, stopDepth - STOP_STEP);
    if (cur > nextDepth) {
      let mins = Math.ceil((cur - nextDepth) / ASCENT_RATE);
      for (let i = 0; i < mins; i++) {
        const d = Math.max(nextDepth, cur - ASCENT_RATE);
        updateConstantDepth(st, d, gas, 1);
        cur = d; tts++;
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
      cur = d; tts++;
    }
  }

  // Arrondi d'affichage (contrat = minute)
  return {
    firstStopDepth: firstStop,
    stops,
    tts: Math.round(tts), // affichage entier
  };
}