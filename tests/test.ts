const assert = require('assert');
const { planDive } = require('../src/adapter/index.ts');
const { computePinsp } = require('../src/core/utils.ts');

assert(Math.abs(computePinsp(1.0, 0.79) - 0.7405) < 0.02);
assert(Math.abs(computePinsp(4.0, 0.79) - 3.1105) < 0.02);
assert(Math.abs(computePinsp(5.0, 0.79) - 3.9005) < 0.02);

const air = { FO2: 0.21, FN2: 0.79, FHe: 0 };

// Subsurface-like
{
  const p = planDive(40, 10, air, 85, 85, { lastStopDepth: 3, minLastStopMinutes: 1 });
  const last = p.stops[p.stops.length - 1];
  assert(last.depth === 3, 'Dernier palier à 3 m attendu');
  assert(last.time >= 1, '>= 1 min à 3 m attendu');
}

// Peregrine-like
{
  const p = planDive(40, 10, air, 85, 85, { lastStopDepth: 6, minLastStopMinutes: 1 });
  const last = p.stops[p.stops.length - 1];
  assert(last.depth === 6, 'Dernier palier à 6 m attendu');
  assert(last.time >= 2, '>= 2 min à 6 m attendu');
}

// Bühlmann pur avec formule Erik Baker corrigée
// 40m/10min Air GF85/85 nécessite maintenant un palier (plus conservateur)
{
  const p = planDive(40, 10, air, 85, 85);
  assert(p.stops.length > 0, 'Palier obligatoire attendu avec formule Erik Baker');
  assert(p.stops[0].depth === 3, 'Palier à 3 m attendu');
  assert(p.stops[0].time > 0, 'Durée de palier > 0 attendue');
}

console.log('✅ Tests OK');
