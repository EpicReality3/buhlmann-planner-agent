/**
 * Exemples d'utilisation des améliorations du planificateur Bühlmann
 * Démontre les nouvelles fonctionnalités implémentées
 */

import { planDecompression, planDecompressionMultiGas } from '../src/core/algorithm';
import { calculatePO2, calculateMaxDepth, calculateOxygenToxicity } from '../src/core/oxygen-toxicity';
import { createStandardDecoGases, suggestDecoGases } from '../src/core/multi-gas';
import { GasMix, MultiGasPlan } from '../src/core/models';

// ========================================
// 1. CORRECTION DU CALCUL TTS
// ========================================

console.log('=== 1. CORRECTION DU CALCUL TTS ===');

// Gaz de fond : Air (21% O₂)
const air: GasMix = { FO2: 0.21, FHe: 0.00, FN2: 0.79 };

// Plongée 40m pendant 20 minutes
const plan = planDecompression(40, 20, air, 0.30, 0.85, {
  timeStepMinutes: 0.5,  // Amélioration: granularité 30 secondes
  calculateO2Toxicity: true
});

console.log('Plongée 40m/20min à l\'air:');
console.log(`- TTS (décompression seulement): ${plan.tts} min`);
console.log(`- Temps total de plongée: ${plan.totalDiveTime} min`);
console.log(`- Temps de descente: ${plan.descentTime} min`);
console.log(`- Temps de fond: ${plan.bottomTime} min`);
console.log(`- Premier palier: ${plan.firstStopDepth}m`);
console.log('- Paliers:', plan.stops.map(s => `${s.depth}m/${s.time}min`).join(', '));

// ========================================
// 2. CALCUL DE TOXICITÉ OXYGÈNE
// ========================================

console.log('\n=== 2. CALCUL DE TOXICITÉ OXYGÈNE ===');

if (plan.oxygenToxicity) {
  console.log(`CNS: ${plan.oxygenToxicity.cns.toFixed(1)}%`);
  console.log(`OTU: ${plan.oxygenToxicity.otu.toFixed(0)}`);
  console.log(`pO₂ max: ${plan.oxygenToxicity.maxPO2.toFixed(2)} bar`);
  
  if (plan.oxygenToxicity.warnings.length > 0) {
    console.log('Avertissements:');
    plan.oxygenToxicity.warnings.forEach(w => console.log(`  ${w}`));
  }
}

// Exemple avec Nitrox
console.log('\n--- Exemple avec Nitrox EAN32 ---');
const nitrox32: GasMix = { FO2: 0.32, FHe: 0.00, FN2: 0.68 };

const planNitrox = planDecompression(30, 30, nitrox32, 0.40, 0.85, {
  calculateO2Toxicity: true
});

console.log('Plongée 30m/30min EAN32:');
console.log(`- TTS: ${planNitrox.tts} min`);
if (planNitrox.oxygenToxicity) {
  console.log(`- CNS: ${planNitrox.oxygenToxicity.cns.toFixed(1)}%`);
  console.log(`- pO₂ max: ${planNitrox.oxygenToxicity.maxPO2.toFixed(2)} bar`);
}

// ========================================
// 3. CALCULS DE SÉCURITÉ OXYGÈNE
// ========================================

console.log('\n=== 3. CALCULS DE SÉCURITÉ OXYGÈNE ===');

// Calcul de profondeur maximale pour différents mélanges
const testGases = [
  { name: 'Air', gas: { FO2: 0.21, FHe: 0.00, FN2: 0.79 } },
  { name: 'EAN32', gas: { FO2: 0.32, FHe: 0.00, FN2: 0.68 } },
  { name: 'EAN50', gas: { FO2: 0.50, FHe: 0.00, FN2: 0.50 } },
  { name: 'O₂', gas: { FO2: 1.00, FHe: 0.00, FN2: 0.00 } }
];

console.log('Profondeurs maximales (pO₂ 1.4 bar):');
testGases.forEach(({ name, gas }) => {
  const maxDepth = calculateMaxDepth(gas.FO2, 1.4);
  console.log(`- ${name}: ${maxDepth.toFixed(0)}m`);
});

// ========================================
// 4. PLANIFICATION MULTI-GAZ
// ========================================

console.log('\n=== 4. PLANIFICATION MULTI-GAZ ===');

// Plongée technique profonde avec changements de gaz
const trimix: GasMix = { FO2: 0.18, FHe: 0.45, FN2: 0.37 }; // Tx18/45

const multiGasPlan: MultiGasPlan = {
  bottomGas: trimix,
  decoGases: createStandardDecoGases() // EAN50 à 21m, O₂ à 6m
};

console.log('Plan multi-gaz pour plongée 60m/25min:');
console.log(`- Gaz de fond: Tx18/45 (${(trimix.FO2*100).toFixed(0)}% O₂, ${(trimix.FHe*100).toFixed(0)}% He)`);
console.log('- Gaz de déco:');
multiGasPlan.decoGases.forEach(dg => {
  console.log(`  * ${dg.name} à partir de ${dg.depth}m (${(dg.gas.FO2*100).toFixed(0)}% O₂)`);
});

try {
  const multiPlan = planDecompressionMultiGas(60, 25, multiGasPlan, 0.30, 0.80, {
    timeStepMinutes: 0.5,
    calculateO2Toxicity: true
  });

  console.log('\nRésultats:');
  console.log(`- TTS: ${multiPlan.tts} min`);
  console.log(`- Temps total: ${multiPlan.totalDiveTime} min`);
  console.log(`- Premier palier: ${multiPlan.firstStopDepth}m`);
  
  console.log('- Paliers avec gaz:');
  multiPlan.stops.forEach(stop => {
    const gasInfo = stop.gasName || `${(stop.gas!.FO2*100).toFixed(0)}% O₂`;
    console.log(`  * ${stop.depth}m: ${stop.time}min sur ${gasInfo}`);
  });

  if (multiPlan.oxygenToxicity) {
    console.log(`- CNS total: ${multiPlan.oxygenToxicity.cns.toFixed(1)}%`);
    console.log(`- OTU total: ${multiPlan.oxygenToxicity.otu.toFixed(0)}`);
    console.log(`- pO₂ max: ${multiPlan.oxygenToxicity.maxPO2.toFixed(2)} bar`);
    
    if (multiPlan.oxygenToxicity.warnings.length > 0) {
      console.log('- Avertissements:');
      multiPlan.oxygenToxicity.warnings.forEach(w => console.log(`  ${w}`));
    }
  }

} catch (error) {
  console.error('Erreur dans le plan multi-gaz:', error);
}

// ========================================
// 5. SUGGESTIONS AUTOMATIQUES DE GAZ
// ========================================

console.log('\n=== 5. SUGGESTIONS AUTOMATIQUES DE GAZ ===');

const depths = [25, 40, 60, 80];
depths.forEach(depth => {
  const suggestions = suggestDecoGases(depth);
  console.log(`Plongée ${depth}m - Gaz suggérés:`);
  if (suggestions.length === 0) {
    console.log('  Aucun gaz de déco nécessaire');
  } else {
    suggestions.forEach(gas => {
      console.log(`  - ${gas.name} à partir de ${gas.depth}m`);
    });
  }
});

// ========================================
// 6. COMPARAISON PRÉCISION TEMPORELLE
// ========================================

console.log('\n=== 6. COMPARAISON PRÉCISION TEMPORELLE ===');

const testDepth = 35;
const testTime = 15;

// Planification avec différentes granularités
const precisions = [
  { name: '1 minute (original)', step: 1.0 },
  { name: '30 secondes', step: 0.5 },
  { name: '10 secondes', step: 0.167 }
];

console.log(`Plongée ${testDepth}m/${testTime}min avec différentes précisions:`);

precisions.forEach(({ name, step }) => {
  const precisePlan = planDecompression(testDepth, testTime, air, 0.35, 0.85, {
    timeStepMinutes: step
  });
  
  console.log(`- ${name}: TTS = ${precisePlan.tts} min, Total = ${precisePlan.totalDiveTime} min`);
});

// ========================================
// 7. VALIDATION ET SÉCURITÉ
// ========================================

console.log('\n=== 7. VALIDATION ET SÉCURITÉ ===');

// Test de validation d'un plan dangereux
const dangerousPlan: MultiGasPlan = {
  bottomGas: { FO2: 0.50, FHe: 0.00, FN2: 0.50 }, // EAN50 au fond = dangereux
  decoGases: [{
    depth: 40, // O₂ à 40m = très dangereux
    gas: { FO2: 1.00, FHe: 0.00, FN2: 0.00 },
    name: 'O₂'
  }]
};

console.log('Test de plan dangereux:');
try {
  const dangerousResult = planDecompressionMultiGas(50, 20, dangerousPlan, 0.30, 0.85);
  console.log('⚠️ Plan accepté malgré les dangers!');
} catch (error) {
  console.log('✅ Plan rejeté correctement:', (error as Error).message);
}

console.log('\n=== RÉSUMÉ DES AMÉLIORATIONS ===');
console.log('✅ Calcul TTS corrigé (séparation temps fond/déco)');
console.log('✅ Granularité temporelle améliorée (30s/10s)');
console.log('✅ Calcul toxicité oxygène (CNS/OTU)');
console.log('✅ Support multi-gaz avec changements automatiques');
console.log('✅ Validations de sécurité renforcées');
console.log('✅ Code dédupliqué et optimisé');
