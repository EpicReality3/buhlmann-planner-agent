import { GasMix, DecompressionPlan } from '../core/models';
import { planDecompression } from '../core/algorithm';

export function normaliseGas(g: GasMix): GasMix {
  const FO2 = Number(g.FO2), FHe = Number(g.FHe); const FN2 = 1 - FO2 - FHe;
  if (Math.abs(FO2 + FHe + FN2 - 1) > 1e-6) throw new Error('gas fractions must sum to 1');
  return { FO2, FHe, FN2 };
}
export function normaliseGradientFactors(gfLowPct:number,gfHighPct:number){ return { gfLow: gfLowPct/100, gfHigh: gfHighPct/100 }; }

export function planDive(
  depthM:number, bottomMin:number, gasIn:GasMix,
  gfLowPct:number, gfHighPct:number,
  opts?:{ 
    lastStopDepth?:3|6; 
    minLastStopMinutes?:number;
    timeStepMinutes?: number;
    calculateO2Toxicity?: boolean;
  }
):DecompressionPlan{
  const gas = normaliseGas(gasIn);
  const { gfLow, gfHigh } = normaliseGradientFactors(gfLowPct,gfHighPct);
  return planDecompression(depthM, bottomMin, gas, gfLow, gfHigh, opts ?? {});
}
