import { A_HE, A_N2, B_HE, B_N2 } from './constants';
import { GasMix, TissueState, DecompressionStop, DecompressionPlan } from './models';
import { initTissues, updateConstantDepth } from './utils';

const ASCENT_RATE = 9;   // m/min
const STOP_INTERVAL = 3; // m
const SURFACE = 1.01325, BAR_PER_M = 0.1;

/**
 * Calcule le plafond pour un compartiment tissulaire donné
 * Utilise la formule d'Erik Baker pour les Gradient Factors :
 * pAmbMin = (Ptiss - GF * a) / (GF / b + 1 - GF)
 * 
 * Référence: Erik Baker - "Clearing Up The Confusion About Deep Stops"
 * 
 * @param pN2 Pression d'azote dans le compartiment
 * @param pHe Pression d'hélium dans le compartiment
 * @param gf Gradient Factor actuel (0-1)
 * @param i Index du compartiment
 * @returns Profondeur du plafond en mètres
 */
function ceilingForCompartment(pN2:number,pHe:number,gf:number,i:number):number{
  const pn = Math.max(0,pN2), ph = Math.max(0,pHe);
  const sum = pn+ph || 1e-9;
  const a = (A_N2[i]*pn + A_HE[i]*ph)/sum;
  const b = (B_N2[i]*pn + B_HE[i]*ph)/sum;
  const pt = pn+ph;
  
  // Formule corrigée d'Erik Baker
  // pAmbMin = (Ptiss - GF * a) / (GF / b + 1 - GF)
  const pAmbMin = (pt - gf * a) / (gf / b + 1 - gf);
  
  return Math.max(0, (pAmbMin - SURFACE)/BAR_PER_M);
}

function overallCeiling(s:TissueState,gf:number):number{
  let worst=0;
  for(let i=0;i<s.pN2.length;i++){
    const c=ceilingForCompartment(s.pN2[i],s.pHe[i],gf,i);
    if(c>worst) worst=c;
  }
  return worst;
}

function gfAtDepth(depthM:number,gfLow:number,gfHigh:number,firstCeil:number):number{
  const firstStopDepth = Math.ceil(firstCeil/STOP_INTERVAL)*STOP_INTERVAL;
  if(firstStopDepth<=0) return gfHigh;
  const frac = Math.max(0, Math.min(1, 1 - depthM/firstStopDepth));
  return gfLow + (gfHigh-gfLow)*frac;
}

export function planDecompression(
  depthM:number, bottomMin:number, gas:GasMix, gfLow:number, gfHigh:number,
  opts:{lastStopDepth?:number; minLastStopMinutes?:number}={}
):DecompressionPlan{
  const lastStopDepth = opts.lastStopDepth ?? 3;
  const minLast = Math.max(0, Math.floor(opts.minLastStopMinutes ?? 0));
  const state = initTissues();

  // fond
  updateConstantDepth(state, depthM, gas, bottomMin);

  const firstCeil = overallCeiling(state, gfLow);
  const stops:DecompressionStop[] = [];
  let currentDepth = depthM, tts = 0;

  // Remontée vers dernier palier (pas de deep stops dans cette version)
  if(currentDepth > lastStopDepth){
    const minutes = Math.ceil((currentDepth-lastStopDepth)/ASCENT_RATE);
    for(let i=0;i<minutes;i++){
      const nextD = Math.max(currentDepth - ASCENT_RATE, lastStopDepth);
      updateConstantDepth(state, nextD, gas, 1);
      currentDepth = nextD; tts += 1;
    }
  }

  // Tenue au dernier palier : plafond<=0 ET durée min atteinte
  let held=0;
  while(true){
    const gf = gfAtDepth(currentDepth, gfLow, gfHigh, firstCeil);
    const ceil = overallCeiling(state, gf);
    const need = ceil > 0 || held < minLast;
    if(!need) break;
    updateConstantDepth(state, currentDepth, gas, 1);
    held += 1; tts += 1;
    if(held>360) break;
  }
  if(held>0) stops.push({ depth: currentDepth, time: held, gf: gfAtDepth(currentDepth,gfLow,gfHigh,firstCeil) });

  // Remontée surface
  if(currentDepth>0){
    const minutes = Math.ceil(currentDepth/ASCENT_RATE);
    for(let i=0;i<minutes;i++){
      const nextD = Math.max(currentDepth - ASCENT_RATE, 0);
      updateConstantDepth(state, nextD, gas, 1);
      currentDepth = nextD; tts += 1;
    }
  }

  return { firstStopDepth: stops.length?stops[0].depth:0, stops, tts: Math.round(tts*10)/10 };
}