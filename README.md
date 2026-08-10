# uk-car-finder

A personal watchlist for UK used cars. Runs several spec combinations against
AutoTrader on a schedule, remembers every listing it has seen, and shows you
what's new and what's dropped in price.

It exists because AutoTrader's own search can't express *"a MINI Cooper 1.5 Auto,
2015–16, under 85k, £5.5–7k **or** a Mazda2 1.5 Skyactiv-G Auto, 2015+, under
80k, £6–8k, no Cat S"* — and has no memory between visits.

Cloudflare Worker + D1 + cron. Mobile-first.

## What it shows

Per listing: engine size, year, transmission, mileage, fuel, service history
(full / part / none), AutoTrader's market price verdict (great / good / fair /
lower / higher price), MOT status, and the write-off, stolen, scrapped and
imported checks.

Deltas: new since the last run, and price drops measured from the highest price
ever observed.

## Setup

```bash
npm install
npx wrangler d1 create uk-car-finder      # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply uk-car-finder --remote
npm run deploy
```

Then protect it: in the Cloudflare dashboard go to your Worker →
**Settings → Domains & Routes → Enable Cloudflare Access**. No custom domain
needed, and no auth code in the app.

### Local development

```bash
npm run db:local     # apply the schema to a local D1
npm run dev          # worker + built SPA on :8787
npm run dev:web      # optional: Vite dev server with HMR, proxying /api to :8787
```

Trigger the cron by hand:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*/4+*+*+*"   # refresh searches
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"  # drain detail queue
```

### MOT history (optional)

AutoTrader never publishes the registration plate, so MOT lookups run only for
cars you shortlist and enter a plate for. Register for the
[DVSA MOT History API](https://documentation.history.mot.api.gov.uk/mot-history-api/register),
then:

```bash
wrangler secret put DVSA_CLIENT_ID
wrangler secret put DVSA_CLIENT_SECRET
wrangler secret put DVSA_API_KEY
wrangler secret put DVSA_TOKEN_URL
```

See `.dev.vars.example`. Without them the MOT endpoint returns 501 and
everything else works normally.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests + D1/cron tests in real workerd |
| `npm run smoke` | Live check against AutoTrader — detects schema drift |
| `npm run typecheck` | Worker and SPA |
| `npm run build` | Build the SPA into `web/dist` |

## How it works

```
cron 0 */4 * * *  →  refresh.ts   pages the GraphQL gateway per combo,
                                  upserts listings, records price changes,
                                  queues detail fetches
cron */15 * * * * →  drain.ts     fetches ~35 detail pages, fills in service
                                  history / write-off checks, unlinks anything
                                  the detail page contradicts
```

Saved searches live in D1 (the cron can't read your localStorage), so
`/s/<id>` opens on any device. localStorage only tracks which searches are
*yours*.

Searches are re-verified client-side after fetching: AutoTrader pads narrow
searches with promoted adverts that ignore the filters, so `src/autotrader/match.ts`
re-checks every listing before it is stored. Rejections are counted and shown in
the run history rather than hidden.

`docs/BUILD_LOG.md` records how this was built and what was learned about
AutoTrader along the way.

## Notes

- There is no public AutoTrader API. This uses the same endpoints their website
  does, at personal volume with ~500ms between requests. Keep it that way —
  the request rate is what keeps this uncontroversial.
- Their schema is undocumented and can change without notice. `npm run smoke` is
  how you find out.
- No credentials are needed to search, and none are stored.
- Test fixtures are real, publicly-listed AutoTrader adverts, kept because they
  cover the parsing edge cases that matter.
