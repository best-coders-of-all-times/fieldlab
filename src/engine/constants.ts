/**
 * Physical constants (SI) and numerical conventions.
 */
export const PI = Math.PI;
export const TWO_PI = 2 * Math.PI;

export const EPS0 = 8.8541878128e-12; // F/m
export const MU0 = 1.25663706212e-6; // H/m
export const C_LIGHT = 299_792_458; // m/s
export const K_E = 1 / (4 * PI * EPS0); // N m²/C²
export const E_CHARGE = 1.602176634e-19; // C
export const M_ELECTRON = 9.1093837015e-31; // kg
export const M_PROTON = 1.67262192369e-27; // kg
export const ATOMIC_MASS = 1.66053906660e-27; // kg

/** Softening radius used when sampling singular fields for display. */
export const FIELD_SOFTENING = 1e-4; // metres

/** Numeric guard for divisions. */
export const EPS = 1e-12;
