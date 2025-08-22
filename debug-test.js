const { planDive } = require('./src/adapter/index.ts');

// Test du cas "Bühlmann pur" qui échoue
const air = { FO2: 0.21, FN2: 0.79, FHe: 0 };
const p = planDive(40, 10, air, 85, 85);

console.log('Résultat pour 40m/10min Air GF85/85:');
console.log('TTS:', p.tts);
console.log('Stops:', p.stops);
console.log('Nombre de stops:', p.stops.length);
console.log('Stops avec temps > 0:', p.stops.filter(s => s.time > 0).length);
