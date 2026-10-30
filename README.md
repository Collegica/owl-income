# OWL Income

Turn savings into a retirement paycheque, with Canada's 2026 rules. Enter
what you spend, your CPP and OAS, a workplace pension and your RRSP, TFSA and
non-registered savings, and see, year by year to the age you plan for:

- **your withdrawal rate**: spending not covered by CPP, OAS or a pension,
  divided by savings, beside the 3.5–4% rule of thumb;
- **whether essentials last** in a typical market, a poor one (the worst
  quarter of 30-year outcomes), and across 500 random markets;
- **tax each year**: federal and Ontario, BC or Alberta, with the age and
  pension amounts, RRIF minimums and the OAS clawback;
- **choices compared side by side**: CPP at 60, 65 or 70; which account to
  draw first (RRSP up to the lowest bracket, non-registered first, or a
  little from each); fixed spending, Vanguard's flexible rule (+5% / −2.5% a
  year at most) or Guyton-Klinger guardrails.

It follows the seven steps of Vanguard's *Principles for retirement income*
(2026), in Canadian terms. Everything is calculated in your browser tab.
**Nothing is uploaded**; the plan is kept on this device only if you ask.

**Education, not advice.** One person, Ontario, BC or Alberta, in 2026
dollars. Not modelled yet: couples and pension splitting, GIS, Quebec,
dividends, annuities. Each is listed under [Known gaps](#known-gaps).

## How it works

| File | What it holds |
|---|---|
| `src/rules-2026.js` | Every 2026 figure, with its source: CPP and OAS adjustments, the clawback threshold, RRIF factors, federal and provincial brackets and credits, FP Canada's 2026 projection assumptions |
| `src/tax.js` | One person's tax for one year, following CRA's T4127 formulas |
| `src/engine.js` | The projection: guaranteed income, RRIF minimums, withdrawals by order, tax, spending rules, surplus saved to the TFSA; Monte Carlo on FP Canada's returns and volatilities |
| `src/app.js` | The form and the results |

The amounts are in today's dollars: brackets, credits and benefits rise with
inflation, so holding them constant is the same thing. Returns are FP
Canada's 2026 guidelines (equities split equally between Canada, the US and
international) minus your fees.

The tests (`test/engine.test.mjs`) check the engine against published
numbers: canada.ca's CPP and OAS adjustments and clawback example, CRA's
RRIF table, tax worked by hand, and Vanguard's Figures 2 and 4 reproduced to
the dollar; plus invariants on 200 random plans.

## Run and test

Node 22, nothing to install.

```bash
npm start          # http://localhost:8000/
npm test           # the embedding contract and the unit tests
npm run build      # dist/<slug>-web.tar.gz
```

## How it fits on collegica.org

The site's `website/apps.yml` pins each app's release. On every deploy the
site downloads that release and unpacks it into `/apps/<slug>/app/`:

| Address | What it is |
|---|---|
| `/apps/<slug>/` | A page on the site: navigation, the article around the app, and the app itself placed as `<slug>` from `app/src/app.js` |
| `/apps/<slug>/app/` | This repository's `index.html`: the app full-screen, which is what installs to a phone's home screen and works offline |

The app inherits the site's colours and dark mode through the `--cg-*` CSS
custom properties; standalone, `src/tokens.css` supplies the same ones.

## The contract

`npm test` checks that the app keeps to the rules that let many apps share one
site: its element is named for its slug, its paths are relative, it talks to
no other site unless `app.json` declares it, it stores data only under its own
name, and it adds no page-wide keyboard, wheel or touch handlers. The details,
and how to work in this repository with a coding assistant, are in
[`AGENTS.md`](AGENTS.md).

## Release

Publish a GitHub release tagged `vMAJOR.MINOR.PATCH`. The release workflow
tests, builds and attaches `<slug>-web.tar.gz`. It goes live on collegica.org
when the site pins the new tag.

## Known gaps

- **Couples**: pension income splitting, survivor benefits and joint
  horizons are next.
- **GIS** for low incomes, **Quebec** (QPP and Quebec tax), the territories.
- **Annuities**, dividends and the dividend tax credit, medical expenses.
- **2027 rules**: add `src/rules-2027.js` when CRA and Service Canada
  publish them.
- **iPhone home-screen icon**: iOS ignores SVG icons; a 180 × 180 PNG is needed.

## License

MIT. See [`LICENSE`](LICENSE).
