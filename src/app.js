// OWL Income: turn savings into a retirement paycheque, in Canada. The form
// follows Vanguard's seven steps (spending, withdrawal rate, risks, income
// floor, taxes, flexibility, simplicity) with Canada's 2026 rules; engine.js
// does the arithmetic. Everything runs in the tab; the plan is remembered on
// this device only if you ask.

import { CollegicaApp, baseStyles } from './collegica.js';
import { project, monteCarlo, scenarios, cppFactor } from './engine.js';
import { PROVINCES, PAG, CPP } from './rules-2026.js';

const money = n => (n == null || !isFinite(n)) ? '—' : '$' + Math.round(n).toLocaleString('en-CA');
const pct = (n, d = 1) => (n == null || !isFinite(n)) ? '—' : (n * 100).toFixed(d) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FIELDS = [
  { step: 'You', items: [
    ['age', 'Your age now', 'number', 65, { min: 50, max: 90 }],
    ['sex', 'Plan as', 'select', 'female', { options: [['female', 'Female (plan to 96)'], ['male', 'Male (plan to 94)']] }],
    ['horizon', 'Plan to age', 'number', 96, { min: 70, max: 105, hint: 'FP Canada suggests the age you have a 25% chance of reaching: about 94 for men and 96 for women at 65.' }],
    ['province', 'Province', 'select', 'ON', { options: Object.entries(PROVINCES).map(([k, v]) => [k, v.name]) }],
  ] },
  { step: '1. What you spend, a year, in today\'s dollars', items: [
    ['needs', 'Needs: housing, food, utilities, insurance', 'money', 36000],
    ['wants', 'Wants: travel, dining, hobbies', 'money', 12000],
    ['wishes', 'Wishes: gifts, giving', 'money', 0],
    ['contingency', 'Contingency fund set aside (roof, car, care)', 'money', 25000, { hint: 'Kept invested but not counted on for income.' }],
  ] },
  { step: '4. Income that doesn\'t depend on markets', items: [
    ['cpp65Monthly', 'CPP at 65, a month', 'money', 858, { hint: `From your Service Canada statement. The 2026 average at 65 is ${money(CPP.avg65Monthly)}; the maximum ${money(CPP.max65Monthly)}.` }],
    ['cppStart', 'Start CPP at', 'number', 65, { min: 60, max: 70 }],
    ['oasYears', 'Years in Canada after 18', 'number', 40, { min: 0, max: 40, hint: '40 for a full OAS pension; at least 10 for any.' }],
    ['oasStart', 'Start OAS at', 'number', 65, { min: 65, max: 70 }],
    ['pension', 'Workplace pension, a year', 'money', 0],
    ['pensionStart', 'Pension starts at', 'number', 65, { min: 50, max: 75 }],
  ] },
  { step: 'Your savings', items: [
    ['rrsp', 'RRSP / RRIF', 'money', 500000],
    ['tfsa', 'TFSA', 'money', 100000],
    ['tfsaRoom', 'Unused TFSA room', 'money', 0],
    ['nonReg', 'Non-registered', 'money', 150000],
    ['nonRegGainPct', 'Of which unrealised gain (%)', 'number', 30, { min: 0, max: 100 }],
    ['stocksPct', 'In stocks (%)', 'number', 50, { min: 0, max: 100 }],
    ['feePct', 'Fees a year (%)', 'number', 0.5, { min: 0, max: 3, step: 0.05 }],
  ] },
  { step: '5–6. Your choices', items: [
    ['rule', 'Spending', 'select', 'fixed', { options: [['fixed', 'The same every year'], ['vanguard', 'Flexible: up 5% or down 2.5% at most a year (Vanguard)'], ['guardrails', 'Guardrails: cut or raise 10% when far off track (Guyton-Klinger)']] }],
    ['order', 'Which account first', 'select', 'meltdown', { options: [['meltdown', 'RRSP up to the lowest tax bracket first (“meltdown”)'], ['conventional', 'Non-registered, then RRSP, then TFSA'], ['pro-rata', 'A little from each']] }],
    ['rrifAge', 'Turn the RRSP into a RRIF at', 'number', 71, { min: 55, max: 71, hint: 'Required by the end of the year you turn 71. A RRIF from 65 unlocks the $2,000 pension amount.' }],
  ] },
];

class OwlIncome extends CollegicaApp {
  render() {
    const saved = this.store.get('plan', null);
    this.remember = !!saved;
    const field = ([key, label, type, def, o = {}]) => {
      const v = saved?.[key] ?? def;
      const id = `f-${key}`;
      const hint = o.hint ? `<small class="muted" id="${id}-h">${esc(o.hint)}</small>` : '';
      const desc = o.hint ? ` aria-describedby="${id}-h"` : '';
      if (type === 'select') {
        return `<label for="${id}">${esc(label)}<select id="${id}" name="${key}"${desc}>${o.options.map(([k, t]) =>
          `<option value="${k}"${k == v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>${hint}</label>`;
      }
      const attrs = type === 'money' ? 'min="0" step="1000" inputmode="numeric"' :
        `min="${o.min ?? 0}" max="${o.max ?? ''}" step="${o.step ?? 1}" inputmode="decimal"`;
      return `<label for="${id}">${esc(label)}<input id="${id}" name="${key}" type="number" ${attrs} value="${v}"${desc}>${hint}</label>`;
    };

    this.root.innerHTML = `
      <style>
        ${baseStyles}
        :host { --line: var(--cg-line, #E2E5EE); --soft: var(--cg-surface-2, #F3F1EC); }
        form fieldset { border: 1px solid var(--line); margin: 0 0 1rem; padding: .75rem 1rem 1rem; }
        legend { font-weight: 600; padding: 0 .3rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .75rem 1rem; }
        label { display: flex; flex-direction: column; gap: .25rem; font-size: .92rem; }
        input, select { font: inherit; padding: .4rem; border: 1px solid var(--line); background: var(--cg-surface, #FBFAF7); color: inherit; }
        small { font-size: .8rem; }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .75rem; margin: 1rem 0; }
        .card { border: 1px solid var(--line); padding: .75rem .9rem; }
        .card b { display: block; font: 600 1.6rem/1.2 var(--cg-serif, Georgia, serif); color: var(--cg-brand, #3A4366); margin: .2rem 0; }
        .card .note { font-size: .82rem; }
        .ok { color: #2E6B4F; } .warn { color: var(--cg-accent-text, #8F5410); } .bad { color: #9B2C2C; }
        @media (prefers-color-scheme: dark) { .ok { color: #7FC8A0; } .bad { color: #F2A0A0; } }
        figure { margin: 1rem 0; } figcaption { font-size: .85rem; color: var(--cg-text-muted, #4C5782); }
        svg text { font: 11px var(--cg-sans, system-ui, sans-serif); fill: var(--cg-text-muted, #4C5782); }
        .wrap { overflow-x: auto; }
        table { border-collapse: collapse; width: 100%; font-size: .88rem; }
        th, td { text-align: right; padding: .35rem .5rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
        th:first-child, td:first-child { text-align: left; }
        caption { text-align: left; font-weight: 600; padding: .5rem 0; }
        details { margin: 1rem 0; } summary { cursor: pointer; font-weight: 600; }
        .row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin: 1rem 0; }
        .fine { font-size: .82rem; }
        @media print { form, .row, details:not([open]) { display: none !important; } }
      </style>

      <h2>OWL Income</h2>
      <p class="muted">Turn savings into a retirement paycheque, with Canada's 2026 rules: CPP, OAS and its
      clawback, RRIF minimums, and federal and provincial tax. In today's dollars. Everything is calculated in this tab.</p>

      <form>${FIELDS.map(s => `<fieldset><legend>${esc(s.step)}</legend><div class="grid">${s.items.map(field).join('')}</div></fieldset>`).join('')}
        <div class="row">
          <label style="flex-direction:row;align-items:center;gap:.4rem"><input type="checkbox" name="remember"${this.remember ? ' checked' : ''}> Remember this plan on this device</label>
          <button type="button" data-forget>Forget it</button>
        </div>
      </form>

      <section class="out" aria-live="polite"></section>

      <p class="muted fine"><strong>Education, not advice.</strong> A single person, Ontario, BC or Alberta, in 2026 dollars:
      tax brackets, credits and benefits held constant after inflation. Returns from FP Canada's 2026 Projection Assumption
      Guidelines (equities a third each Canadian, US and international) less your fees; volatility from its 2026 addendum.
      Not included: GIS, couples and pension splitting, survivor benefits, Quebec, dividends, annuities, health and
      long-term care costs. Use it to compare choices, then check them with a fee-only planner.</p>`;

    this.form = this.root.querySelector('form');
    this.out = this.root.querySelector('.out');
    let timer;
    this.form.addEventListener('input', e => {
      if (e.target.name === 'sex') this.form.horizon.value = e.target.value === 'male' ? PAG.horizon25.male : PAG.horizon25.female;
      clearTimeout(timer); timer = setTimeout(() => this.update(), 300);
    });
    this.root.querySelector('[data-forget]').addEventListener('click', () => {
      this.store.clear(); this.form.remember.checked = false;
    });
    this.out.addEventListener('click', e => {
      if (e.target.closest('[data-print]')) window.print();
      if (e.target.closest('[data-csv]')) this.download();
    });
    this.update();
  }

  plan() {
    const fd = new FormData(this.form);
    const num = k => Number(fd.get(k)) || 0;
    const values = Object.fromEntries(FIELDS.flatMap(s => s.items.map(([k, , type]) => [k, type === 'select' ? fd.get(k) : num(k)])));
    if (fd.get('remember')) this.store.set('plan', values); else this.store.remove('plan');
    return {
      ...values,
      nonRegGain: values.nonRegGainPct / 100, stocks: values.stocksPct / 100, fee: values.feePct / 100,
      cppStart: Math.min(70, Math.max(60, values.cppStart)), oasStart: Math.min(70, Math.max(65, values.oasStart)),
      rrifAge: Math.min(71, values.rrifAge),
    };
  }

  update() {
    const p = this.plan();
    const sc = scenarios(p.stocks, p.fee);
    const typical = project(p, [sc.typical]);
    const poor = project(p, [sc.poor]);
    const mc = monteCarlo(p, { paths: 500, seed: 2026 });
    this.last = { p, typical };
    const target = p.needs + p.wants + p.wishes;
    const first = typical.rows[0];
    const floor = first ? (first.cpp + first.oas + first.pension) : 0;
    const later = typical.rows.find(r => r.age === Math.max(p.cppStart, p.oasStart, p.pensionStart)) || first;
    const floorLater = later ? later.cpp + later.oas + later.pension : 0;
    const wr = typical.firstWithdrawalRate;
    const wrClass = wr <= 0.04 ? 'ok' : wr <= 0.05 ? 'warn' : 'bad';
    const lasting = r => r.essentialsFailAge === null ? `covered to ${p.horizon}` : `short from age ${r.essentialsFailAge}`;
    const success = mc.successRate;

    const compare = (label, variants) => `
      <table><caption>${esc(label)}</caption>
        <thead><tr><th scope="col"></th><th scope="col">Essentials</th><th scope="col">Spending, total</th><th scope="col">Tax, total</th><th scope="col">Left at ${p.horizon}</th></tr></thead>
        <tbody>${variants.map(([name, plan]) => {
          const r = project(plan, [sc.typical]);
          const spent = r.rows.reduce((s, x) => s + x.spending, 0);
          return `<tr><td>${esc(name)}</td><td>${r.essentialsFailAge === null ? 'covered' : 'short at ' + r.essentialsFailAge}</td><td>${money(spent)}</td><td>${money(r.lifetimeTax)}</td><td>${money(r.finalWealth)}</td></tr>`;
        }).join('')}</tbody></table>`;

    this.out.innerHTML = `
      <h3>Your plan, in a typical market</h3>
      <div class="cards">
        <div class="card"><span>Withdrawal rate</span><b class="${wrClass}">${pct(wr)}</b>
          <span class="note muted">Spending not covered by CPP, OAS or a pension, ÷ savings (less the contingency fund). Rule of thumb for 30 years: 3.5–4%.</span></div>
        <div class="card"><span>Essentials covered by guaranteed income</span><b>${pct(floorLater / Math.max(1, p.needs), 0)}</b>
          <span class="note muted">${money(floorLater)} a year once CPP, OAS and any pension have all started, against needs of ${money(p.needs)}.</span></div>
        <div class="card"><span>Typical market</span><b class="${typical.essentialsFailAge === null ? 'ok' : 'bad'}">${esc(lasting(typical))}</b>
          <span class="note muted">${pct(sc.typical)} a year after inflation and fees.</span></div>
        <div class="card"><span>Poor market</span><b class="${poor.essentialsFailAge === null ? 'ok' : 'bad'}">${esc(lasting(poor))}</b>
          <span class="note muted">${pct(sc.poor)} a year: the worst quarter of 30-year outcomes.</span></div>
        <div class="card"><span>Futures where essentials last to ${p.horizon}</span><b class="${success >= 0.85 ? 'ok' : success >= 0.7 ? 'warn' : 'bad'}">${pct(success, 0)}</b>
          <span class="note muted">Of 500 random markets, with your spending choice.</span></div>
        <div class="card"><span>Tax over the plan</span><b>${money(typical.lifetimeTax)}</b>
          <span class="note muted">Including ${money(typical.rows.reduce((s, r) => s + r.clawback, 0))} of OAS clawback.</span></div>
      </div>
      ${this.chart(mc, typical, p)}
      <div class="wrap">${compare('When to start CPP', [60, 65, 70].map(a => [`CPP at ${a} (${a === 65 ? 'full' : (a < 65 ? '−' : '+') + pct(Math.abs(cppFactor(a) - 1), 0)})`, { ...p, cppStart: a }]))}</div>
      <div class="wrap">${compare('Which account first', [['RRSP to the lowest bracket first', 'meltdown'], ['Non-registered, RRSP, TFSA', 'conventional'], ['A little from each', 'pro-rata']].map(([n, o]) => [n, { ...p, order: o }]))}</div>
      <div class="wrap">${compare('How you spend', [['The same every year', 'fixed'], ['Flexible (Vanguard)', 'vanguard'], ['Guardrails', 'guardrails']].map(([n, r]) => [n, { ...p, rule: r }]))}</div>
      <details><summary>Year by year, typical market</summary><div class="wrap">${this.table(typical)}</div></details>
      <div class="row">
        <button type="button" class="primary" data-print>Print a summary</button>
        <button type="button" data-csv>Download year by year (CSV)</button>
      </div>
      <p class="muted fine">Keep it simple, step 7: fewer accounts, a financial power of attorney and a trusted contact on your accounts
      while you're well, and your beneficiaries checked. Target spending: ${money(target)} a year.</p>`;
  }

  chart(mc, typical, p) {
    const W = 640, H = 260, L = 56, R = 10, T = 12, B = 28;
    const ages = mc.ages, n = ages.length;
    const max = Math.max(1, ...mc.wealth.map(w => w.p90), ...typical.rows.map(r => r.total));
    const x = i => L + (W - L - R) * i / Math.max(1, n - 1);
    const y = v => T + (H - T - B) * (1 - v / max);
    const line = vals => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const band = `${line(mc.wealth.map(w => w.p90))}L${mc.wealth.map((w, i) => `${x(n - 1 - i).toFixed(1)},${y(mc.wealth[n - 1 - i].p10).toFixed(1)}`).join('L')}Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
    const ageTicks = ages.filter(a => a % 5 === 0);
    return `<figure>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings by age: the middle 80% of random markets, and the typical market">
        ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t >= 1e6 ? (t / 1e6).toFixed(1) + 'M' : Math.round(t / 1000) + 'k'}</text>`).join('')}
        ${ageTicks.map(a => { const i = ages.indexOf(a); return `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${a}</text>`; }).join('')}
        <path d="${band}" fill="var(--cg-accent, #C97B1E)" opacity=".18"/>
        <path d="${line(mc.wealth.map(w => w.p50))}" fill="none" stroke="var(--cg-accent, #C97B1E)" stroke-width="2"/>
        <path d="${line(typical.rows.map(r => r.total))}" fill="none" stroke="var(--cg-brand, #3A4366)" stroke-width="2" stroke-dasharray="5 4"/>
      </svg>
      <figcaption>Savings by age, in today's dollars. Shaded: the middle 80% of 500 random markets; solid line: their median;
      dashed: the typical market. The contingency fund is not included.</figcaption></figure>`;
  }

  table(r) {
    const cols = [['age', 'Age'], ['spending', 'Spending'], ['cpp', 'CPP'], ['oas', 'OAS'], ['pension', 'Pension'],
      ['fromRrsp', 'From RRSP/RRIF'], ['fromNonReg', 'From non-reg.'], ['fromTfsa', 'From TFSA'], ['tax', 'Tax'],
      ['clawback', 'of which clawback'], ['total', 'Savings at year end']];
    return `<table><thead><tr>${cols.map(([, t]) => `<th scope="col">${t}</th>`).join('')}</tr></thead><tbody>${r.rows.map(row =>
      `<tr>${cols.map(([k]) => `<td>${k === 'age' ? row.age : money(row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  download() {
    if (!this.last) return;
    const keys = ['age', 'spending', 'cpp', 'oas', 'pension', 'fromRrsp', 'fromNonReg', 'fromTfsa', 'tax', 'clawback', 'saved', 'rrsp', 'tfsa', 'nonReg', 'total'];
    const csv = [keys.join(','), ...this.last.typical.rows.map(r => keys.map(k => Math.round(r[k] ?? 0)).join(','))].join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'owl-income-plan.csv' });
    this.root.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

customElements.define('owl-income', OwlIncome);
