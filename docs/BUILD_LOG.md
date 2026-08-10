# Build log

A running record of how this was built — decisions, dead ends, and things
discovered about AutoTrader that aren't obvious from the code. Newest first.

---

## 2026-08-10 — Trim fixtures after a secret-scanning alert

GitHub flagged a leaked Google API key in the fixtures. It is AutoTrader's own
`googleMapsApiKey`, embedded in the `AT_SPA_JS_CONFIG` script that ships to every
visitor of autotrader.co.uk — not ours, already public, and nothing to rotate.
But committing whole pages republished it, which is both bad form and permanent
alert noise. My fault: I committed 200KB pages when the parser reads one script.

Fixtures are now trimmed to the `__staticRouterHydrationData` payload alone —
806KB down to 233KB, with the config script, adverts and trackers gone. The key
was never inside the hydration blob, so no test data changed and all 72 tests
still pass. Existing fixtures were transformed offline rather than re-fetched:
re-capturing would have lost the edge cases they were chosen for, since those
adverts sell.

Two changes so it can't recur:

- `scripts/capture-fixture.ts` captures new fixtures trimmed by construction and
  refuses to write anything containing a key-like string.
- `test/fixtures.test.ts` asserts every fixture has exactly one script tag, no
  key-shaped strings, no `AT_SPA_JS_CONFIG`, and is still parseable. Verified by
  reintroducing the key and watching the tests fail.

---

## 2026-08-10 — Fix two dev-server papercuts

Running `pnpm run dev:web` on its own gave `ECONNREFUSED 127.0.0.1:8787`. Vite
serves only the SPA; the API and D1 live in the Worker, so `pnpm run dev` has to
be running too. Two fixes so this doesn't have to be learned the hard way:

- The Vite proxy now catches `ECONNREFUSED` and prints what to actually do,
  instead of a bare stack trace.
- `predev` builds the SPA before `wrangler dev` starts. `web/dist` is gitignored,
  so on a fresh clone the Worker failed outright with *"The directory specified by
  the assets.directory field does not exist"* — verified by deleting the
  directory and watching it fail. Now `pnpm run dev` works from a clean checkout.

README rewritten to say plainly that one terminal is enough for normal use, and
the second is only for SPA hot-reload.

---

## 2026-08-10 — Switch to pnpm

Project scaffolded with npm; converted at request. `packageManager` is now
pinned in package.json so the choice sticks, and the `deploy` script calls
`pnpm run build` rather than shelling out to npm.

pnpm's non-hoisted `node_modules` is the thing that usually breaks a conversion
like this, so everything was re-verified rather than assumed: typecheck, build,
all 72 tests, the live smoke run, and `wrangler dev` serving the API, cron and
SPA. Nothing needed a workaround — no `.npmrc`, no `shamefully-hoist`.

### The smoke test was crying wolf

It failed on the MINI combo — 0 results — while Mazda and the detail page passed.
Checking directly: 938 MINI Coopers exist, and 1 matches the tight spec but now
sits above the £7k cap. The £6,550 car from yesterday's run had gone. So the
pipeline was fine; the market had moved.

The script was asserting that *every* combo returns listings, which makes it fail
for reasons that aren't defects. A smoke test that fails routinely gets ignored,
and this one exists to catch schema drift — a signal worth protecting. It now
skips field checks for an empty combo and only fails if *all* combos come back
empty, which really would suggest a broken query.

---

## 2026-08-10 — Initial build

### Reconnaissance

Before writing anything, I probed AutoTrader to find out what was actually
possible. The findings changed the shape of the project:

- **No login is needed.** The plan started with an AutoTrader login page. It
  turned out their SPA posts to a public GraphQL gateway at
  `/at-gateway?opname=SearchResultsListingsQuery` with no auth and no Cloudflare
  challenge. Login was dropped from scope.
- **Introspection is WAF-blocked** (`__schema` returns a Cloudflare 403), but
  field-validation errors include `Did you mean …` suggestions. That's how the
  query document in `src/autotrader/search.ts` was derived — send a guess, read
  the correction, repeat.
- **Detail pages are server-rendered.** `GET /car-details/{id}` embeds a state
  blob in `window.__staticRouterHydrationData = JSON.parse("…")` — a JSON string
  containing JSON, so it needs parsing twice. It carries the price indicator,
  service history, engine size, gearbox, MOT status and the vehicle history
  check. `window['AT_APOLLO_STATE']` is on the page too but is always `{}`.
- **The plate is not published.** Only `2016 (66 reg)`. This is why MOT
  enrichment has to be driven by a plate you type in. One consolation: some
  dealer groups leak it in their own deep-link
  (`…?vehicleid=123&VRM=YT66CNK`), which `extractVrm` picks up opportunistically.

### Two filter names the plan got wrong

Both were found by feeding deliberate wrong guesses to the gateway and reading
the enum suggestions back:

| Wanted | Plan assumed | Actually |
|---|---|---|
| Search radius | `radius` (their URL param) | `distance` |
| Exclude write-offs | `exclude_writeoff_categories` | `is_writeoff` with value `false` |

`is_writeoff` only accepts `false` — `true` and `on` are rejected by their
backend converter. It cut a MINI search from 11,587 to 11,210 results, so it
does work.

While chasing this I changed `gateway.ts` to parse the response body *before*
checking the status code. A bad filter name comes back as HTTP 400 with a
GraphQL error naming the offender; the old code threw away that body and
reported a bare "HTTP 400", which is useless. The error text is the single most
valuable diagnostic this project has.

### The bug that mattered: AutoTrader doesn't honour its own filters

The first live end-to-end run stored a 2024 Mazda2 at £17,250 and a 2022 at
£11,400 against a combo capped at £8,000 and mileage 80k. The gateway reported
`results.count: 4` while returning 6 listings.

AutoTrader pads narrow searches with promoted "you might also like" adverts
mixed into the same array, and interleaves empty `{}` objects for sponsored
slots. **Their result set cannot be trusted to match the filters sent.**

Fix: `src/autotrader/match.ts` re-checks every listing before it is stored.

- `matchesCombo` runs on search results (make, year, price, mileage).
- `detailMatchesCombo` runs after enrichment for engine size and transmission,
  which aren't in the search payload at all. A failure unlinks that one combo
  rather than deleting the listing — another combo may legitimately want it.
- Unknown values pass. Discarding a car because its price didn't parse would
  trade one kind of wrong answer for another.
- Rejections are counted onto the run row (`rejected_count`) and shown in the
  run-history table, so this filtering is never silent.

Re-running afterwards: `listingsSeen: 5, rejectedCount: 2` — exactly the two
promoted adverts, gone.

### Other corrections found by running it for real

- `seller.name` is absent for private sellers; `sellerName()` now falls back to
  `details.advertiser.displayName` and strips its "From " prefix.
- Location was being read from a path that doesn't exist. It's
  `seller.location.town`, with `contactDetails.advertiserTown` as a fallback.
  Before the fix every listing showed a blank location.

### Design notes

- **Price indicator comes free from search.** Results carry `PI_GREAT` /
  `PI_GOOD` / `PI_FAIR` / `PI_LOW` / `PI_HIGH` badges, so the market verdict
  doesn't need a detail fetch. Detail pages are still needed for service history
  and the write-off check.
- **`UNKNOWN` is never treated as `PASSED`.** A large share of adverts carry no
  `vehicleCheck` block at all. Reporting those as "not written off" would be
  actively dangerous, so "Hide write-offs" keeps only listings AutoTrader
  positively cleared, and the UI labels the rest "Write-off status unknown".
- **The detail queue exists because of the free plan.** Workers allows 50
  subrequests per invocation, so `fetch_queue` is drained ~35 at a time by a
  15-minute cron while searches refresh every 4 hours. On Workers Paid (1,000
  subrequests) `BATCH_SIZE` can simply be raised; nothing else changes.
- **"New" is defined by run id, not a timestamp.** `search_listings` records the
  run that first surfaced a listing, and "new" means that equals the search's
  latest finished run. This survives restarts and backfills in a way a
  "seen since <time>" comparison wouldn't.
- **Price drops are measured from the highest price ever observed**, so a car
  cut twice shows the full reduction rather than only the last step.

### Testing

52 tests. Unit tests run against real captured AutoTrader pages, chosen for the
shapes that broke naive parsing: one with no service history, one with FULL
history and a FAILED import check, one with no `vehicleCheck` block at all, and
one with no seller name. D1 and cron-job tests run inside real workerd via
`@cloudflare/vitest-pool-workers`.

`pnpm run smoke` hits the live gateway with the two real combos. It is not in
`pnpm test` — schema drift is the long-term failure mode here, and this is the
thing that will detect it.

### Still to do

- Replace `database_id` in `wrangler.jsonc` with the real one from
  `wrangler d1 create uk-car-finder`, then deploy.
- Turn on Cloudflare Access for the Worker in the dashboard.
- Register for the DVSA MOT History API; the code path is written and gated
  behind `isMotConfigured()`, so it activates as soon as the secrets are set.
