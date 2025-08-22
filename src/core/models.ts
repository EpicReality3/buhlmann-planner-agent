export interface GasMix { FO2: number; FHe: number; FN2: number; }

export interface GasSwitch {
  depth: number;    // Profondeur de changement de gaz (m)
  gas: GasMix;      // Nouveau gaz à utiliser
  name?: string;    // Nom du gaz (ex: "EAN50", "O2")
}

export interface MultiGasPlan {
  bottomGas: GasMix;           // Gaz de fond
  decoGases: GasSwitch[];      // Gaz de décompression (triés par profondeur décroissante)
}
export interface TissueState { pN2: number[]; pHe: number[]; }
export interface DecompressionStop { 
  depth: number; 
  time: number; 
  gf: number;
  gas?: GasMix;    // Gaz utilisé pendant ce palier
  gasName?: string; // Nom du gaz
}
export interface DecompressionPlan { 
  firstStopDepth: number; 
  stops: DecompressionStop[]; 
  tts: number;           // Temps de décompression uniquement (depuis fin du fond)
  totalDiveTime: number; // Temps total de plongée (descente + fond + déco)
  descentTime: number;   // Temps de descente
  bottomTime: number;    // Temps de fond
  oxygenToxicity?: {     // Calculs de toxicité oxygène
    cns: number;         // Pourcentage CNS
    otu: number;         // Unités OTU
    maxPO2: number;      // pO₂ maximale rencontrée
    warnings: string[];  // Avertissements de sécurité
  };
}
