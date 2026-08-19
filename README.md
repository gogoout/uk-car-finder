# uk-car-finder

A personal watchlist for UK used cars. Runs several spec combinations against
AutoTrader on a schedule, remembers every listing it has seen, and shows you
what's new and what's dropped in price.

It exists because AutoTrader's own search can't express *"a MINI Cooper 1.5 Auto,
2015–16, under 85k, £5.5–7k **or** a Mazda2 1.5 Skyactiv-G Auto, 2015+, under
80k, £6–8k, no Cat S"* — and has no memory between visits.

Cloudflare Worker + D1 + cron. Mobile-first.

## Filters

The editor is driven by AutoTrader's own facet API, so it offers **everything
they support** — all 27 filter groups — with their option lists, labels and live
result counts. Make → Model → Variant cascades: pick a make and its models
appear, pick a model and its variants appear. Filters AutoTrader adds later show
up on their own, with no code change here.

Each saved combination stores its selections keyed by AutoTrader's own filter
names, so `src/autotrader/filters.ts` is close to a pass-through.

A combination can be switched off from its panel header. It then stops being
searched for and its cars drop out of the results, but the filters and the links
are kept — switching it back on restores everything without a refresh.

## What it shows

Per listing: engine size, year, transmission, mileage, fuel, service history
(full / part / none), AutoTrader's market price verdict (great / good / fair /
lower / higher price), MOT status, and the write-off, stolen, scrapped and
imported checks.

Deltas: new since the last run, and price drops measured from the highest price
ever observed.

## Setup

```bash
pnpm install
pnpm exec wrangler d1 create uk-car-finder      # paste database_id into wrangler.jsonc
pnpm exec wrangler d1 migrations apply uk-car-finder --remote
pnpm run deploy
```

> `wrangler d1 create` rewrites `wrangler.jsonc` and renames the D1 binding to
> match the database. Keep it as `DB` — that is what `src/index.ts` reads. A
> renamed binding still deploys cleanly and then fails on every request.

### Domains and access

The Worker serves only from a custom domain, which sits behind Cloudflare Access
(Google sign-in). Both are configured in the dashboard, deliberately — the
hostname is not in this repo.

`wrangler.jsonc` sets `workers_dev: false` and `preview_urls: false`. Both
default to **true**, so omitting them means every deploy re-creates a
`*.workers.dev` URL that answers *without* going through Access. There is no
`routes` key either: wrangler overrides dashboard-configured routes with
whatever the config declares, and per Cloudflare's docs the way to keep routes
dashboard-managed is to omit the keys entirely and set `workers_dev: false`.

Cron triggers are unaffected by Access — they invoke the Worker directly rather
than over HTTP, so the scheduled refresh keeps running.

### Continuous deployment

`.github/workflows/ci.yml` typechecks, tests and builds every pull request, and
on a merge to `main` applies D1 migrations and deploys.

`pnpm run smoke` is deliberately not part of CI: AutoTrader returns 403 to
GitHub Actions' shared IP ranges, so it would fail on every deploy regardless of
your code. Run it locally when you suspect their schema has drifted.

Two secrets are needed. Put them on a **`production` environment**
(Settings → Environments → New environment → `production`), not on the
repository — environment secrets are readable only by a job that names that
environment, so the `verify` and `smoke` jobs cannot touch them at all. Add a
deployment branch rule limiting the environment to `main` and GitHub enforces
that independently of the workflow's own condition. Environments and their
protection rules are free for public repositories.

| Secret | Notes |
|---|---|
| `CLOUDFLARE_API_TOKEN` | An **account-owned** token (Manage Account → Account API Tokens), with **Workers Scripts:Edit** and **D1:Edit**. The stock "Edit Cloudflare Workers" template alone can't apply migrations. A user token works too, but an account-owned one isn't tied to a person. |
| `CLOUDFLARE_ACCOUNT_ID` | From the dashboard sidebar. Required — supplying it is what lets an account-owned token work, since wrangler otherwise tries a membership lookup that account tokens cannot grant. |

`database_id` in `wrangler.jsonc` is committed deliberately — it identifies the
database but grants nothing without the API token. DVSA secrets are set with
`wrangler secret put` and live on the Worker; deploying does not clear them.

### Local development

One-off, to create the local database:

```bash
pnpm run db:local     # apply the schema to a local D1
```

Then, for everyday use, one terminal is enough:

```bash
pnpm run dev          # Worker + API + SPA on http://localhost:8787
```

That rebuilds the SPA first and serves it from the Worker, so it's the whole app.
The SPA won't hot-reload, so if you're iterating on the UI, add a **second**
terminal:

```bash
pnpm run dev:web      # Vite with HMR, on the port it prints
```

Vite only renders the SPA — `/api` is proxied to the Worker, so `pnpm run dev`
must already be running. If it isn't, you'll get
`ECONNREFUSED 127.0.0.1:8787`; start the Worker and reload.

Get something on screen without clicking through the editor:

```bash
pnpm run seed --refresh     # creates a test search and runs it
pnpm run seed --url https://uk-car-finder.<you>.workers.dev
```

It goes through the API rather than writing to D1, so it works against a
deployed Worker too, and it can't hit the `SQLITE_BUSY` you get from touching
the local database while `wrangler dev` holds it.

Trigger the cron by hand:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*/4+*+*+*"   # refresh searches
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"  # drain detail queue
```

### MOT history (optional)

AutoTrader never publishes the registration plate, so MOT lookups run only for
cars you enter a plate for — in the listing modal, which then remembers it.

What the panel is for: an odometer that reads lower than an earlier test, and an
advertised mileage the last MOT contradicts. Both surface as badges on the card
too. DVSA's response is cached per plate for a week (the `mot_history` table)
and every verdict is derived from that stored payload on read, so the panel
offers an explicit re-check for the day you want to be certain.

Register for the
[DVSA MOT History API](https://documentation.history.mot.api.gov.uk/mot-history-api/register),
then, for production:

```bash
pnpm exec wrangler secret put DVSA_CLIENT_ID
pnpm exec wrangler secret put DVSA_CLIENT_SECRET
pnpm exec wrangler secret put DVSA_API_KEY
pnpm exec wrangler secret put DVSA_TOKEN_URL
```

Locally, copy `.dev.vars.example` to `.dev.vars` and fill the same four values
in — it is gitignored. `GET /api/health` reports `motConfigured`. Without the
credentials the MOT panel says so plainly and everything else works normally.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests + D1/cron tests in real workerd |
| `pnpm run smoke` | Live check against AutoTrader — detects schema drift. Local only; AutoTrader 403s GitHub's IPs |
| `pnpm run typecheck` | Worker and SPA |
| `pnpm run build` | Build the SPA into `web/dist` |
| `pnpm run capture:fixture <id>` | Capture a trimmed test fixture from a live advert |
| `pnpm run seed` | Create a test search (add `--refresh` to run it immediately) |

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

Filter options come from AutoTrader's facet API via `POST /api/facets`, cached in
D1 for an hour and keyed by the filter context (the cascade means MINI's models
and Mazda's are different answers). If AutoTrader is unreachable, a stale cached
copy is served rather than leaving the editor with no dropdowns.

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
- Their schema is undocumented and can change without notice. `pnpm run smoke` is
  how you find out.
- No credentials are needed to search, and none are stored.
- Test fixtures are real AutoTrader adverts, trimmed to just the embedded data
  payload the parser reads. Capture new ones with
  `pnpm run capture:fixture <advertId> [suffix]` — never commit a whole page,
  which carries AutoTrader's own third-party API keys.
