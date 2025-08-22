/**
 * Module de calcul de toxicité oxygène (CNS et OTU)
 * Basé sur les modèles NOAA et standards de plongée technique
 */

import { depthToPressure } from './utils';

// Tables CNS basées sur les limites NOAA
// Temps maximum d'exposition (en minutes) pour différentes pressions partielles d'O₂
const CNS_TABLE: { [pO2: string]: number } = {
  '0.50': 720,    // 12 heures
  '0.60': 300,    // 5 heures
  '0.70': 150,    // 2.5 heures
  '0.80': 90,     // 1.5 heures
  '0.90': 60,     // 1 heure
  '1.00': 45,     // 45 minutes
  '1.10': 35,     // 35 minutes
  '1.20': 30,     // 30 minutes
  '1.30': 25,     // 25 minutes
  '1.40': 22.5,   // 22.5 minutes
  '1.50': 15,     // 15 minutes
  '1.60': 12,     // 12 minutes
  '1.70': 10,     // 10 minutes
  '1.80': 8,      // 8 minutes
  '1.90': 7,      // 7 minutes
  '2.00': 6       // 6 minutes
};

export interface OxygenToxicity {
  cns: number;        // Pourcentage CNS (0-100+)
  otu: number;        // Unités OTU accumulées
  maxPO2: number;     // Pression partielle d'O₂ maximale rencontrée
  warnings: string[]; // Avertissements de sécurité
}

/**
 * Calcule la pression partielle d'oxygène à une profondeur donnée
 */
export function calculatePO2(depthM: number, fO2: number): number {
  const pAmb = depthToPressure(depthM);
  return pAmb * fO2;
}

/**
 * Calcule l'incrément CNS pour une exposition donnée
 * @param pO2 Pression partielle d'O₂ (bar)
 * @param timeMinutes Temps d'exposition (minutes)
 * @returns Pourcentage CNS ajouté
 */
export function calculateCNSIncrement(pO2: number, timeMinutes: number): number {
  if (pO2 < 0.5) return 0; // Pas de toxicité CNS en dessous de 0.5 bar

  // Trouver les valeurs encadrantes dans la table
  const pO2Keys = Object.keys(CNS_TABLE).map(k => parseFloat(k)).sort((a, b) => a - b);
  
  let maxTime: number;
  
  if (pO2 >= 2.0) {
    maxTime = CNS_TABLE['2.00']; // Utiliser la valeur maximale
  } else if (pO2 <= 0.5) {
    return 0;
  } else {
    // Interpolation linéaire entre les valeurs de la table
    let lowerKey = 0.5;
    let upperKey = 2.0;
    
    for (const key of pO2Keys) {
      if (key <= pO2) lowerKey = key;
      if (key >= pO2 && upperKey === 2.0) upperKey = key;
    }
    
    if (lowerKey === upperKey) {
      maxTime = CNS_TABLE[lowerKey.toFixed(2)];
    } else {
      const lowerTime = CNS_TABLE[lowerKey.toFixed(2)];
      const upperTime = CNS_TABLE[upperKey.toFixed(2)];
      const factor = (pO2 - lowerKey) / (upperKey - lowerKey);
      maxTime = lowerTime - (lowerTime - upperTime) * factor;
    }
  }
  
  return (timeMinutes / maxTime) * 100;
}

/**
 * Calcule l'incrément OTU pour une exposition donnée
 * Formule NOAA : OTU = t * (PO₂ - 0.5)^0.83
 * @param pO2 Pression partielle d'O₂ (bar)
 * @param timeMinutes Temps d'exposition (minutes)
 * @returns OTU ajoutées
 */
export function calculateOTUIncrement(pO2: number, timeMinutes: number): number {
  if (pO2 <= 0.5) return 0; // Pas de toxicité OTU en dessous de 0.5 bar
  
  return timeMinutes * Math.pow(pO2 - 0.5, 0.83);
}

/**
 * Calcule la toxicité oxygène cumulée pour un profil de plongée
 * @param segments Array de segments {depthM, timeMinutes, fO2}
 * @returns Toxicité oxygène totale
 */
export function calculateOxygenToxicity(
  segments: Array<{ depthM: number; timeMinutes: number; fO2: number }>
): OxygenToxicity {
  let totalCNS = 0;
  let totalOTU = 0;
  let maxPO2 = 0;
  const warnings: string[] = [];
  
  for (const segment of segments) {
    const pO2 = calculatePO2(segment.depthM, segment.fO2);
    maxPO2 = Math.max(maxPO2, pO2);
    
    // Calculs CNS et OTU
    const cnsIncrement = calculateCNSIncrement(pO2, segment.timeMinutes);
    const otuIncrement = calculateOTUIncrement(pO2, segment.timeMinutes);
    
    totalCNS += cnsIncrement;
    totalOTU += otuIncrement;
    
    // Vérifications de sécurité
    if (pO2 > 1.6) {
      warnings.push(`⚠️ pO₂ élevée: ${pO2.toFixed(2)} bar à ${segment.depthM}m (limite recommandée: 1.6 bar)`);
    }
    if (pO2 > 2.0) {
      warnings.push(`🚨 pO₂ dangereuse: ${pO2.toFixed(2)} bar à ${segment.depthM}m (limite absolue: 2.0 bar)`);
    }
  }
  
  // Vérifications des totaux
  if (totalCNS > 80) {
    warnings.push(`⚠️ CNS élevé: ${totalCNS.toFixed(1)}% (limite recommandée: 80%)`);
  }
  if (totalCNS > 100) {
    warnings.push(`🚨 CNS critique: ${totalCNS.toFixed(1)}% (limite absolue: 100%)`);
  }
  
  if (totalOTU > 200) {
    warnings.push(`⚠️ OTU élevé: ${totalOTU.toFixed(0)} (limite quotidienne: 300, limite recommandée: 200)`);
  }
  if (totalOTU > 300) {
    warnings.push(`🚨 OTU critique: ${totalOTU.toFixed(0)} (limite quotidienne dépassée)`);
  }
  
  return {
    cns: totalCNS,
    otu: totalOTU,
    maxPO2,
    warnings
  };
}

/**
 * Calcule la profondeur maximale recommandée pour un mélange donné
 * @param fO2 Fraction d'oxygène
 * @param maxPO2 Pression partielle d'O₂ maximale souhaitée (défaut: 1.4 bar)
 * @returns Profondeur maximale en mètres
 */
export function calculateMaxDepth(fO2: number, maxPO2: number = 1.4): number {
  const maxPressure = maxPO2 / fO2;
  return (maxPressure - 1.01325) * 10; // Conversion pression -> profondeur
}
