/**
 * Module de gestion multi-gaz pour la planification de décompression
 */

import { GasMix, GasSwitch, MultiGasPlan } from './models';
import { calculatePO2, calculateMaxDepth } from './oxygen-toxicity';

/**
 * Détermine le meilleur gaz à utiliser à une profondeur donnée
 * @param depth Profondeur actuelle (m)
 * @param availableGases Gaz disponibles triés par profondeur décroissante
 * @param currentGas Gaz actuellement utilisé
 * @param maxPO2 Pression partielle d'O₂ maximale autorisée
 * @returns Le gaz optimal à utiliser
 */
export function getBestGasForDepth(
  depth: number,
  availableGases: GasSwitch[],
  currentGas: GasMix,
  maxPO2: number = 1.6
): { gas: GasMix; name?: string; shouldSwitch: boolean } {
  
  // Vérifier si le gaz actuel est encore sûr
  const currentPO2 = calculatePO2(depth, currentGas.FO2);
  
  // Trouver le meilleur gaz disponible à cette profondeur
  let bestGas = currentGas;
  let bestGasName: string | undefined;
  let shouldSwitch = false;
  
  for (const gasSwitch of availableGases) {
    // Le gaz doit être utilisable à cette profondeur ou plus profond
    if (depth >= gasSwitch.depth) {
      const gasPO2 = calculatePO2(depth, gasSwitch.gas.FO2);
      
      // Le gaz doit être sûr (pO₂ < maxPO2)
      if (gasPO2 <= maxPO2) {
        // Préférer le gaz le plus riche en O₂ (accélère la déco)
        if (gasSwitch.gas.FO2 > bestGas.FO2) {
          bestGas = gasSwitch.gas;
          bestGasName = gasSwitch.name;
          shouldSwitch = true;
        }
      }
    }
  }
  
  // Forcer le changement si le gaz actuel devient dangereux
  if (currentPO2 > maxPO2) {
    shouldSwitch = true;
  }
  
  return {
    gas: bestGas,
    name: bestGasName,
    shouldSwitch: shouldSwitch && (bestGas !== currentGas)
  };
}

/**
 * Valide un plan multi-gaz
 * @param plan Plan multi-gaz à valider
 * @param maxDepth Profondeur maximale de la plongée
 * @returns Liste des erreurs et avertissements
 */
export function validateMultiGasPlan(
  plan: MultiGasPlan,
  maxDepth: number
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Vérifier le gaz de fond
  const bottomPO2 = calculatePO2(maxDepth, plan.bottomGas.FO2);
  if (bottomPO2 > 1.4) {
    warnings.push(`⚠️ pO₂ élevée au fond: ${bottomPO2.toFixed(2)} bar avec ${(plan.bottomGas.FO2 * 100).toFixed(0)}% O₂`);
  }
  if (bottomPO2 > 1.6) {
    errors.push(`🚨 pO₂ dangereuse au fond: ${bottomPO2.toFixed(2)} bar avec ${(plan.bottomGas.FO2 * 100).toFixed(0)}% O₂`);
  }
  
  // Vérifier les gaz de déco
  for (const decoGas of plan.decoGases) {
    const maxDepthForGas = calculateMaxDepth(decoGas.gas.FO2, 1.6);
    
    if (decoGas.depth > maxDepthForGas) {
      errors.push(`🚨 ${decoGas.name || 'Gaz déco'} (${(decoGas.gas.FO2 * 100).toFixed(0)}% O₂) utilisé trop profond: ${decoGas.depth}m (max: ${maxDepthForGas.toFixed(0)}m)`);
    }
    
    // Vérifier que les gaz de déco sont plus riches que le gaz de fond
    if (decoGas.gas.FO2 <= plan.bottomGas.FO2) {
      warnings.push(`⚠️ ${decoGas.name || 'Gaz déco'} n'est pas plus riche en O₂ que le gaz de fond`);
    }
  }
  
  // Vérifier l'ordre des profondeurs de changement
  const sortedGases = [...plan.decoGases].sort((a, b) => b.depth - a.depth);
  for (let i = 0; i < plan.decoGases.length; i++) {
    if (plan.decoGases[i].depth !== sortedGases[i].depth) {
      warnings.push(`⚠️ Les gaz de déco devraient être triés par profondeur décroissante`);
      break;
    }
  }
  
  return { errors, warnings };
}

/**
 * Crée des gaz de décompression standards
 */
export function createStandardDecoGases(): GasSwitch[] {
  return [
    {
      depth: 21, // EAN50 utilisable jusqu'à ~21m (pO₂ 1.6)
      gas: { FO2: 0.50, FHe: 0.00, FN2: 0.50 },
      name: "EAN50"
    },
    {
      depth: 6, // O₂ pur utilisable jusqu'à ~6m (pO₂ 1.6)
      gas: { FO2: 1.00, FHe: 0.00, FN2: 0.00 },
      name: "O₂"
    }
  ];
}

/**
 * Suggère des gaz de décompression optimaux pour une profondeur donnée
 */
export function suggestDecoGases(maxDepth: number): GasSwitch[] {
  const suggestions: GasSwitch[] = [];
  
  // Pour les plongées profondes, suggérer EAN50
  if (maxDepth > 30) {
    suggestions.push({
      depth: 21,
      gas: { FO2: 0.50, FHe: 0.00, FN2: 0.50 },
      name: "EAN50"
    });
  }
  
  // Toujours suggérer l'oxygène pur pour les paliers peu profonds
  if (maxDepth > 15) {
    suggestions.push({
      depth: 6,
      gas: { FO2: 1.00, FHe: 0.00, FN2: 0.00 },
      name: "O₂"
    });
  }
  
  return suggestions;
}
