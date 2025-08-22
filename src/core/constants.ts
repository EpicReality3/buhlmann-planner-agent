/**
 * Constantes du modèle Bühlmann ZH-L16C
 * Référence: Bühlmann, A.A. (1995). Tauchmedizin. Springer-Verlag.
 * Les valeurs correspondent aux tables publiées pour ZH-L16C
 */

// Pressions atmosphériques et physiques
export const SURFACE_PRESSURE = 1.01325;      // bar (pression atmosphérique au niveau de la mer)
export const WATER_VAPOUR_PRESSURE = 0.0627;  // bar (pression vapeur d'eau dans les poumons à 37°C)
export const PRESSURE_PER_METER = 0.1;        // bar/m (augmentation de pression par mètre d'eau)

/**
 * Demi-vies des 16 compartiments tissulaires (en minutes)
 * Compartiments 1-16 du plus rapide au plus lent
 */
export const HALF_TIMES_N2 = [5.0,8.0,12.5,18.5,27.0,38.3,54.3,77.0,109.0,146.0,187.0,239.0,305.0,390.0,498.0,635.0];
export const HALF_TIMES_HE = [1.88,3.02,4.72,6.99,10.21,14.48,20.53,29.11,41.20,55.19,70.69,90.34,115.29,147.42,188.24,240.03];

/**
 * Coefficients a et b de Bühlmann pour l'azote (N₂)
 * Utilisés dans le calcul des M-values : M = a + b * P
 * Référence: Tables ZH-L16C de Bühlmann
 */
export const A_N2 = [1.1696,1.0,0.8618,0.7562,0.6667,0.5933,0.5282,0.4701,0.4187,0.3798,0.3497,0.3223,0.2971,0.2737,0.2523,0.2327];
export const B_N2 = [0.5578,0.6514,0.7222,0.7825,0.8126,0.8434,0.8693,0.8910,0.9092,0.9222,0.9319,0.9403,0.9477,0.9544,0.9602,0.9653];

/**
 * Coefficients a et b de Bühlmann pour l'hélium (He)
 * Adaptés pour les mélanges trimix
 */
export const A_HE = [1.6189,1.3830,1.1919,1.0458,0.9220,0.8205,0.7305,0.6502,0.5950,0.5545,0.5333,0.5189,0.5181,0.5176,0.5172,0.5119];
export const B_HE = [0.4770,0.5747,0.6527,0.7223,0.7582,0.7957,0.8279,0.8553,0.8757,0.8903,0.8997,0.9073,0.9122,0.9171,0.9217,0.9267];
