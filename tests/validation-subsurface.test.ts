/**
 * Tests de validation croisée avec Subsurface et tables publiées
 * Référence: PDF "Analyse du planificateur Bühlmann ZH-L16C avec Gradient Factors"
 */

const assert = require('assert');
const { planDive } = require('../src/adapter/index');

const air = { FO2: 0.21, FN2: 0.79, FHe: 0 };
const ean32 = { FO2: 0.32, FN2: 0.68, FHe: 0 };

// Tests de validation directe (sans framework de test)
function runValidationTests() {
  console.log('🧪 Exécution des tests de validation...\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: 30m/25min air GF 30/70
  try {
    const plan = planDive(30, 25, air, 30, 70, { 
      lastStopDepth: 3, 
      minLastStopMinutes: 0,
      timeStepMinutes: 0.5 
    });
    assert(plan.stops.length > 0, 'Devrait avoir au moins un palier');
    const lastStop = plan.stops[plan.stops.length - 1];
    assert.strictEqual(lastStop.depth, 3, 'Dernier palier devrait être à 3m');
    assert(lastStop.time >= 3 && lastStop.time <= 9, 
      `Durée du palier à 3m devrait être ~5-7 min, obtenu: ${lastStop.time}`);
    console.log('✅ Test 1: 30m/25min air GF 30/70');
    passed++;
  } catch (e: any) {
    console.log(`❌ Test 1: ${e.message}`);
    failed++;
  }
  
  // Test 2: 40m/10min air GF 85/85
  try {
    const plan = planDive(40, 10, air, 85, 85, { 
      lastStopDepth: 3,
      timeStepMinutes: 0.5 
    });
    assert(plan.stops.length > 0, 'Devrait avoir un palier obligatoire');
    assert.strictEqual(plan.stops[0].depth, 3, 'Palier devrait être à 3m');
    assert(plan.stops[0].time > 0, 'Durée du palier devrait être > 0');
    assert(plan.tts <= 10, `TTS ne devrait pas dépasser 10 min, obtenu: ${plan.tts}`);
    console.log('✅ Test 2: 40m/10min air GF 85/85');
    passed++;
  } catch (e: any) {
    console.log(`❌ Test 2: ${e.message}`);
    failed++;
  }
  
  // Test 3: 50m/20min air GF 30/70 (multi-paliers)
  try {
    const plan = planDive(50, 20, air, 30, 70, {
      lastStopDepth: 3,
      timeStepMinutes: 0.5
    });
    assert(plan.stops.length >= 2, 
      `Devrait avoir au moins 2 paliers, obtenu: ${plan.stops.length}`);
    assert(plan.firstStopDepth > 3, 
      `Premier palier devrait être > 3m, obtenu: ${plan.firstStopDepth}`);
    // Vérifier l'ordre des paliers
    for (let i = 1; i < plan.stops.length; i++) {
      assert(plan.stops[i-1].depth > plan.stops[i].depth,
        'Les paliers devraient être ordonnés du plus profond au moins profond');
    }
    console.log('✅ Test 3: 50m/20min air GF 30/70 (multi-paliers)');
    passed++;
  } catch (e: any) {
    console.log(`❌ Test 3: ${e.message}`);
    failed++;
  }
  
  // Test 4: 18m/30min air GF 85/85 (NDL)
  try {
    const plan = planDive(18, 30, air, 85, 85, {
      lastStopDepth: 3,
      timeStepMinutes: 0.5
    });
    assert(plan.stops.length === 0 || 
           (plan.stops.length === 1 && plan.stops[0].time <= 1),
      'Ne devrait pas avoir de paliers obligatoires significatifs');
    assert(plan.tts <= 3, `TTS devrait être <= 3 min, obtenu: ${plan.tts}`);
    console.log('✅ Test 4: 18m/30min air GF 85/85 (NDL)');
    passed++;
  } catch (e: any) {
    console.log(`❌ Test 4: ${e.message}`);
    failed++;
  }
  
  // Test 5: EAN32 vs Air comparison
  try {
    const planAir = planDive(35, 20, air, 40, 85, {
      lastStopDepth: 3,
      timeStepMinutes: 0.5
    });
    const planEAN32 = planDive(35, 20, ean32, 40, 85, {
      lastStopDepth: 3,
      timeStepMinutes: 0.5
    });
    assert(planEAN32.tts <= planAir.tts,
      `EAN32 TTS (${planEAN32.tts}) devrait être <= Air TTS (${planAir.tts})`);
    console.log('✅ Test 5: EAN32 vs Air comparison');
    passed++;
  } catch (e: any) {
    console.log(`❌ Test 5: ${e.message}`);
    failed++;
  }
  
  // Test 6: GF conservatism check
  try {
    const profile = { depth: 40, time: 15, gas: air };
    const planAggressive = planDive(profile.depth, profile.time, profile.gas, 85, 85, {
      lastStopDepth: 3,
      timeStepMinutes: 0.5
    });
    const planModerate = planDive(profile.depth, profile.time, profile.gas, 40, 85, {
      lastStopDepth: 3,
      timeStepMinutes: 0.5
    });
    const planConservative = planDive(profile.depth, profile.time, profile.gas, 30, 70, {
      lastStopDepth: 3,
      timeStepMinutes: 0.5
    });
    assert(planConservative.tts >= planModerate.tts,
      `GF 30/70 TTS (${planConservative.tts}) >= GF 40/85 TTS (${planModerate.tts})`);
    assert(planModerate.tts >= planAggressive.tts,
      `GF 40/85 TTS (${planModerate.tts}) >= GF 85/85 TTS (${planAggressive.tts})`);
    console.log('✅ Test 6: GF conservatism check');
    passed++;
  } catch (e: any) {
    console.log(`❌ Test 6: ${e.message}`);
    failed++;
  }
  
  console.log(`\n📊 Résultats: ${passed} passés, ${failed} échoués`);
  
  return failed === 0;
}

// Lancer les tests
if (require.main === module) {
  const success = runValidationTests();
  process.exit(success ? 0 : 1);
}

module.exports = { runValidationTests };