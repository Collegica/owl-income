// Canada's rules for 2026, in one place, each with its source. The engine
// works in 2026 dollars: brackets, credits and benefits are held constant in
// real terms, which is what indexing them to inflation every year amounts to.
// When the 2027 figures come out, add rules-2027.js and point app.js at it.

export const YEAR = 2026;

/** CPP: the age adjustment from canada.ca "When to start your CPP". */
export const CPP = {
  earlyPerMonth: 0.006, // −0.6% a month before 65, down to −36% at 60
  latePerMonth: 0.007, //  +0.7% a month after 65, up to +42% at 70
  max65Monthly: 1507.65, // 2026 maximum at 65 (canada.ca payment amounts)
  avg65Monthly: 858.34, // average new pension at 65, July 2026
};

/** OAS: Oct–Dec 2026 amounts, deferral, the age-75 increase, residence, clawback. */
export const OAS = {
  monthly65: 762.5, // age 65–74, Q4 2026 (canada.ca OAS payments)
  at75Increase: 0.1, // automatic 10% from 75
  deferralPerMonth: 0.006, // +0.6% a month after 65, up to +36% at 70
  fullYears: 40, // years in Canada after 18 for a full pension; partial = years/40, minimum 10
  minYears: 10,
  clawbackThreshold: 95323, // OAS recovery tax, 2026 income (canada.ca)
  clawbackRate: 0.15,
};

/** RRIF minimum factors, ages 71+ ("all other RRIFs", CRA chart of
 *  prescribed factors); under 71 the factor is 1 / (90 − age) (Reg. 7308(4)). */
export const RRIF_FACTORS = {
  71: 0.0528, 72: 0.054, 73: 0.0553, 74: 0.0567, 75: 0.0582, 76: 0.0598, 77: 0.0617,
  78: 0.0636, 79: 0.0658, 80: 0.0682, 81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808,
  85: 0.0851, 86: 0.0899, 87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192, 91: 0.1306,
  92: 0.1449, 93: 0.1634, 94: 0.1879,
};
export const RRIF_LAST_CONVERSION_AGE = 71; // convert by Dec 31 of the year you turn 71

export const TFSA = { annualLimit: 7000 };

/** Federal tax, 2026 (CRA rates; indexation table). Credits at the lowest rate. */
export const FEDERAL = {
  brackets: [[58523, 0.14], [117045, 0.205], [181440, 0.26], [258482, 0.29], [Infinity, 0.33]],
  creditRate: 0.14,
  bpaMax: 16452, bpaMin: 14829, bpaFrom: 181440, bpaTo: 258482,
  ageAmount: 9208, ageFrom: 46432, // reduced by 15% of net income above
  pensionAmount: 2000,
};

/** Provincial tax, 2026: brackets (CRA rates page), credits (CRA TD1ON, TD1BC,
 *  TD1AB 2026), and the surtax, health premium and reductions (CRA T4127,
 *  122nd edition, January 2026). */
export const PROVINCES = {
  ON: {
    name: 'Ontario',
    brackets: [[53891, 0.0505], [107785, 0.0915], [150000, 0.1116], [220000, 0.1216], [Infinity, 0.1316]],
    creditRate: 0.0505,
    bpa: 12989, ageAmount: 6342, ageFrom: 47210, pensionAmount: 1796,
    surtax: [[5818, 0.2], [7446, 0.36]], // % of basic Ontario tax above each threshold
    reductionBase: 300, // Ontario tax reduction: 2 × $300 − (basic tax + surtax)
    healthPremium: true,
  },
  BC: {
    name: 'British Columbia',
    brackets: [[50363, 0.056], [100728, 0.077], [115648, 0.105], [140430, 0.1229], [190405, 0.147], [265545, 0.168], [Infinity, 0.205]],
    creditRate: 0.056,
    bpa: 13216, ageAmount: 5927, ageFrom: 44119, pensionAmount: 1000,
    bcReduction: { max: 575, from: 25570, to: 41722, rate: 0.0356 },
  },
  AB: {
    name: 'Alberta',
    brackets: [[61200, 0.08], [154259, 0.1], [185111, 0.12], [246813, 0.13], [370220, 0.14], [Infinity, 0.15]],
    creditRate: 0.08,
    bpa: 22769, ageAmount: 6345, ageFrom: 47234, pensionAmount: 1753,
    supplemental: { threshold: 4896, rate: 0.25 }, // T4127 factor K5P
  },
};

/** FP Canada / Institute of Financial Planning, Projection Assumption
 *  Guidelines 2026 (April 2026): geometric, nominal, before fees. Volatility
 *  and correlations: the 2026 addendum, 20 years of annual data (2006–2025). */
export const PAG = {
  inflation: 0.021,
  fixedIncome: 0.032,
  equities: { canada: 0.063, us: 0.064, international: 0.066 },
  equityMonteCarloAddBack: 0.005, // the guidelines' equity safety margin, added back for Monte Carlo
  sd: { fixedIncome: 0.0479, canada: 0.1629, us: 0.1553, international: 0.1461 },
  corr: {
    canada_us: 0.5044, canada_international: 0.6198, us_international: 0.7445,
    fi_canada: 0.0065, fi_us: 0.1174, fi_international: -0.0375,
  },
  /** Age with a 25% chance of still being alive, from 65 (the guidelines' recommended horizon). */
  horizon25: { male: 94, female: 96 },
};
