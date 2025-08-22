const assert = require('assert');
const { planDive, normaliseGas } = require('../src/adapter/index.ts');
const { computePinsp } = require('../src/core/utils.ts');
const { planDecompression } = require('../src/core/algorithm.ts');

// ===== SANITY CHECKS =====
console.log('\n🧪 Tests de sanité...');

// Tests pinsp (pression inspirée)
assert(Math.abs(computePinsp(1.0, 0.79) - 0.7405) < 0.02, 'pinsp(1.0, 0.79) ≈ 0.7405');
assert(Math.abs(computePinsp(4.0, 0.79) - 3.1105) < 0.02, 'pinsp(4.0, 0.79) ≈ 3.1105');
assert(Math.abs(computePinsp(5.0, 0.79) - 3.9005) < 0.02, 'pinsp(5.0, 0.79) ≈ 3.9005');

console.log('✅ Sanity checks pinsp OK');

// ===== VALIDATION DES ENTRÉES =====
console.log('\n🧪 Tests de validation des entrées...');

// Test normalisation des gaz
const air = normaliseGas({ FO2: 0.21, FN2: 0.79, FHe: 0 });
assert(Math.abs(air.FO2 + air.FN2 + air.FHe - 1) < 1e-6, 'Somme des fractions = 1');
assert(air.FO2 >= 0 && air.FO2 <= 1, 'FO2 dans [0,1]');
assert(air.FN2 >= 0 && air.FN2 <= 1, 'FN2 dans [0,1]');
assert(air.FHe >= 0 && air.FHe <= 1, 'FHe dans [0,1]');

console.log('✅ Validation des gaz OK');

// ===== CAS DE RÉFÉRENCE (CONTRATS) =====
console.log('\n🧪 Tests des profils de référence...');

// Test 1: Bühlmann pur (sans contrainte de palier minimal)
// 40m/10min Air GF 85/85 -> PAS de palier obligatoire
{
  console.log('\n  1. Bühlmann pur (40m/10min, Air, GF 85/85, minLast=0)...');
  const p = planDive(40, 10, air, 85, 85, { lastStopDepth: 3, minLastStopMinutes: 0 });
  
  // Avec la formule corrigée de Baker, ce profil ne devrait PAS avoir de palier obligatoire
  // Si le plafond est < 0, aucun palier n'est requis
  const hasRequiredStop = p.stops.some(s => s.time > 0);
  assert(!hasRequiredStop, 'Bühlmann pur: pas de palier obligatoire pour 40m/10min GF85/85');
  
  // TTS = temps de remontée depuis 40m à 9m/min = 40/9 = 4.44 min, arrondi avec Math.ceil = 5 min
  // Mais avec la discrétisation minute par minute, on obtient ~5-6 min
  assert(p.tts >= 4 && p.tts <= 6, `TTS entre 4 et 6 min (remontée directe), obtenu: ${p.tts}`);
  console.log(`    ✅ Pas de palier obligatoire, TTS = ${p.tts} min`);
}

// Test 1b: Bühlmann pur avec last=6m (vérifier qu'il n'y a pas de maintien artificiel)
{
  console.log('\n  1b. Bühlmann pur (40m/10min, Air, GF 85/85, last=6m, minLast=0)...');
  const p = planDive(40, 10, air, 85, 85, { lastStopDepth: 6, minLastStopMinutes: 0 });
  
  const hasRequiredStop = p.stops.some(s => s.time > 0);
  assert(!hasRequiredStop, 'Bühlmann pur: pas de palier obligatoire même avec last=6m');
  assert(p.tts >= 4 && p.tts <= 6, `TTS entre 4 et 6 min (remontée directe)`);
  console.log(`    ✅ Pas de maintien artificiel à 6m, TTS = ${p.tts} min`);
}

// Test 2: Subsurface-like (dernier palier minimal à 3m)
// 40m/10min Air GF 85/85 avec minLast=1 -> 1 min @ 3m
{
  console.log('\n  2. Subsurface-like (40m/10min, Air, GF 85/85, last=3m, minLast=1)...');
  const p = planDive(40, 10, air, 85, 85, { lastStopDepth: 3, minLastStopMinutes: 1 });
  
  assert(p.stops.length > 0, 'Au moins un palier');
  const lastStop = p.stops[p.stops.length - 1];
  assert(lastStop.depth === 3, 'Dernier palier à 3m');
  assert(lastStop.time >= 1, 'Au moins 1 min au dernier palier');
  assert(lastStop.depth % 3 === 0, 'Profondeur de palier multiple de 3m');
  console.log(`    ✅ ${lastStop.time} min @ ${lastStop.depth}m`);
}

// Test 3: Peregrine-like (dernier palier minimal à 6m)
// 40m/10min Air GF 85/85 avec minLast=1 -> ≥2 min @ 6m
{
  console.log('\n  3. Peregrine-like (40m/10min, Air, GF 85/85, last=6m, minLast=1)...');
  const p = planDive(40, 10, air, 85, 85, { lastStopDepth: 6, minLastStopMinutes: 1 });
  
  assert(p.stops.length > 0, 'Au moins un palier');
  const lastStop = p.stops[p.stops.length - 1];
  assert(lastStop.depth === 6, 'Dernier palier à 6m');
  assert(lastStop.time >= 2, 'Au moins 2 min au dernier palier (plafond > 3m)');
  assert(lastStop.depth % 3 === 0, 'Profondeur de palier multiple de 3m');
  console.log(`    ✅ ${lastStop.time} min @ ${lastStop.depth}m`);
}

console.log('\n✅ Profils de référence OK');

// ===== TESTS DE CONTRATS SUPPLÉMENTAIRES =====
console.log('\n🧪 Tests de contrats supplémentaires...');

// Test 4: 40m/10min Air GF 30/85 -> Pas de palier > 6m, TTS ≤ 10min
{
  console.log('\n  4. Deep stops (40m/10min, Air, GF 30/85)...');
  const p = planDive(40, 10, air, 30, 85, { lastStopDepth: 3, minLastStopMinutes: 0 });
  
  const hasDeepStop = p.stops.some(s => s.depth > 6);
  assert(!hasDeepStop, 'Aucun palier > 6m (pas de deep stops dans cette version)');
  assert(Math.round(p.tts) <= 10, 'TTS ≤ 10 min');
  
  // Vérifier que tous les paliers sont multiples de 3m
  p.stops.forEach(s => {
    assert(s.depth % 3 === 0, `Palier à ${s.depth}m doit être multiple de 3`);
  });
  
  console.log(`    ✅ TTS = ${Math.round(p.tts)} min, pas de deep stops`);
}

// Test 5: 40m/30min Air GF 85/85 -> Paliers obligatoires
{
  console.log('\n  5. Plongée longue (40m/30min, Air, GF 85/85)...');
  const p = planDive(40, 30, air, 85, 85, { lastStopDepth: 3, minLastStopMinutes: 0 });
  
  const hasRequiredStop = p.stops.some(s => s.time > 0);
  assert(hasRequiredStop, 'Paliers obligatoires pour 40m/30min');
  assert(p.tts > 30, 'TTS > 30 min (temps fond + déco)');
  
  // Vérifier que tous les paliers sont en multiples de 3m
  p.stops.forEach(s => {
    assert(s.depth % 3 === 0, `Palier à ${s.depth}m doit être multiple de 3`);
  });
  console.log(`    ✅ Paliers obligatoires, TTS = ${Math.round(p.tts)} min`);
}

// Test 6: 30m/20min Air GF 30/85 -> TTS < 120min
{
  console.log('\n  6. Plongée modérée (30m/20min, Air, GF 30/85)...');
  const p = planDive(30, 20, air, 30, 85, { lastStopDepth: 3, minLastStopMinutes: 0 });
  
  assert(Math.round(p.tts) < 120, 'TTS < 120 min');
  
  // Vérifier que tous les paliers sont multiples de 3m
  p.stops.forEach(s => {
    assert(s.depth % 3 === 0, `Palier à ${s.depth}m doit être multiple de 3`);
  });
  
  console.log(`    ✅ TTS = ${Math.round(p.tts)} min`);
}

console.log('\n✅ Contrats supplémentaires OK');

// ===== TEST INTERPOLATION GF =====
console.log('\n🧪 Test interpolation Gradient Factors...');

// Note: gfAtDepth n'est pas exportée, on teste indirectement via les résultats
// En vérifiant que le GF du palier est cohérent
{
  const p = planDive(40, 20, air, 30, 85, { lastStopDepth: 3, minLastStopMinutes: 0 });
  if (p.stops.length > 0) {
    const lastStop = p.stops[p.stops.length - 1];
    // Au dernier palier (3m), le GF devrait être proche de GF high (85%)
    assert(lastStop.gf > 0.7 && lastStop.gf <= 0.85, 'GF interpolé cohérent au dernier palier');
    console.log(`  ✅ GF au dernier palier: ${Math.round(lastStop.gf * 100)}%`);
  }
}

// ===== TESTS ARRONDIS =====
console.log('\n🧪 Test des arrondis...');

// Vérifier que le TTS est arrondi à 0.1 près (dans le core)
// L'UI devrait arrondir à la minute entière
{
  const p = planDive(25, 15, air, 85, 85);
  const decimals = (p.tts.toString().split('.')[1] || '').length;
  assert(decimals <= 1, 'TTS arrondi à 0.1 près maximum dans le core');
  console.log(`  ✅ TTS = ${p.tts} (arrondi à 0.1 près dans le core)`);
  console.log(`  ℹ️  L'UI devrait afficher: ${Math.round(p.tts)} min`);
}

// ===== TEST CHANGEMENT lastStopDepth =====
console.log('\n🧪 Test changement lastStopDepth...');

// Vérifier que changer lastStopDepth change bien le comportement
{
  const p3m = planDive(40, 15, air, 85, 85, { lastStopDepth: 3, minLastStopMinutes: 1 });
  const p6m = planDive(40, 15, air, 85, 85, { lastStopDepth: 6, minLastStopMinutes: 1 });
  
  if (p3m.stops.length > 0 && p6m.stops.length > 0) {
    const last3m = p3m.stops[p3m.stops.length - 1];
    const last6m = p6m.stops[p6m.stops.length - 1];
    
    assert(last3m.depth === 3, 'Palier à 3m avec lastStopDepth=3');
    assert(last6m.depth === 6, 'Palier à 6m avec lastStopDepth=6');
    assert(last6m.time > last3m.time, 'Durée plus longue à 6m qu\'à 3m');
    
    console.log(`  ✅ lastStopDepth=3m: ${last3m.time} min @ ${last3m.depth}m`);
    console.log(`  ✅ lastStopDepth=6m: ${last6m.time} min @ ${last6m.depth}m`);
  }
}

console.log('\n' + '='.repeat(50));
console.log('✅ TOUS LES TESTS PASSENT - Formule Baker corrigée');
console.log('='.repeat(50));