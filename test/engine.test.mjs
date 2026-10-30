import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cppFactor, oasFactor, oasAnnual, rrifFactor, project, monteCarlo, portfolioAssumptions, rng } from '../src/engine.js';
import { incomeTax, oasClawback, bracketTax, ontarioHealthPremium } from '../src/tax.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);

// ---- Canada's rules, against canada.ca's own numbers ----

test('CPP: −36% at 60, +42% at 70 (canada.ca)', () => {
  near(cppFactor(60), 0.64, 1e-9); near(cppFactor(65), 1, 1e-9); near(cppFactor(70), 1.42, 1e-9);
  near(cppFactor(72), 1.42, 1e-9, 'no gain after 70');
});

test('OAS: $762.50 at 65 becomes $1,037.00 at 70 (canada.ca example)', () => {
  near(762.5 * oasFactor(70), 1037, 0.01);
  near(oasAnnual(75, 65, 40) / 12, 838.75, 0.01, '+10% at 75');
  near(oasAnnual(66, 65, 20) / 12, 381.25, 0.01, 'partial: 20/40 years');
  assert.equal(oasAnnual(66, 65, 9), 0, 'under 10 years: none');
});

test('OAS clawback: canada.ca 2025 example ($100,000 → $981.90) and 2026 threshold', () => {
  near(oasClawback(100000, 9000, 93454), 981.9, 0.01);
  near(oasClawback(100000, 9000), (100000 - 95323) * 0.15, 0.01);
  near(oasClawback(300000, 9150), 9150, 0.01, 'capped at the OAS received');
});

test('RRIF factors: 1/(90−age) under 71, then the CRA table', () => {
  near(rrifFactor(65), 0.04, 1e-9); near(rrifFactor(70), 0.05, 1e-9);
  assert.equal(rrifFactor(71), 0.0528); assert.equal(rrifFactor(80), 0.0682);
  assert.equal(rrifFactor(95), 0.2); assert.equal(rrifFactor(101), 0.2);
});

test('tax: brackets and credits by hand for an Ontario retiree', () => {
  // $50,000 of RRIF and CPP income, age 70, $20,000 of it RRIF (pension-eligible).
  const t = incomeTax({ income: 50000, oas: 0, pension: 20000, age: 70, province: 'ON' });
  const fed = 50000 * 0.14 - (16452 + (9208 - 0.15 * (50000 - 46432)) + 2000) * 0.14;
  near(t.federal, fed, 0.01, 'federal');
  const onBasic = 50000 * 0.0505 - (12989 + (6342 - 0.15 * (50000 - 47210)) + 1796) * 0.0505;
  near(t.provincial, onBasic, 0.01, 'Ontario (no surtax, no reduction at this income)');
  near(t.healthPremium, 450 + 0.25 * 2000 > 600 ? 600 : 450 + 0.25 * 2000, 0.01, 'health premium');
});

test('tax: Ontario surtax and health premium tiers (T4127)', () => {
  near(ontarioHealthPremium(20000), 0, 0); near(ontarioHealthPremium(25000), 300, 0);
  near(ontarioHealthPremium(40000), 450, 0); near(ontarioHealthPremium(60000), 600, 0);
  near(ontarioHealthPremium(100000), 750, 0); near(ontarioHealthPremium(300000), 900, 0);
  near(bracketTax(100, [[50, 0.1], [Infinity, 0.2]]), 15, 1e-9);
  const hi = incomeTax({ income: 200000, age: 60, province: 'ON' });
  assert.ok(hi.provincial > bracketTax(200000, [[53891, 0.0505], [107785, 0.0915], [150000, 0.1116], [220000, 0.1216]]) - 700, 'surtax applies at high income');
});

test('tax: BC and Alberta low-income retirees pay little or no provincial tax', () => {
  assert.equal(incomeTax({ income: 24000, age: 70, province: 'BC' }).provincial, 0);
  // Alberta: $22,769 + $6,345 of credits at 8% cover income up to $29,114.
  assert.equal(incomeTax({ income: 29000, age: 70, province: 'AB' }).provincial, 0);
  near(incomeTax({ income: 30000, age: 70, province: 'AB' }).provincial, (30000 - 29114) * 0.08, 0.01);
});

// ---- Vanguard's deterministic figures, reproduced (no tax, TFSA only) ----

const tfsaOnly = (balance, spend, age, horizon) => ({
  age, horizon, rrsp: 0, nonReg: 0, tfsa: balance, needs: spend, wants: 0, wishes: 0,
  cpp65Monthly: 0, oasYears: 0, taxes: false, rule: 'fixed',
});

test('Vanguard Figure 2: $500k at 5%, withdrawals growing 2% → $843k / $404k / runs out', () => {
  // In real terms: a 2%-growing withdrawal is constant; the 5% return is 1.05/1.02 − 1.
  const real = 1.05 / 1.02 - 1;
  const after30 = rate => {
    const r = project(tfsaOnly(500000, 500000 * rate, 66, 66 + 30), [real]);
    return r.rows[29].total * 1.02 ** 30;
  };
  near(after30(0.03), 842916, 50, '3%');
  near(after30(0.04), 403565, 50, '4%');
  const five = project(tfsaOnly(500000, 25000, 66, 66 + 31), [real]);
  assert.equal(five.essentialsFailAge, 66 + 29, '5% runs out in year 30');
});

test('Vanguard Figure 4: $1M at 66, 6% → empty at 91 (5.80%) and 88 (4.81%)', () => {
  // Vanguard reports the age the money is gone; spending first falls short a year earlier.
  const run = nominal => project(tfsaOnly(1e6, 60000, 66, 100), [(1 + nominal) / 1.02 - 1]);
  assert.equal(run(0.058).emptyAge, 91); assert.equal(run(0.058).essentialsFailAge, 90);
  assert.equal(run(0.0481).emptyAge, 88); assert.equal(run(0.0481).essentialsFailAge, 87);
});

// ---- Invariants on random plans ----

test('random plans: balances never negative, RRIF minimum always taken', () => {
  const rand = rng(7);
  for (let k = 0; k < 200; k++) {
    const plan = {
      age: 60 + Math.floor(rand() * 15), horizon: 95, province: ['ON', 'BC', 'AB'][k % 3],
      needs: 20000 + rand() * 50000, wants: rand() * 30000,
      rrsp: rand() * 1e6, tfsa: rand() * 2e5, nonReg: rand() * 5e5,
      cppStart: 60 + Math.floor(rand() * 11), oasStart: 65 + Math.floor(rand() * 6),
      rule: ['fixed', 'vanguard', 'guardrails'][k % 3], order: ['meltdown', 'conventional', 'pro-rata'][k % 3],
    };
    const returns = Array.from({ length: 40 }, () => (rand() - 0.4) * 0.3);
    const { rows } = project(plan, returns);
    for (const r of rows) {
      assert.ok(r.nonReg >= -0.01 && r.tfsa >= -0.01 && r.rrsp >= -0.01, `negative balance at ${r.age}`);
      assert.ok(r.fromRrsp + 0.01 >= r.rrifMinimum, 'RRIF minimum taken');
      assert.ok(r.tax >= 0 && r.spending >= -0.01);
    }
  }
});

test('withdrawal order: leaving the RRSP to last costs more tax than drawing evenly', () => {
  // A finding, not a rule: RRIF minimums later in life push income into higher
  // brackets. Checked on a plan that lasts and on one that defers CPP and OAS.
  const plans = [
    { age: 65, horizon: 95, rrsp: 900000, tfsa: 150000, nonReg: 400000, needs: 50000, wants: 20000 },
    { age: 62, horizon: 95, rrsp: 700000, tfsa: 100000, nonReg: 200000, needs: 45000, wants: 15000, cppStart: 70, oasStart: 70 },
  ];
  for (const plan of plans) {
    const tax = order => project({ ...plan, order }, [0.03]).lifetimeTax;
    assert.ok(tax('conventional') > tax('pro-rata'), `${tax('conventional')} vs ${tax('pro-rata')}`);
  }
});

test('the RRSP meltdown draws the RRSP up to the target income each year', () => {
  const plan = { age: 62, horizon: 70, rrsp: 700000, tfsa: 0, nonReg: 200000, needs: 30000, wants: 0,
    cppStart: 70, oasStart: 70, order: 'meltdown', fillTo: 58523 };
  const { rows } = project(plan, [0.03]);
  near(rows[0].fromRrsp, 58523, 1, 'fills the lowest bracket while no CPP or OAS is paid');
  assert.ok(rows[0].saved > 0, 'the surplus beyond spending is saved');
});

test('Monte Carlo is repeatable with a seed, and assumptions are sensible', () => {
  const plan = { age: 65, horizon: 95, rrsp: 500000, tfsa: 100000, needs: 40000, wants: 10000 };
  const a = monteCarlo(plan, { paths: 200, seed: 1 }), b = monteCarlo(plan, { paths: 200, seed: 1 });
  assert.equal(a.successRate, b.successRate);
  const { real, sd } = portfolioAssumptions(0.5, 0);
  assert.ok(real > 0.015 && real < 0.04, `real ${real}`);
  assert.ok(sd > 0.06 && sd < 0.1, `sd ${sd}`);
});

test('flexible rules move spending, not the draw: never above target in year one, never below needs while money lasts', () => {
  const plan = { age: 65, horizon: 96, needs: 36000, wants: 12000, contingency: 25000, cpp65Monthly: 858,
    rrsp: 500000, tfsa: 100000, nonReg: 150000, order: 'meltdown' };
  for (const rule of ['vanguard', 'guardrails']) {
    for (const ret of [-0.01, 0.0217, 0.06]) {
      const { rows } = project({ ...plan, rule }, [ret]);
      near(rows[0].spending, 48000, 1, `${rule} year one`);
      assert.ok(rows[0].saved > 0, 'the meltdown surplus is saved, not spent');
      for (const r of rows) if (r.total > 1000) assert.ok(r.spending + 1 >= 36000, `${rule} at ${ret}: ${r.spending} at ${r.age}`);
      for (let k = 1; k < rows.length && rule === 'vanguard'; k++) {
        if (rows[k].total > 1000 && rows[k].spending > 36001) assert.ok(rows[k].spending <= rows[k - 1].spending * 1.05 + 1, 'up 5% at most');
      }
    }
  }
});
