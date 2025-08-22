import { WATER_VAPOUR_PRESSURE, PRESSURE_PER_METER, SURFACE_PRESSURE,
         HALF_TIMES_N2, HALF_TIMES_HE } from './constants';
import { GasMix, TissueState } from './models';
const LN2 = Math.log(2);
export function depthToPressure(depthM: number){ return SURFACE_PRESSURE + depthM*PRESSURE_PER_METER; }
export function computePinsp(pAmb: number, fInert: number){ return Math.max(0, (pAmb - WATER_VAPOUR_PRESSURE) * fInert); }
export function initTissues(): TissueState {
  const initN2 = HALF_TIMES_N2.map(() => computePinsp(SURFACE_PRESSURE, 0.79));
  const initHe = HALF_TIMES_HE.map(() => 0);
  return { pN2: initN2, pHe: initHe };
}
export function updateConstantDepth(state: TissueState, depthM: number, gas: GasMix, minutes: number){
  const pAmb = depthToPressure(depthM);
  const pN2i = computePinsp(pAmb, gas.FN2);
  const pHei = computePinsp(pAmb, gas.FHe);
  for (let i=0;i<state.pN2.length;i++){
    const kN2 = LN2 / HALF_TIMES_N2[i];
    const kHe = LN2 / HALF_TIMES_HE[i];
    state.pN2[i] = state.pN2[i] + (pN2i - state.pN2[i]) * (1 - Math.exp(-kN2*minutes));
    state.pHe[i] = state.pHe[i] + (pHei - state.pHe[i]) * (1 - Math.exp(-kHe*minutes));
  }
}
