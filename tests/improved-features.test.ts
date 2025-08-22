/**
 * Tests pour les améliorations du planificateur Bühlmann
 * Valide les nouvelles fonctionnalités implémentées
 */

import { planDecompression, planDecompressionMultiGas } from '../src/core/algorithm';
import { calculatePO2, calculateCNSIncrement, calculateOTUIncrement } from '../src/core/oxygen-toxicity';
import { createStandardDecoGases, validateMultiGasPlan } from '../src/core/multi-gas';
import { GasMix, MultiGasPlan } from '../src/core/models';

// Utilitaire d'assertion simple
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

console.log('=== TESTS DES AMÉLIORATIONS ===\n');

// ========================================
// 1. Test correction TTS
// ========================================

console.log('1. Test correction calcul TTS...');

const air: GasMix = { FO2: 0.21, FHe: 0.00, FN2: 0.79 };
const plan = planDecompression(30, 20, air, 0.35, 0.85);

// Vérifier que TTS != temps total
assert(plan.tts !== plan.totalDiveTime, 'TTS doit être différent du temps total');

// Vérifier la cohérence des temps
const expectedTotal = plan.descentTime + plan.bottomTime + plan.tts;
assertApprox(plan.totalDiveTime, expectedTotal, 1, 'Temps total doit être cohérent');

// TTS doit être plus petit que le temps total
assert(plan.tts < plan.totalDiveTime, 'TTS doit être inférieur au temps total');

console.log('✅ Calcul TTS corrigé');

// ========================================
// 2. Test granularité temporelle
// ========================================

console.log('2. Test granularité temporelle...');

const plan1min = planDecompression(25, 15, air, 0.40, 0.85, { timeStepMinutes: 1.0 });
const plan30s = planDecompression(25, 15, air, 0.40, 0.85, { timeStepMinutes: 0.5 });

// La granularité plus fine peut donner des résultats légèrement différents
// mais doit rester dans une plage raisonnable
const diffTTS = Math.abs(plan1min.tts - plan30s.tts);
assert(diffTTS <= 2, 'Différence TTS avec granularité fine doit être ≤ 2 min');

console.log('✅ Granularité temporelle améliorée');

// ========================================
// 3. Test calcul toxicité oxygène
// ========================================

console.log('3. Test calcul toxicité oxygène...');

// Test calcul pO₂
const pO2_10m_air = calculatePO2(10, 0.21);
assertApprox(pO2_10m_air, 0.42, 0.01, 'pO₂ à 10m avec air');

const pO2_30m_nitrox = calculatePO2(30, 0.32);
assertApprox(pO2_30m_nitrox, 1.28, 0.01, 'pO₂ à 30m avec EAN32');

// Test calcul CNS
const cns15min_1_4bar = calculateCNSIncrement(1.4, 15);
assert(cns15min_1_4bar > 0, 'CNS doit être > 0 pour pO₂ > 0.5 bar');
assert(cns15min_1_4bar < 100, 'CNS pour 15min à 1.4 bar doit être < 100%');

// Test calcul OTU
const otu30min_1_2bar = calculateOTUIncrement(1.2, 30);
assert(otu30min_1_2bar > 0, 'OTU doit être > 0 pour pO₂ > 0.5 bar');

// Test intégration dans planification
const planWithO2 = planDecompression(25, 25, air, 0.40, 0.85, { 
  calculateO2Toxicity: true 
});

assert(planWithO2.oxygenToxicity !== undefined, 'Toxicité O₂ doit être calculée');
assert(planWithO2.oxygenToxicity!.cns >= 0, 'CNS doit être ≥ 0');
assert(planWithO2.oxygenToxicity!.otu >= 0, 'OTU doit être ≥ 0');
assert(planWithO2.oxygenToxicity!.maxPO2 > 0, 'pO₂ max doit être > 0');

console.log('✅ Calcul toxicité oxygène fonctionnel');

// ========================================
// 4. Test support multi-gaz
// ========================================

console.log('4. Test support multi-gaz...');

const trimix: GasMix = { FO2: 0.18, FHe: 0.45, FN2: 0.37 };
const multiPlan: MultiGasPlan = {
  bottomGas: trimix,
  decoGases: createStandardDecoGases()
};

// Test validation
const validation = validateMultiGasPlan(multiPlan, 50);
assert(validation.errors.length === 0, 'Plan multi-gaz standard doit être valide');

// Test planification multi-gaz
const multiResult = planDecompressionMultiGas(45, 20, multiPlan, 0.30, 0.80, {
  timeStepMinutes: 0.5
});

assert(multiResult.stops.length > 0, 'Plan multi-gaz doit avoir des paliers');
assert(multiResult.tts > 0, 'TTS multi-gaz doit être > 0');

// Vérifier que les paliers utilisent différents gaz
const gasesUsed = new Set(multiResult.stops.map(s => s.gasName).filter(Boolean));
assert(gasesUsed.size > 1, 'Plusieurs gaz doivent être utilisés');

console.log('✅ Support multi-gaz fonctionnel');

// ========================================
// 5. Test validation sécurité
// ========================================

console.log('5. Test validation sécurité...');

// Plan dangereux : O₂ pur trop profond
const dangerousPlan: MultiGasPlan = {
  bottomGas: air,
  decoGases: [{
    depth: 20, // O₂ à 20m = pO₂ > 3 bar !
    gas: { FO2: 1.00, FHe: 0.00, FN2: 0.00 },
    name: 'O₂'
  }]
};

const dangerousValidation = validateMultiGasPlan(dangerousPlan, 30);
assert(dangerousValidation.errors.length > 0, 'Plan dangereux doit être rejeté');

// Test exception lors de planification
let errorCaught = false;
try {
  planDecompressionMultiGas(30, 15, dangerousPlan, 0.30, 0.85);
} catch (error) {
  errorCaught = true;
}
assert(errorCaught, 'Plan dangereux doit lever une exception');

console.log('✅ Validation sécurité fonctionnelle');

// ========================================
// 6. Test rétrocompatibilité
// ========================================

console.log('6. Test rétrocompatibilité...');

// Les anciens appels doivent toujours fonctionner
const oldStylePlan = planDecompression(40, 15, air, 0.35, 0.85);
assert(oldStylePlan.tts > 0, 'Ancien style d\'appel doit fonctionner');
assert(oldStylePlan.stops.length >= 0, 'Ancien style doit retourner des paliers');

// Les nouvelles propriétés doivent être présentes
assert('totalDiveTime' in oldStylePlan, 'Nouvelle propriété totalDiveTime doit être présente');
assert('descentTime' in oldStylePlan, 'Nouvelle propriété descentTime doit être présente');
assert('bottomTime' in oldStylePlan, 'Nouvelle propriété bottomTime doit être présente');

console.log('✅ Rétrocompatibilité préservée');

// ========================================
// 7. Test cas limites
// ========================================

console.log('7. Test cas limites...');

// Plongée sans déco
const noDeco = planDecompression(15, 10, air, 0.85, 0.85);
assert(noDeco.stops.length === 0, 'Plongée sans déco ne doit pas avoir de paliers');
assert(noDeco.tts === 0, 'TTS sans déco doit être 0');

// Plongée très profonde
const deepPlan = planDecompression(80, 15, trimix, 0.20, 0.75, {
  timeStepMinutes: 0.5
});
assert(deepPlan.stops.length > 0, 'Plongée profonde doit avoir des paliers');
assert(deepPlan.firstStopDepth > 20, 'Premier palier profond attendu');

console.log('✅ Cas limites gérés correctement');

// ========================================
// RÉSUMÉ
// ========================================

console.log('\n=== RÉSUMÉ DES TESTS ===');
console.log('✅ Calcul TTS corrigé et validé');
console.log('✅ Granularité temporelle améliorée');
console.log('✅ Calcul toxicité oxygène complet');
console.log('✅ Support multi-gaz avec changements automatiques');
console.log('✅ Validations de sécurité renforcées');
console.log('✅ Rétrocompatibilité préservée');
console.log('✅ Cas limites gérés correctement');
console.log('\n🎉 Tous les tests des améliorations sont passés avec succès !');

export {};
