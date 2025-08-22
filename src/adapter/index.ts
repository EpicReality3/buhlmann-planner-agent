import { GasMix, DecompressionPlan } from '../core/models';
import { planDecompression } from '../core/algorithm';

/**
 * Normalise et valide un mélange gazeux
 * @param g Mélange gazeux avec fractions O2, He, N2
 * @returns Mélange gazeux normalisé
 * @throws Error si les fractions ne somment pas à 1 ou sont hors limites
 */
export function normaliseGas(g: GasMix): GasMix {
  const FO2 = Number(g.FO2);
  const FHe = Number(g.FHe || 0);
  const FN2 = Number(g.FN2 || (1 - FO2 - FHe));
  
  // Validation des bornes
  if (FO2 < 0 || FO2 > 1) throw new Error('FO2 must be between 0 and 1');
  if (FHe < 0 || FHe > 1) throw new Error('FHe must be between 0 and 1');
  if (FN2 < 0 || FN2 > 1) throw new Error('FN2 must be between 0 and 1');
  
  // Validation de la somme
  const sum = FO2 + FHe + FN2;
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`Gas fractions must sum to 1 (got ${sum})`);
  }
  
  return { FO2, FHe, FN2 };
}

/**
 * Normalise les Gradient Factors de pourcentage (0-100) en ratio (0-1)
 * @param gfLowPct GF bas en pourcentage
 * @param gfHighPct GF haut en pourcentage
 * @returns GF en ratio pour le core
 */
export function normaliseGradientFactors(gfLowPct: number, gfHighPct: number) {
  if (gfLowPct < 0 || gfLowPct > 100) throw new Error('GF Low must be between 0 and 100');
  if (gfHighPct < 0 || gfHighPct > 100) throw new Error('GF High must be between 0 and 100');
  if (gfLowPct > gfHighPct) throw new Error('GF Low must be <= GF High');
  
  return { gfLow: gfLowPct / 100, gfHigh: gfHighPct / 100 };
}

/**
 * Planifie une plongée avec décompression
 * Point d'entrée principal de la librairie
 * 
 * @param depthM Profondeur en mètres
 * @param bottomMin Temps au fond en minutes
 * @param gasIn Mélange gazeux
 * @param gfLowPct GF bas en pourcentage (0-100)
 * @param gfHighPct GF haut en pourcentage (0-100)
 * @param opts Options: lastStopDepth (3 ou 6m), minLastStopMinutes
 * @returns Plan de décompression
 */
export function planDive(
  depthM: number,
  bottomMin: number,
  gasIn: GasMix,
  gfLowPct: number,
  gfHighPct: number,
  opts?: { lastStopDepth?: 3 | 6; minLastStopMinutes?: number }
): DecompressionPlan {
  const gas = normaliseGas(gasIn);
  const { gfLow, gfHigh } = normaliseGradientFactors(gfLowPct, gfHighPct);
  return planDecompression(depthM, bottomMin, gas, gfLow, gfHigh, opts ?? {});
}