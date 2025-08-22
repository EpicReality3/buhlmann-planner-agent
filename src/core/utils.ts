/**
 * Utilitaires pour les calculs de décompression Bühlmann
 * Implémente les équations de Schreiner/Haldane pour la saturation tissulaire
 */

import { WATER_VAPOUR_PRESSURE, PRESSURE_PER_METER, SURFACE_PRESSURE,
         HALF_TIMES_N2, HALF_TIMES_HE } from './constants';
import { GasMix, TissueState } from './models';

const LN2 = Math.log(2);

/**
 * Convertit une profondeur en pression absolue
 * @param depthM Profondeur en mètres
 * @returns Pression absolue en bar
 */
export function depthToPressure(depthM: number): number { 
  return SURFACE_PRESSURE + depthM * PRESSURE_PER_METER; 
}

/**
 * Calcule la pression partielle d'un gaz inerte inspiré
 * Tient compte de la pression de vapeur d'eau dans les poumons
 * @param pAmb Pression ambiante en bar
 * @param fInert Fraction du gaz inerte (0-1)
 * @returns Pression partielle inspirée en bar
 */
export function computePinsp(pAmb: number, fInert: number): number { 
  return Math.max(0, (pAmb - WATER_VAPOUR_PRESSURE) * fInert); 
}

/**
 * Initialise les tissus à saturation surface (air)
 * @returns État tissulaire initial avec N₂ saturé à 79% et He à 0%
 */
export function initTissues(): TissueState {
  const initN2 = HALF_TIMES_N2.map(() => computePinsp(SURFACE_PRESSURE, 0.79));
  const initHe = HALF_TIMES_HE.map(() => 0);
  return { pN2: initN2, pHe: initHe };
}

/**
 * Met à jour les pressions tissulaires après un temps à profondeur constante
 * Utilise l'équation de Schreiner/Haldane : P(t) = P₀ + (Pinsp - P₀) * (1 - e^(-k*t))
 * où k = ln(2) / T½
 * 
 * Référence: Schreiner HR (1971) "A predictive studies III. Linear interpolation..."
 * 
 * @param state État tissulaire à modifier (muté en place)
 * @param depthM Profondeur en mètres
 * @param gas Mélange gazeux respiré
 * @param minutes Durée en minutes
 */
export function updateConstantDepth(state: TissueState, depthM: number, gas: GasMix, minutes: number): void {
  const pAmb = depthToPressure(depthM);
  const pN2i = computePinsp(pAmb, gas.FN2);
  const pHei = computePinsp(pAmb, gas.FHe);
  
  for (let i = 0; i < state.pN2.length; i++) {
    const kN2 = LN2 / HALF_TIMES_N2[i];
    const kHe = LN2 / HALF_TIMES_HE[i];
    state.pN2[i] = state.pN2[i] + (pN2i - state.pN2[i]) * (1 - Math.exp(-kN2 * minutes));
    state.pHe[i] = state.pHe[i] + (pHei - state.pHe[i]) * (1 - Math.exp(-kHe * minutes));
  }
}
