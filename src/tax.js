// Personal income tax for one person in one year, federal plus Ontario, BC or
// Alberta, in 2026 dollars, following CRA's payroll formulas (T4127) where
// they apply to pension income. Covers what a retiree's return usually needs:
// brackets, the basic personal, age and pension amounts, Ontario's surtax,
// health premium and tax reduction, BC's tax reduction, Alberta's
// supplemental credit, and the OAS recovery tax. Not covered: dividends,
// medical and donation credits, foreign income, Quebec.

import { FEDERAL, PROVINCES, OAS } from './rules-2026.js';

export function bracketTax(income, brackets) {
  let tax = 0, lower = 0;
  for (const [upper, rate] of brackets) {
    if (income <= lower) break;
    tax += (Math.min(income, upper) - lower) * rate;
    lower = upper;
  }
  return tax;
}

const clamp0 = x => Math.max(0, x);

/** The OAS recovery tax: 15% of net income above the threshold, at most the OAS received. */
export function oasClawback(netIncomeBefore, oasReceived, threshold = OAS.clawbackThreshold) {
  return Math.min(oasReceived, clamp0(netIncomeBefore - threshold) * OAS.clawbackRate);
}

/** Ontario Health Premium (T4127 factor V2), on taxable income. */
export function ontarioHealthPremium(A) {
  if (A <= 20000) return 0;
  if (A <= 36000) return Math.min(300, 0.06 * (A - 20000));
  if (A <= 48000) return Math.min(450, 300 + 0.06 * (A - 36000));
  if (A <= 72000) return Math.min(600, 450 + 0.25 * (A - 48000));
  if (A <= 200000) return Math.min(750, 600 + 0.25 * (A - 72000));
  return Math.min(900, 750 + 0.25 * (A - 200000));
}

/**
 * Tax for one year.
 *   income:   total income before the OAS repayment deduction (CPP, OAS, RRIF/RRSP
 *             withdrawals, pension, taxable half of capital gains)
 *   oas:      OAS received (for the recovery tax)
 *   pension:  income eligible for the pension amount (RRIF at 65+, registered pension)
 *   age:      age at the end of the year
 *   province: 'ON' | 'BC' | 'AB'
 * Returns { federal, provincial, healthPremium, clawback, total, netIncome }.
 */
export function incomeTax({ income, oas = 0, pension = 0, age, province }) {
  const clawback = oasClawback(income, oas);
  const net = clamp0(income - clawback); // the repayment is deducted (line 23500)
  const old = age >= 65;

  // Federal
  const F = FEDERAL;
  const bpa = net <= F.bpaFrom ? F.bpaMax
    : net >= F.bpaTo ? F.bpaMin
    : F.bpaMax - (F.bpaMax - F.bpaMin) * (net - F.bpaFrom) / (F.bpaTo - F.bpaFrom);
  const fedCredits = (bpa
    + (old ? clamp0(F.ageAmount - 0.15 * clamp0(net - F.ageFrom)) : 0)
    + Math.min(F.pensionAmount, pension)) * F.creditRate;
  const federal = clamp0(bracketTax(net, F.brackets) - fedCredits);

  // Provincial
  const P = PROVINCES[province];
  if (!P) throw new Error(`Unsupported province: ${province}`);
  let credits = (P.bpa
    + (old ? clamp0(P.ageAmount - 0.15 * clamp0(net - P.ageFrom)) : 0)
    + Math.min(P.pensionAmount, pension)) * P.creditRate;
  if (P.supplemental) credits += clamp0(credits - P.supplemental.threshold) * P.supplemental.rate;
  let basic = clamp0(bracketTax(net, P.brackets) - credits);
  if (P.surtax) basic += P.surtax.reduce((s, [t, r]) => s + clamp0(basic - t) * r, 0);
  if (P.reductionBase) basic -= Math.min(basic, clamp0(2 * P.reductionBase - basic));
  if (P.bcReduction) {
    const { max, from, to, rate } = P.bcReduction;
    const red = net <= from ? max : net <= to ? clamp0(max - (net - from) * rate) : 0;
    basic -= Math.min(basic, red);
  }
  const healthPremium = P.healthPremium ? ontarioHealthPremium(net) : 0;
  const provincial = basic;

  return { federal, provincial, healthPremium, clawback, total: federal + provincial + healthPremium + clawback, netIncome: net };
}
