# Bühlmann Planner Agent

Planificateur de décompression **Bühlmann ZH-L16C + Gradient Factors (GF)** en TypeScript, utilisable en lib et avec une **UI autonome** (GitHub Pages) pour tester des profils.

## 🎯 Fonctionnalités

- Implémentation de l'algorithme **Bühlmann ZH-L16C** avec Gradient Factors
- Formule de plafond corrigée selon **Erik Baker**
- Support des mélanges **Air, Nitrox et Trimix**
- Options de dernier palier configurables (3m ou 6m)
- Interface web avec visualisation graphique du profil
- Tests unitaires complets

## 📚 Structure

```
├── src/
│   ├── core/          # Algorithme Bühlmann (constants, utils, algorithm)
│   └── adapter/       # Normalisation des entrées (gaz, GF)
├── tests/             # Tests unitaires et profils de référence
├── docs/              # UI autonome (GitHub Pages)
│   ├── index.html     # Interface utilisateur
│   └── app.js         # Logique JavaScript autonome
└── demo/              # Assets de démo
```

## 🚀 Installation & Tests

```bash
npm install
npm test
```

## 📖 Documentation de l'algorithme

### Formule du plafond (Erik Baker)

La formule correcte pour calculer le plafond avec Gradient Factors est :

```
pAmbMin = (Ptiss - GF * a) / (GF / b + 1 - GF)
```

Où :
- `Ptiss` : Pression totale du gaz inerte dans le tissu
- `GF` : Gradient Factor actuel (interpolé entre GF low et GF high)
- `a, b` : Coefficients Bühlmann pour le compartiment

### Comportements spécifiques

#### 1. **Bühlmann pur** (sans contrainte de palier minimal)
- Profil : 40m/10min, Air, GF 85/85
- Résultat : **Pas de palier obligatoire**
- TTS : ~5 min (remontée directe)

#### 2. **Subsurface-like** (lastStopDepth=3m, minLastStopMinutes=1)
- Profil : 40m/10min, Air, GF 85/85
- Résultat : **1 min @ 3m**
- Comportement : Force un palier minimal même si non obligatoire

#### 3. **Peregrine-like** (lastStopDepth=6m, minLastStopMinutes=1)
- Profil : 40m/10min, Air, GF 85/85
- Résultat : **≥2 min @ 6m**
- Comportement : Palier plus conservateur à 6m

## 🔧 Configuration

### Options disponibles

- `lastStopDepth` : Profondeur du dernier palier (3 ou 6 mètres)
- `minLastStopMinutes` : Durée minimale au dernier palier (en minutes)
- `gfLow` : Gradient Factor bas (0-100%)
- `gfHigh` : Gradient Factor haut (0-100%)

### Vitesses

- **Descente** : 19 m/min (interface)
- **Remontée** : 9 m/min
- **Paliers** : Multiples de 3 mètres

## 🧪 Tests

Les tests incluent :

- **Sanity checks** : Vérification des calculs de pression inspirée
- **Profils de référence** : Validation contre Subsurface/Peregrine
- **Validation des entrées** : Gaz, GF, bornes
- **Contrats** : TTS, profondeurs de palier, arrondis

```bash
npm test
```

## 📚 Références

- [Erik Baker - "Clearing Up The Confusion About Deep Stops"](http://www.rebreatherworld.com/rebreatherpro-training/decompression-theory-articles/5033-clearing-confusion-deep-stops.html)
- [Erik Baker - "Understanding M-values"](https://www.shearwater.com/wp-content/uploads/2012/08/understanding-m-values.pdf)
- [Decotengu Documentation](https://wrobell.dcmod.org/decotengu/model.html)
- [Subsurface](https://subsurface-divelog.org/) - Logiciel open-source de référence

## ⚠️ Avertissement

Ce logiciel est fourni à des fins éducatives uniquement. Ne pas utiliser pour planifier de vraies plongées sans validation appropriée. La plongée sous-marine comporte des risques inhérents. Toujours suivre une formation appropriée et utiliser du matériel certifié.

## 📝 License

MIT

## 🔄 Changelog

### v0.2.0 (2024-08-22)
- ✅ Correction de la formule Baker pour les Gradient Factors
- ✅ Ajout de tests complets et validation
- ✅ Documentation détaillée des comportements
- ✅ Validation des entrées renforcée

### v0.1.0
- Version initiale