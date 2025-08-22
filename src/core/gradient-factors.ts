/**
 * Module de recommandations pour les Gradient Factors
 * Basé sur les recherches de Dr Simon Mitchell (2018) et les pratiques actuelles
 * 
 * Références:
 * - Mitchell SJ, Doolette DJ (2018) "Gradient Factors in Decompression Planning"
 * - Erik Baker "Clearing Up The Confusion About Deep Stops"
 * - DiveRite "Understanding Gradient Factors"
 */

export interface GradientFactorProfile {
  name: string;
  gfLow: number;
  gfHigh: number;
  description: string;
  useCase: string;
  warnings?: string[];
}

/**
 * Profils GF recommandés selon le type de plongée
 * Basés sur les recommandations actuelles de la communauté technique
 */
export const GF_PROFILES: { [key: string]: GradientFactorProfile } = {
  // Plongée loisir conservatrice
  RECREATIONAL_CONSERVATIVE: {
    name: "Loisir Conservateur",
    gfLow: 85,
    gfHigh: 85,
    description: "Profil conservateur pour plongée loisir, reste dans les M-values avec marge",
    useCase: "Plongées loisir < 30m, plongeurs occasionnels, conditions faciles",
    warnings: []
  },
  
  // Plongée loisir standard
  RECREATIONAL_STANDARD: {
    name: "Loisir Standard",
    gfLow: 70,
    gfHigh: 85,
    description: "Profil standard pour plongée loisir avec léger conservatisme",
    useCase: "Plongées loisir régulières, plongeurs expérimentés",
    warnings: []
  },
  
  // Plongée technique modérée
  TECHNICAL_MODERATE: {
    name: "Technique Modéré",
    gfLow: 40,
    gfHigh: 85,
    description: "Profil équilibré pour plongée technique peu profonde",
    useCase: "Plongées tech 40-60m, déco modérée, conditions normales",
    warnings: ["Nécessite formation technique appropriée"]
  },
  
  // Plongée technique conservatrice (recommandé par Mitchell)
  TECHNICAL_CONSERVATIVE: {
    name: "Technique Conservateur",
    gfLow: 30,
    gfHigh: 70,
    description: "Profil conservateur recommandé pour plongée technique profonde",
    useCase: "Plongées > 60m, trimix, longue déco, conditions difficiles",
    warnings: [
      "GF Low 30% recommandé par Dr Mitchell pour éviter les deep stops excessifs",
      "GF High 70-80% pour marge de sécurité en surface"
    ]
  },
  
  // Plongée technique agressive (non recommandé)
  TECHNICAL_AGGRESSIVE: {
    name: "Technique Agressif",
    gfLow: 20,
    gfHigh: 85,
    description: "Profil agressif avec deep stops profonds (usage déconseillé)",
    useCase: "Historiquement utilisé, maintenant considéré comme trop agressif",
    warnings: [
      "⚠️ GF Low < 30% peut causer une sous-saturation des tissus lents",
      "⚠️ Risque accru de DCS Type II selon études récentes",
      "⚠️ Non recommandé par les experts actuels"
    ]
  },
  
  // Altitude ou conditions spéciales
  ALTITUDE: {
    name: "Altitude/Conditions Spéciales",
    gfLow: 25,
    gfHigh: 65,
    description: "Profil très conservateur pour altitude ou conditions défavorables",
    useCase: "Plongée en altitude, eau froide, effort important, fatigue",
    warnings: [
      "Ajuster selon l'altitude réelle",
      "Considérer les facteurs personnels (âge, condition physique)"
    ]
  }
};

/**
 * Recommande un profil GF basé sur les paramètres de plongée
 * @param maxDepth Profondeur maximale en mètres
 * @param isNitrox Si utilisation de Nitrox
 * @param isTrimix Si utilisation de Trimix
 * @param experience Niveau d'expérience ("débutant", "intermédiaire", "expert")
 * @returns Profil GF recommandé
 */
export function recommendGradientFactors(
  maxDepth: number,
  isNitrox: boolean = false,
  isTrimix: boolean = false,
  experience: 'débutant' | 'intermédiaire' | 'expert' = 'intermédiaire'
): GradientFactorProfile {
  
  // Plongée trimix profonde
  if (isTrimix || maxDepth > 60) {
    return GF_PROFILES.TECHNICAL_CONSERVATIVE;
  }
  
  // Plongée technique (40-60m)
  if (maxDepth > 40) {
    if (experience === 'expert') {
      return GF_PROFILES.TECHNICAL_MODERATE;
    } else {
      return GF_PROFILES.TECHNICAL_CONSERVATIVE;
    }
  }
  
  // Plongée loisir profonde (30-40m)
  if (maxDepth > 30) {
    if (experience === 'débutant') {
      return GF_PROFILES.RECREATIONAL_CONSERVATIVE;
    } else {
      return GF_PROFILES.RECREATIONAL_STANDARD;
    }
  }
  
  // Plongée loisir peu profonde (< 30m)
  if (experience === 'débutant') {
    return GF_PROFILES.RECREATIONAL_CONSERVATIVE;
  } else {
    return GF_PROFILES.RECREATIONAL_STANDARD;
  }
}

/**
 * Valide si des GF sont dans les limites recommandées
 * @param gfLow GF Low en pourcentage
 * @param gfHigh GF High en pourcentage
 * @returns Validation avec avertissements
 */
export function validateGradientFactors(
  gfLow: number, 
  gfHigh: number
): { 
  valid: boolean; 
  warnings: string[] 
} {
  const warnings: string[] = [];
  
  // Vérifications de base
  if (gfLow <= 0 || gfHigh <= 0) {
    warnings.push("❌ Les GF doivent être > 0%");
    return { valid: false, warnings };
  }
  
  if (gfLow > 100 || gfHigh > 100) {
    warnings.push("❌ Les GF ne peuvent pas dépasser 100%");
    return { valid: false, warnings };
  }
  
  if (gfLow > gfHigh) {
    warnings.push("❌ GF Low doit être ≤ GF High");
    return { valid: false, warnings };
  }
  
  // Avertissements basés sur les recommandations actuelles
  if (gfLow < 20) {
    warnings.push("⚠️ GF Low < 20% est extrêmement agressif et déconseillé");
  } else if (gfLow < 30) {
    warnings.push("⚠️ GF Low < 30% peut causer des deep stops excessifs (non recommandé par Dr Mitchell)");
  }
  
  if (gfHigh > 95) {
    warnings.push("⚠️ GF High > 95% offre très peu de marge de sécurité");
  } else if (gfHigh > 85) {
    warnings.push("ℹ️ GF High > 85% est agressif, considérer une valeur plus conservatrice");
  }
  
  // Écart entre GF Low et High
  const spread = gfHigh - gfLow;
  if (spread > 60) {
    warnings.push("⚠️ Écart GF > 60% peut causer des profils de déco incohérents");
  }
  
  if (spread < 0) {
    warnings.push("❌ GF Low ne peut pas être supérieur à GF High");
    return { valid: false, warnings };
  }
  
  return { 
    valid: true, 
    warnings 
  };
}

/**
 * Formatte les GF pour l'affichage
 * @param gfLow GF Low en décimal (0-1)
 * @param gfHigh GF High en décimal (0-1)
 * @returns String formaté "GF XX/YY"
 */
export function formatGradientFactors(gfLow: number, gfHigh: number): string {
  const gfLowPct = Math.round(gfLow * 100);
  const gfHighPct = Math.round(gfHigh * 100);
  return `GF ${gfLowPct}/${gfHighPct}`;
}

/**
 * Informations pédagogiques sur les Gradient Factors
 */
export const GF_EDUCATION = {
  whatIsGF: `Les Gradient Factors (GF) sont une méthode pour ajuster le conservatisme du modèle Bühlmann.
    - GF 100% = limite M-value de Bühlmann (limite théorique)
    - GF < 100% = plus conservateur (marge de sécurité)
    - GF Low : appliqué au premier palier (profond)
    - GF High : appliqué en surface`,
  
  howToChoose: `Comment choisir ses GF :
    1. Évaluer le type de plongée (profondeur, durée, gaz)
    2. Considérer votre expérience et condition physique
    3. Prendre en compte les conditions (température, effort, altitude)
    4. Commencer conservateur et ajuster avec l'expérience
    5. Consulter les recommandations récentes (éviter GF Low < 30%)`,
  
  commonMistakes: [
    "Utiliser des GF trop agressifs sans expérience appropriée",
    "Copier les GF d'autres plongeurs sans comprendre",
    "Ne pas ajuster les GF selon les conditions",
    "Utiliser GF Low trop bas (< 30%) créant des deep stops excessifs",
    "Ignorer les facteurs personnels (âge, fatigue, déshydratation)"
  ],
  
  references: [
    "Mitchell SJ, Doolette DJ (2018) - Recommandations modernes sur les GF",
    "Erik Baker - Understanding M-values and Gradient Factors",
    "DAN Europe - Gradient Factors in Modern Decompression",
    "Subsurface Documentation - Gradient Factor Settings"
  ]
};