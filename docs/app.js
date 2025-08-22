// Import de l'algorithme Bühlmann depuis le projet
import { planDive } from '../src/adapter/index.ts';

// Fonctions utilitaires
const $ = id => document.getElementById(id);

function render(plan) {
  let html = `<p><strong>TTS: ${plan.tts} min</strong></p>`;
  html += '<table><tr><th>Stop (m)</th><th>Durée (min)</th><th>GF (%)</th></tr>';
  
  if (!plan.stops.length) {
    html += '<tr><td colspan="3">Aucun palier obligatoire</td></tr>';
  } else {
    for (const stop of plan.stops) {
      html += `<tr><td>${stop.depth}</td><td>${stop.time}</td><td>${Math.round(stop.gf * 100)}%</td></tr>`;
    }
  }
  
  html += '</table>';
  $('out').innerHTML = html;
}

function calculate() {
  try {
    const depth = +$('depth').value;
    const tbt = +$('tbt').value;
    const FO2 = (+$('fo2').value) / 100;
    const FHe = (+$('fhe').value) / 100;
    const FN2 = 1 - FO2 - FHe;
    
    const gfLow = +$('gfl').value;
    const gfHigh = +$('gfh').value;
    const lastStopDepth = $('last6').checked ? 6 : 3;
    const minLastStopMinutes = +$('minLast').value || 0;
    
    const gas = { FO2, FN2, FHe };
    const opts = { 
      lastStopDepth, 
      minLastStopMinutes 
    };
    
    const plan = planDive(depth, tbt, gas, gfLow, gfHigh, opts);
    render(plan);
  } catch (error) {
    $('out').innerHTML = `<p style="color: red;">Erreur: ${error.message}</p>`;
  }
}

function selfTest() {
  const tests = [
    {
      name: "Air 40m/10min GF85/85",
      params: { depth: 40, tbt: 10, gas: { FO2: 0.21, FN2: 0.79, FHe: 0 }, gfLow: 85, gfHigh: 85 }
    },
    {
      name: "Air 30m/20min GF70/85",
      params: { depth: 30, tbt: 20, gas: { FO2: 0.21, FN2: 0.79, FHe: 0 }, gfLow: 70, gfHigh: 85 }
    },
    {
      name: "Nitrox 32% 35m/15min GF80/80",
      params: { depth: 35, tbt: 15, gas: { FO2: 0.32, FN2: 0.68, FHe: 0 }, gfLow: 80, gfHigh: 80 }
    }
  ];
  
  let results = '<h3>Self-Test Results:</h3>';
  
  for (const test of tests) {
    try {
      const plan = planDive(
        test.params.depth, 
        test.params.tbt, 
        test.params.gas, 
        test.params.gfLow, 
        test.params.gfHigh
      );
      
      const stops = plan.stops.length > 0 
        ? plan.stops.map(s => `${s.depth}m/${s.time}min`).join(', ')
        : 'Aucun palier';
      
      results += `<p><strong>${test.name}:</strong> TTS=${plan.tts}min, Stops: ${stops}</p>`;
    } catch (error) {
      results += `<p><strong>${test.name}:</strong> <span style="color: red;">Erreur: ${error.message}</span></p>`;
    }
  }
  
  $('out').innerHTML = results;
}

// Event listeners
$('go').addEventListener('click', calculate);
$('selftest').addEventListener('click', selfTest);

// Calcul automatique au chargement
document.addEventListener('DOMContentLoaded', () => {
  calculate();
});
