export interface GasMix { FO2: number; FHe: number; FN2: number; }
export interface TissueState { pN2: number[]; pHe: number[]; }
export interface DecompressionStop { depth: number; time: number; gf: number; }
export interface DecompressionPlan { firstStopDepth: number; stops: DecompressionStop[]; tts: number; }
