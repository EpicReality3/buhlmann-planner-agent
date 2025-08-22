# Améliorations du Planificateur Bühlmann ZH-L16C

Ce document détaille les améliorations implémentées suite à l'analyse du planificateur Bühlmann ZH-L16C avec Gradient Factors.

## 📋 Vue d'ensemble

Les améliorations apportées répondent aux recommandations de l'analyse PDF pour rendre le planificateur plus précis, sûr et fonctionnel, comparable aux références du domaine comme Subsurface.

## 🚀 Améliorations implémentées

### 1. Correction du calcul TTS (Time To Surface)

**Problème identifié :** Le TTS incluait le temps de descente et de fond, créant une confusion avec la définition standard.

**Solution implémentée :**
- Séparation claire entre `tts` (temps de décompression seulement) et `totalDiveTime`
- Nouvelles propriétés dans `DecompressionPlan`:
  - `tts`: Temps de décompression uniquement (depuis fin du fond)
  - `totalDiveTime`: Temps total de plongée (descente + fond + déco)
  - `descentTime`: Temps de descente
  - `bottomTime`: Temps de fond

**Exemple :**
```typescript
const plan = planDecompression(40, 20, air, 0.30, 0.85);
console.log(`TTS (déco seulement): ${plan.tts} min`);
console.log(`Temps total: ${plan.totalDiveTime} min`);
```

### 2. Amélioration de la granularité temporelle

**Problème identifié :** Simulation par pas d'une minute entière causait des surestimations.

**Solution implémentée :**
- Option `timeStepMinutes` pour définir la granularité (0.5 = 30s, 0.167 = 10s)
- Calculs plus précis pour les remontées et paliers
- Réduction des arrondis conservateurs

**Exemple :**
```typescript
// Granularité 30 secondes pour plus de précision
const plan = planDecompression(35, 15, air, 0.35, 0.85, {
  timeStepMinutes: 0.5
});
```

### 3. Calcul de toxicité oxygène (CNS/OTU)

**Nouvelle fonctionnalité :** Module complet de calcul de toxicité oxygène selon les standards NOAA.

**Fonctionnalités :**
- Calcul CNS (Central Nervous System Oxygen Toxicity) basé sur les tables NOAA
- Calcul OTU (Oxygen Tolerance Units) avec formule `OTU = t * (PO₂ - 0.5)^0.83`
- Avertissements automatiques de sécurité
- Calcul de profondeur maximale pour un mélange donné

**Modules créés :**
- `src/core/oxygen-toxicity.ts`: Calculs de toxicité
- Intégration automatique dans les plans de décompression

**Exemple :**
```typescript
const plan = planDecompression(30, 25, nitrox32, 0.40, 0.85, {
  calculateO2Toxicity: true
});

console.log(`CNS: ${plan.oxygenToxicity.cns}%`);
console.log(`OTU: ${plan.oxygenToxicity.otu}`);
```

### 4. Support multi-gaz

**Nouvelle fonctionnalité majeure :** Gestion automatique des changements de gaz pendant la décompression.

**Fonctionnalités :**
- Planification avec gaz de fond + gaz de décompression
- Changements automatiques au meilleur moment
- Validation de sécurité des plans multi-gaz
- Suggestions automatiques de gaz selon la profondeur

**Modules créés :**
- `src/core/multi-gas.ts`: Gestion multi-gaz
- `planDecompressionMultiGas()`: Fonction de planification avancée

**Exemple :**
```typescript
const multiPlan: MultiGasPlan = {
  bottomGas: { FO2: 0.18, FHe: 0.45, FN2: 0.37 }, // Tx18/45
  decoGases: [
    { depth: 21, gas: { FO2: 0.50, FHe: 0.00, FN2: 0.50 }, name: "EAN50" },
    { depth: 6, gas: { FO2: 1.00, FHe: 0.00, FN2: 0.00 }, name: "O₂" }
  ]
};

const result = planDecompressionMultiGas(60, 25, multiPlan, 0.30, 0.80);
```

### 5. Élimination des duplications de code

**Problème identifié :** Fonctions dupliquées dans plusieurs fichiers.

**Solution implémentée :**
- Centralisation des fonctions dans `utils.ts`
- Suppression des duplications dans `algorithm.ts` et `docs/app.js`
- Utilisation cohérente des constantes depuis `constants.ts`

### 6. Validations de sécurité renforcées

**Nouvelles fonctionnalités de sécurité :**
- Validation automatique des plans multi-gaz
- Détection des pO₂ dangereuses
- Avertissements pour limites CNS/OTU dépassées
- Rejet automatique des plans dangereux

## 📁 Structure des nouveaux modules

```
src/core/
├── oxygen-toxicity.ts    # Calculs toxicité O₂ (CNS/OTU)
├── multi-gas.ts         # Gestion multi-gaz
├── models.ts            # Interfaces étendues
├── algorithm.ts         # Algorithmes améliorés
└── utils.ts             # Fonctions centralisées
```

## 🧪 Tests et validation

**Tests créés :**
- `tests/improved-features.test.ts`: Tests complets des améliorations
- `examples/improved-features.ts`: Exemples d'utilisation

**Couverture des tests :**
- ✅ Correction calcul TTS
- ✅ Granularité temporelle
- ✅ Calculs toxicité oxygène
- ✅ Support multi-gaz
- ✅ Validations sécurité
- ✅ Rétrocompatibilité
- ✅ Cas limites

## 🔄 Rétrocompatibilité

Toutes les améliorations préservent la rétrocompatibilité :
- Les anciens appels à `planDecompression()` fonctionnent toujours
- Nouvelles propriétés ajoutées aux interfaces existantes
- Options nouvelles avec valeurs par défaut

## 📊 Comparaison avant/après

| Aspect | Avant | Après |
|--------|--------|--------|
| **TTS** | Inclut fond + descente | Décompression seulement |
| **Précision temporelle** | 1 minute | 30s/10s configurables |
| **Toxicité O₂** | ❌ Absente | ✅ CNS/OTU complets |
| **Multi-gaz** | ❌ Gaz unique | ✅ Changements automatiques |
| **Sécurité** | Basique | ✅ Validations renforcées |
| **Code** | Duplications | ✅ Centralisé et propre |

## 🎯 Résultats obtenus

Les améliorations permettent d'obtenir :

1. **Précision comparable à Subsurface** grâce aux corrections TTS et granularité
2. **Sécurité renforcée** avec calculs toxicité O₂ et validations
3. **Fonctionnalités avancées** avec support multi-gaz
4. **Code maintenable** sans duplications
5. **Compatibilité préservée** avec l'existant

## 🚀 Utilisation

### Planification simple (améliorée)
```typescript
import { planDecompression } from './src/core/algorithm';

const plan = planDecompression(40, 20, air, 0.30, 0.85, {
  timeStepMinutes: 0.5,        // Précision 30s
  calculateO2Toxicity: true    // Calculs toxicité
});
```

### Planification multi-gaz
```typescript
import { planDecompressionMultiGas } from './src/core/algorithm';
import { createStandardDecoGases } from './src/core/multi-gas';

const multiPlan = {
  bottomGas: trimix,
  decoGases: createStandardDecoGases()
};

const result = planDecompressionMultiGas(60, 25, multiPlan, 0.30, 0.80);
```

### Calculs de sécurité
```typescript
import { calculateMaxDepth, calculatePO2 } from './src/core/oxygen-toxicity';

const maxDepth = calculateMaxDepth(0.32, 1.4); // EAN32, pO₂ 1.4 bar
const pO2 = calculatePO2(30, 0.32); // pO₂ à 30m avec EAN32
```

## 🔮 Évolutions futures

Les améliorations ouvrent la voie à :
- Modèles alternatifs (VPM-B, RGBM)
- Planification avec profils complexes
- Interface utilisateur avancée
- Intégration avec ordinateurs de plongée
- Calculs de risque probabilistes

---

*Ces améliorations transforment le planificateur en un outil de niveau professionnel, comparable aux références du domaine tout en préservant sa simplicité d'utilisation.*
