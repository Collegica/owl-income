// The retirement income engine: one person, one year at a time, in 2026
// dollars. Each year: guaranteed income arrives, the RRIF minimum is taken,
// the rest of the spending is drawn from the accounts in the chosen order
// (solving for the tax, so spending is after tax), any surplus is saved, and
// the accounts earn that year's real return. No DOM, so `npm test` can check
// every rule; app.js draws the results.

import { CPP, OAS, RRIF_FACTORS, RRIF_LAST_CONVERSION_AGE, TFSA, PAG } from './rules-2026.js';
import { incomeTax } from './tax.js';

/** CPP at a start age, as a multiple of the amount at 65. */
export function cppFactor(startAge) {
  const m = Math.round((startAge - 65) * 12);
  return m < 0 ? 1 + CPP.earlyPerMonth * Math.max(m, -60) : 1 + CPP.latePerMonth * Math.min(m, 60);
}

/** OAS at a start age (65–70), as a multiple of the amount at 65. */
export function oasFactor(startAge) {
  return 1 + OAS.deferralPerMonth * Math.min(60, Math.max(0, Math.round((startAge - 65) * 12)));
}

/** The RRIF minimum factor for the age on January 1. */
export function rrifFactor(age) {
  if (age < 71) return 1 / (90 - age);
  return age >= 95 ? 0.2 : RRIF_FACTORS[age];
}

/** Annual OAS before clawback, in 2026 dollars. */
export function oasAnnual(age, startAge, yearsInCanada) {
  if (age < startAge || yearsInCanada < OAS.minYears) return 0;
  const residence = Math.min(yearsInCanada, OAS.fullYears) / OAS.fullYears;
  return OAS.monthly65 * 12 * residence * oasFactor(startAge) * (age >= 75 ? 1 + OAS.at75Increase : 1);
}

/** Expected returns from the FP Canada guidelines for a stock/bond mix. Equities
 *  are a third each Canadian, US and international. `fee` comes off both.
 *  Returns { real, sd } (geometric real return and standard deviation). */
export function portfolioAssumptions(stockShare, fee = 0, { monteCarlo = false } = {}) {
  const e = PAG.equities;
  const eqNominal = (e.canada + e.us + e.international) / 3 + (monteCarlo ? PAG.equityMonteCarloAddBack : 0);
  const nominal = stockShare * eqNominal + (1 - stockShare) * PAG.fixedIncome - fee;
  const s = PAG.sd, c = PAG.corr, w = stockShare / 3, b = 1 - stockShare;
  const legs = [[w, s.canada, 'canada'], [w, s.us, 'us'], [w, s.international, 'international'], [b, s.fixedIncome, 'fi']];
  const R = {
    canada: { us: c.canada_us, international: c.canada_international, fi: c.fi_canada },
    us: { canada: c.canada_us, international: c.us_international, fi: c.fi_us },
    international: { canada: c.canada_international, us: c.us_international, fi: c.fi_international },
    fi: { canada: c.fi_canada, us: c.fi_us, international: c.fi_international },
  };
  let variance = 0;
  for (const [wa, sa, a] of legs) for (const [wz, sz, z] of legs) variance += wa * wz * sa * sz * (a === z ? 1 : R[a][z]);
  return { real: (1 + nominal) / (1 + PAG.inflation) - 1, sd: Math.sqrt(variance) };
}

const DEFAULTS = {
  age: 65, horizon: 95, province: 'ON',
  needs: 40000, wants: 15000, wishes: 0, contingency: 0,
  cpp65Monthly: CPP.avg65Monthly, cppStart: 65,
  oasYears: 40, oasStart: 65,
  pension: 0, pensionStart: 65, pensionIndexed: true,
  rrsp: 0, tfsa: 0, nonReg: 0, nonRegGain: 0.3,
  rrifAge: RRIF_LAST_CONVERSION_AGE, // RRSP becomes a RRIF at this age (minimums from the next year)
  tfsaRoom: 0, stocks: 0.5, fee: 0.005,
  rule: 'fixed', // 'fixed' | 'vanguard' | 'guardrails'
  // 'meltdown': each year draw the RRSP/RRIF up to `fillTo` of taxable income
  //   (saving any surplus, TFSA first), then non-registered, then TFSA;
  // 'conventional': non-registered, then RRSP/RRIF, then TFSA;
  // 'pro-rata': a share of every account.
  order: 'meltdown',
  fillTo: 58523, // the top of the lowest federal bracket, 2026
  taxes: true,
};

/** Fill in defaults and validate a plan. */
export function normalise(plan) {
  const p = { ...DEFAULTS, ...plan };
  p.horizon = Math.max(p.horizon, p.age + 1);
  p.contingency = Math.min(p.contingency, p.nonReg + p.tfsa + p.rrsp);
  return p;
}

/** Bisection: the smallest x in [0, hi] with f(x) >= target (f increasing). */
function solve(f, target, hi) {
  if (hi <= 0 || f(hi) < target) return hi;
  let lo = 0;
  for (let i = 0; i < 60 && hi - lo > 0.01; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= target) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * Project a plan. `returns` is an array of real portfolio returns, one per
 * year (missing years use the last value). Returns { rows, essentialsFailAge,
 * finalWealth, firstWithdrawalRate }.
 */
export function project(plan, returns) {
  const p = normalise(plan);
  const years = p.horizon - p.age;
  const r = i => returns[Math.min(i, returns.length - 1)];

  // The contingency fund is set aside first, taken from non-registered, then TFSA.
  let reserve = p.contingency;
  let nonReg = p.nonReg, tfsa = p.tfsa;
  const fromNon = Math.min(nonReg, reserve); nonReg -= fromNon; reserve -= fromNon;
  const fromTfsa = Math.min(tfsa, reserve); tfsa -= fromTfsa;
  let acb = p.nonReg > 0 ? (nonReg) * (1 - p.nonRegGain) : 0;
  let rrsp = p.rrsp, room = p.tfsaRoom;
  const target = p.needs + p.wants + p.wishes;

  const guaranteed = age => {
    const cpp = age >= p.cppStart ? p.cpp65Monthly * 12 * cppFactor(p.cppStart) : 0;
    const oas = oasAnnual(age, p.oasStart, p.oasYears);
    const db = age >= p.pensionStart ? p.pension : 0;
    return { cpp, oas, db };
  };

  const g0 = guaranteed(p.age);
  const portfolio0 = nonReg + tfsa + rrsp;
  const firstWithdrawalRate = portfolio0 > 0 ? Math.max(0, target - (g0.cpp + g0.oas + g0.db)) / portfolio0 : Infinity;

  const rows = [];
  let essentialsFailAge = null, prevDraw = null, prevReturn = 0, wr0 = null;

  for (let i = 0; i < years; i++) {
    const age = p.age + i;
    const { cpp, oas, db } = guaranteed(age);
    const fixedIncome = cpp + oas + db;
    const rrifMinimum = age >= p.rrifAge + 1 ? rrsp * rrifFactor(age) : 0;
    const fill = p.order === 'meltdown' ? Math.min(rrsp, Math.max(0, p.fillTo - fixedIncome)) : 0;
    const rrifMin = Math.max(rrifMinimum, fill); // the RRSP/RRIF amount drawn regardless of spending
    const pensionEligible = (rrif) => (age >= 65 && age >= p.rrifAge + 1 ? rrif : 0) + db;

    // Draw `x` beyond the RRIF minimum, in the chosen order. Returns the accounts touched.
    const plan = x => {
      let left = x, n = 0, rr = 0, t = 0;
      const total = nonReg + Math.max(0, rrsp - rrifMin) + tfsa;
      if (p.order === 'pro-rata' && total > 0) {
        const k = Math.min(1, x / total);
        n = nonReg * k; rr = Math.max(0, rrsp - rrifMin) * k; t = tfsa * k;
      } else if (p.order === 'meltdown') {
        n = Math.min(left, nonReg); left -= n;
        t = Math.min(left, tfsa); left -= t;
        rr = Math.min(left, Math.max(0, rrsp - rrifMin));
      } else {
        n = Math.min(left, nonReg); left -= n;
        rr = Math.min(left, Math.max(0, rrsp - rrifMin)); left -= rr;
        t = Math.min(left, tfsa);
      }
      return { n, rr, t };
    };
    const yearTax = ({ n, rr }) => {
      const gain = nonReg > 0 ? n * Math.max(0, 1 - acb / nonReg) : 0;
      const rrif = rrifMin + rr;
      const income = fixedIncome + rrif + gain * 0.5;
      return p.taxes ? incomeTax({ income, oas, pension: pensionEligible(rrif), age, province: p.province }) : { total: 0, clawback: 0 };
    };
    const netCash = x => { const d = plan(x); return fixedIncome + rrifMin + d.n + d.rr + d.t - yearTax(d).total; };

    // The spending rule decides the target: after-tax spending (fixed), or the
    // gross amount drawn from the portfolio (Vanguard cap, guardrails).
    const balance = nonReg + tfsa + rrsp;
    const room0 = nonReg + Math.max(0, rrsp - rrifMin) + tfsa;
    let extra;
    if (p.rule === 'fixed') {
      extra = solve(netCash, target, room0);
    } else {
      if (prevDraw === null) {
        extra = solve(netCash, target, room0);
        prevDraw = rrifMin + extra;
        wr0 = balance > 0 ? prevDraw / balance : 0;
      } else {
        let draw;
        if (p.rule === 'vanguard') {
          draw = Math.min(prevDraw * 1.05, Math.max(prevDraw * 0.975, wr0 * balance));
        } else {
          draw = prevDraw;
          const wr = balance > 0 ? draw / balance : Infinity;
          if (prevReturn < 0 && wr > wr0) draw /= 1 + PAG.inflation; // skip the inflation raise
          const wrNow = balance > 0 ? draw / balance : Infinity;
          if (wrNow > wr0 * 1.2 && years - i > 15) draw *= 0.9; // capital preservation
          else if (wrNow < wr0 * 0.8) draw *= 1.1; // prosperity
        }
        prevDraw = draw;
        extra = Math.min(room0, Math.max(0, draw - rrifMin));
      }
    }

    const d = plan(extra);
    const tax = yearTax(d);
    const gross = fixedIncome + rrifMin + d.n + d.rr + d.t;
    let spending = gross - tax.total;
    // Anything above the target (a large RRIF minimum, say) is saved: TFSA first.
    let saved = 0;
    if (p.rule === 'fixed' && spending > target + 1) {
      saved = spending - target; spending = target;
    }
    const realised = nonReg > 0 ? d.n * Math.max(0, 1 - acb / nonReg) : 0;
    acb -= d.n - realised;
    nonReg -= d.n; rrsp -= rrifMin + d.rr; tfsa -= d.t;
    const toTfsa = Math.min(saved, room); room -= toTfsa; tfsa += toTfsa;
    nonReg += saved - toTfsa; acb += saved - toTfsa;
    room += TFSA.annualLimit + d.t;

    const essentialsMet = spending + 1 >= p.needs;
    if (!essentialsMet && essentialsFailAge === null) essentialsFailAge = age;

    const ret = r(i);
    nonReg *= 1 + ret; tfsa *= 1 + ret; rrsp *= 1 + ret; reserve *= 1 + ret;
    prevReturn = ret;

    rows.push({
      age, spending, cpp, oas, pension: db, rrifMin,
      fromNonReg: d.n, fromRrsp: rrifMin + d.rr, fromTfsa: d.t,
      tax: tax.total, clawback: tax.clawback, saved,
      nonReg, tfsa, rrsp, reserve, total: nonReg + tfsa + rrsp,
      essentialsMet, rrifMinimum,
    });
  }
  const last = rows[rows.length - 1];
  // Vanguard's convention: the first age the accounts are empty.
  const empty = rows.find(r => r.total <= 1);
  return {
    rows, essentialsFailAge, emptyAge: empty ? empty.age + 1 : null,
    finalWealth: last ? last.total + last.reserve : 0, firstWithdrawalRate,
    lifetimeTax: rows.reduce((s, r) => s + r.tax, 0),
  };
}

/** A small, seeded random generator (mulberry32), so results are repeatable. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand) {
  let u = 0; while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Random real returns for one path: lognormal around the guidelines' geometric return. */
export function randomReturns(years, stocks, fee, rand) {
  const { real, sd } = portfolioAssumptions(stocks, fee, { monteCarlo: true });
  const mu = Math.log(1 + real), sigma = Math.log(1 + sd / (1 + real));
  return Array.from({ length: years }, () => Math.exp(mu + sigma * normal(rand)) - 1);
}

/** Run `paths` random futures. Returns the share of paths where essentials are
 *  covered to the horizon, and percentile bands of wealth and spending by age. */
export function monteCarlo(plan, { paths = 1000, seed = 2026 } = {}) {
  const p = normalise(plan);
  const rand = rng(seed);
  const years = p.horizon - p.age;
  const runs = [];
  for (let k = 0; k < paths; k++) runs.push(project(p, randomReturns(years, p.stocks, p.fee, rand)));
  const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const ages = runs[0].rows.map(r => r.age);
  const band = key => ages.map((_, i) => {
    const v = runs.map(r => r.rows[i][key]);
    return { p10: pct(v, 0.1), p50: pct(v, 0.5), p90: pct(v, 0.9) };
  });
  return {
    successRate: runs.filter(r => r.essentialsFailAge === null).length / paths,
    ages, wealth: band('total'), spending: band('spending'),
    failAges: runs.map(r => r.essentialsFailAge).filter(a => a !== null),
  };
}

/** A typical and a poor market as constant real returns: the median and the
 *  25th percentile of a 30-year annualised return, as Vanguard's Figure 4 does. */
export function scenarios(stocks, fee, years = 30) {
  const { real, sd } = portfolioAssumptions(stocks, fee);
  return { typical: real, poor: real - 0.674 * sd / Math.sqrt(years) };
}
