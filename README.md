# Bühlmann Planner Agent

Planificateur de décompression **Bühlmann ZH-L16C + Gradient Factors (GF)** en TypeScript, utilisable en lib et avec une **UI autonome** (GitHub Pages) pour tester des profils.

## Structure
- `src/core/` : constantes, utilitaires, algorithme
- `src/adapter/` : normalisation entrées (gaz, GF)
- `tests/` : tests unitaires (sanity + profils de référence)
- `demo/` : assets de démo (si besoin)
- `docs/` : **UI autonome** servie par GitHub Pages

## Installation & tests
```bash
npm i
npm test
```
