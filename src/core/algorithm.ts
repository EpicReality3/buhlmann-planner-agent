import { A_HE, A_N2, B_HE, B_N2, HALF_TIMES_N2, HALF_TIMES_HE, 
         SURFACE_PRESSURE, PRESSURE_PER_METER } from './constants';
import { GasMix, TissueState, DecompressionStop, DecompressionPlan, MultiGasPlan } from './models';
import { depthToPressure, computePinsp, initTissues, updateConstantDepth } from './utils';
import { calculateOxygenToxicity } from './oxygen-toxicity';
import { getBestGasForDepth, validateMultiGasPlan } from './multi-gas';

/**
 * Constantes de décompression
 * Référence: Tables de plongée standard et pratiques de la communauté technique
 */
const STOP_STEP = 3;     // Paliers multiples de 3 m (standard industrie)
const ASCENT_RATE = 9;   // m/min (remontée - recommandation PADI/SSI)
const DESCENT_RATE = 19; // m/min (descente - valeur conservatrice)

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
  return Math.max(0, (pAmbMin - SURFACE_PRESSURE) / PRESSURE_PER_METER); // ceiling en mètres
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
  opts?: { 
    lastStopDepth?: number; 
    minLastStopMinutes?: number;
    timeStepMinutes?: number;  // Pas de temps en minutes (0.5 = 30s, 0.167 = 10s)
    calculateO2Toxicity?: boolean;  // Activer le calcul de toxicité O₂
  }
): DecompressionPlan {
  const lastStopDepth = Math.max(0, (opts?.lastStopDepth ?? 3));
  const minLast = Math.max(0, Math.floor(opts?.minLastStopMinutes ?? 0));
  const timeStep = opts?.timeStepMinutes ?? 0.5;  // Par défaut 30 secondes pour meilleure précision
  const calculateO2 = opts?.calculateO2Toxicity ?? false;

  const st = initTissues();
  let descentTime = 0;
  let decoTime = 0;  // TTS réel (décompression seulement)
  let cur = 0;
  
  // Segments pour calcul toxicité O₂
  const o2Segments: Array<{ depthM: number; timeMinutes: number; fO2: number }> = [];

  // Descente (simulation avec pas de temps variable pour cohérence tissulaire)
  if (depthM > 0) {
    let totalTime = depthM / DESCENT_RATE;  // Temps total de descente
    let steps = Math.ceil(totalTime / timeStep);
    descentTime = steps * timeStep;
    
    for (let i = 0; i < steps; i++) {
      const timeRemaining = totalTime - i * timeStep;
      const actualStep = Math.min(timeStep, timeRemaining);
      const depthStep = DESCENT_RATE * actualStep;
      const next = Math.min(depthM, cur + depthStep);
      updateConstantDepth(st, next, gas, actualStep);
      cur = next;
    }
  }

  // Fond
  if (bottomMin > 0) {
    updateConstantDepth(st, depthM, gas, bottomMin);
    cur = depthM;
    
    // Enregistrer segment pour toxicité O₂
    if (calculateO2) {
      o2Segments.push({ depthM, timeMinutes: bottomMin, fO2: gas.FO2 });
    }
  }

  // Premier plafond avec GF bas
  const firstCeil = overallCeiling(st, gfLow);
  let firstStop = Math.max(lastStopDepth, Math.ceil(firstCeil / STOP_STEP) * STOP_STEP);

  // Remontée vers le premier palier
  if (cur > firstStop) {
    let totalTime = (cur - firstStop) / ASCENT_RATE;  // Temps total de remontée
    let steps = Math.ceil(totalTime / timeStep);
    let actualTime = steps * timeStep;
    decoTime += actualTime;  // Ajouter au temps de déco
    
    for (let i = 0; i < steps; i++) {
      const timeRemaining = totalTime - i * timeStep;
      const actualStep = Math.min(timeStep, timeRemaining);
      const depthStep = ASCENT_RATE * actualStep;
      const next = Math.max(firstStop, cur - depthStep);
      updateConstantDepth(st, next, gas, actualStep);
      cur = next;
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

      updateConstantDepth(st, stopDepth, gas, timeStep);
      held += timeStep; 
      decoTime += timeStep;  // Ajouter au temps de déco
      // garde-fou (convertir en pas de temps)
      if (held > 360) break;
    }

    if (held > 0) {
      // Arrondir le temps de palier à la minute la plus proche pour l'affichage
      const roundedTime = Math.round(held);
      stops.push({ depth: stopDepth, time: roundedTime, gf: gfAtDepth(stopDepth, gfLow, gfHigh, firstStop) });
      
      // Enregistrer segment de palier pour toxicité O₂
      if (calculateO2) {
        o2Segments.push({ depthM: stopDepth, timeMinutes: held, fO2: gas.FO2 });
      }
    }

    // Remonter de 3 m (ou vers surface si on est au dernier palier)
    const nextDepth = Math.max(0, stopDepth - STOP_STEP);
    if (cur > nextDepth) {
      let totalTime = (cur - nextDepth) / ASCENT_RATE;  // Temps total de remontée
      let steps = Math.ceil(totalTime / timeStep);
      let actualTime = steps * timeStep;
      decoTime += actualTime;  // Ajouter au temps de déco
      
      for (let i = 0; i < steps; i++) {
        const timeRemaining = totalTime - i * timeStep;
        const actualStep = Math.min(timeStep, timeRemaining);
        const depthStep = ASCENT_RATE * actualStep;
        const d = Math.max(nextDepth, cur - depthStep);
        updateConstantDepth(st, d, gas, actualStep);
        cur = d;
      }
    }
    stopDepth = nextDepth;

    // Si on vient de quitter le dernier palier et qu'on est déjà à 0 → fin
    if (stopDepth === 0 && cur === 0) break;
  }

  // Par sécurité : si on a "sauté" le palier final (cas sans paliers) → fin vers 0
  if (cur > 0) {
    let totalTime = cur / ASCENT_RATE;  // Temps total de remontée
    let steps = Math.ceil(totalTime / timeStep);
    let actualTime = steps * timeStep;
    decoTime += actualTime;  // Ajouter au temps de déco
    
    for (let i = 0; i < steps; i++) {
      const timeRemaining = totalTime - i * timeStep;
      const actualStep = Math.min(timeStep, timeRemaining);
      const depthStep = ASCENT_RATE * actualStep;
      const d = Math.max(0, cur - depthStep);
      updateConstantDepth(st, d, gas, actualStep);
      cur = d;
    }
  }

  // Calculs finaux des temps
  const totalDiveTime = descentTime + bottomMin + decoTime;

  // Calcul de toxicité oxygène si demandé
  let oxygenToxicity;
  if (calculateO2 && o2Segments.length > 0) {
    const toxicity = calculateOxygenToxicity(o2Segments);
    oxygenToxicity = {
      cns: toxicity.cns,
      otu: toxicity.otu,
      maxPO2: toxicity.maxPO2,
      warnings: toxicity.warnings
    };
  }

  return {
    firstStopDepth: firstStop,
    stops,
    tts: Math.round(decoTime),         // TTS = temps de déco seulement
    totalDiveTime: Math.round(totalDiveTime), // Temps total de plongée
    descentTime: Math.round(descentTime),     // Temps de descente
    bottomTime: bottomMin,                    // Temps de fond (déjà en minutes)
    oxygenToxicity                            // Calculs de toxicité O₂
  };
}

/**
 * Planification de décompression avec support multi-gaz
 * Version avancée qui gère automatiquement les changements de gaz
 */
export function planDecompressionMultiGas(
  depthM: number, bottomMin: number, gasPlan: MultiGasPlan,
  gfLow: number, gfHigh: number,
  opts?: { 
    lastStopDepth?: number; 
    minLastStopMinutes?: number;
    timeStepMinutes?: number;
    calculateO2Toxicity?: boolean;
    maxPO2?: number;  // pO₂ maximale autorisée (défaut: 1.6)
  }
): DecompressionPlan {
  const lastStopDepth = Math.max(0, (opts?.lastStopDepth ?? 3));
  const minLast = Math.max(0, Math.floor(opts?.minLastStopMinutes ?? 0));
  const timeStep = opts?.timeStepMinutes ?? 0.5;  // Par défaut 30 secondes pour meilleure précision
  const calculateO2 = opts?.calculateO2Toxicity ?? true;  // Activé par défaut pour multi-gaz
  const maxPO2 = opts?.maxPO2 ?? 1.6;

  // Valider le plan multi-gaz
  const validation = validateMultiGasPlan(gasPlan, depthM);
  if (validation.errors.length > 0) {
    throw new Error(`Plan multi-gaz invalide: ${validation.errors.join(', ')}`);
  }

  const st = initTissues();
  let descentTime = 0;
  let decoTime = 0;
  let cur = 0;
  let currentGas = gasPlan.bottomGas;
  
  // Segments pour calcul toxicité O₂
  const o2Segments: Array<{ depthM: number; timeMinutes: number; fO2: number }> = [];

  // Trier les gaz de déco par profondeur décroissante
  const sortedDecoGases = [...gasPlan.decoGases].sort((a, b) => b.depth - a.depth);

  // Descente avec gaz de fond
  if (depthM > 0) {
    let totalTime = depthM / DESCENT_RATE;
    let steps = Math.ceil(totalTime / timeStep);
    descentTime = steps * timeStep;
    
    for (let i = 0; i < steps; i++) {
      const timeRemaining = totalTime - i * timeStep;
      const actualStep = Math.min(timeStep, timeRemaining);
      const depthStep = DESCENT_RATE * actualStep;
      const next = Math.min(depthM, cur + depthStep);
      updateConstantDepth(st, next, currentGas, actualStep);
      cur = next;
    }
  }

  // Fond avec gaz de fond
  if (bottomMin > 0) {
    updateConstantDepth(st, depthM, currentGas, bottomMin);
    cur = depthM;
    
    if (calculateO2) {
      o2Segments.push({ depthM, timeMinutes: bottomMin, fO2: currentGas.FO2 });
    }
  }

  // Calcul du premier palier
  const firstCeil = overallCeiling(st, gfLow);
  let firstStop = Math.max(lastStopDepth, Math.ceil(firstCeil / STOP_STEP) * STOP_STEP);

  // Remontée vers le premier palier
  if (cur > firstStop) {
    let totalTime = (cur - firstStop) / ASCENT_RATE;
    let steps = Math.ceil(totalTime / timeStep);
    let actualTime = steps * timeStep;
    decoTime += actualTime;
    
    for (let i = 0; i < steps; i++) {
      const timeRemaining = totalTime - i * timeStep;
      const actualStep = Math.min(timeStep, timeRemaining);
      const depthStep = ASCENT_RATE * actualStep;
      const next = Math.max(firstStop, cur - depthStep);
      
      // Vérifier si on doit changer de gaz
      const gasChoice = getBestGasForDepth(next, sortedDecoGases, currentGas, maxPO2);
      if (gasChoice.shouldSwitch) {
        currentGas = gasChoice.gas;
      }
      
      updateConstantDepth(st, next, currentGas, actualStep);
      cur = next;
    }
  }

  const stops: DecompressionStop[] = [];
  let stopDepth = firstStop;

  // Boucle de paliers successifs avec changements de gaz automatiques
  while (stopDepth >= lastStopDepth) {
    let held = 0;
    
    // Déterminer le meilleur gaz pour ce palier
    const gasChoice = getBestGasForDepth(stopDepth, sortedDecoGases, currentGas, maxPO2);
    if (gasChoice.shouldSwitch) {
      currentGas = gasChoice.gas;
    }
    
    while (true) {
      const nextDepth = Math.max(0, stopDepth - STOP_STEP);
      const gfNext = gfAtDepth(nextDepth, gfLow, gfHigh, firstStop);
      const ceilNext = overallCeiling(st, gfNext);

      const canLeave = ceilNext <= nextDepth + 1e-6 && (stopDepth !== lastStopDepth || held >= minLast);
      if (canLeave) break;

      updateConstantDepth(st, stopDepth, currentGas, timeStep);
      held += timeStep; 
      decoTime += timeStep;
      
      if (held > 360) break;
    }

    if (held > 0) {
      // Arrondir le temps de palier à la minute la plus proche pour l'affichage
      const roundedTime = Math.round(held);
      stops.push({ 
        depth: stopDepth, 
        time: roundedTime, 
        gf: gfAtDepth(stopDepth, gfLow, gfHigh, firstStop),
        gas: currentGas,
        gasName: gasChoice.name
      });
      
      if (calculateO2) {
        o2Segments.push({ depthM: stopDepth, timeMinutes: held, fO2: currentGas.FO2 });
      }
    }

    // Remonter de 3 m
    const nextDepth = Math.max(0, stopDepth - STOP_STEP);
    if (cur > nextDepth) {
      let totalTime = (cur - nextDepth) / ASCENT_RATE;
      let steps = Math.ceil(totalTime / timeStep);
      let actualTime = steps * timeStep;
      decoTime += actualTime;
      
      for (let i = 0; i < steps; i++) {
        const timeRemaining = totalTime - i * timeStep;
        const actualStep = Math.min(timeStep, timeRemaining);
        const depthStep = ASCENT_RATE * actualStep;
        const d = Math.max(nextDepth, cur - depthStep);
        
        // Vérifier changement de gaz pendant la remontée
        const gasChoice = getBestGasForDepth(d, sortedDecoGases, currentGas, maxPO2);
        if (gasChoice.shouldSwitch) {
          currentGas = gasChoice.gas;
        }
        
        updateConstantDepth(st, d, currentGas, actualStep);
        cur = d;
      }
    }
    stopDepth = nextDepth;

    if (stopDepth === 0 && cur === 0) break;
  }

  // Remontée finale
  if (cur > 0) {
    let totalTime = cur / ASCENT_RATE;
    let steps = Math.ceil(totalTime / timeStep);
    let actualTime = steps * timeStep;
    decoTime += actualTime;
    
    for (let i = 0; i < steps; i++) {
      const timeRemaining = totalTime - i * timeStep;
      const actualStep = Math.min(timeStep, timeRemaining);
      const depthStep = ASCENT_RATE * actualStep;
      const d = Math.max(0, cur - depthStep);
      updateConstantDepth(st, d, currentGas, actualStep);
      cur = d;
    }
  }

  // Calculs finaux
  const totalDiveTime = descentTime + bottomMin + decoTime;

  let oxygenToxicity;
  if (calculateO2 && o2Segments.length > 0) {
    const toxicity = calculateOxygenToxicity(o2Segments);
    oxygenToxicity = {
      cns: toxicity.cns,
      otu: toxicity.otu,
      maxPO2: toxicity.maxPO2,
      warnings: [...toxicity.warnings, ...validation.warnings]
    };
  }

  return {
    firstStopDepth: firstStop,
    stops,
    tts: Math.round(decoTime),
    totalDiveTime: Math.round(totalDiveTime),
    descentTime: Math.round(descentTime),
    bottomTime: bottomMin,
    oxygenToxicity
  };
}