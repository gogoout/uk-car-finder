# Build log

A running record of how this was built — decisions, dead ends, and things
discovered about AutoTrader that aren't obvious from the code. Newest first.

---

## 2026-08-10 — Facet-driven filters with a Make/Model/Variant cascade

The editor was ten free-text boxes covering only the fields from the original
worked example. Now it renders AutoTrader's own filters, from AutoTrader's own
data.

### The find

`SearchResultsFacetsWithGroupsQuery`, lifted from their SPA bundle. It is the
query that populates AutoTrader's own dropdowns, on the same public gateway we
already use. Asking for **one** facet returns **all 34**, each with per-option
labels, values and live result counts, plus `facetGroups` giving their 27 UI
groups and human titles. 0.58s for the lot.

The cascade needs no taxonomy of ours: pass the filters chosen so far and
AutoTrader returns the valid children. Verified live — 155 makes, `model` empty
until a make is picked then 14 for MINI, `aggregated_trim` 8 for MINI Cooper.

### The consequence: stop hard-coding filters

`Combo` was ten typed fields, and adding one meant editing five files. It is now
an open bag keyed by AutoTrader's own filter names:

```ts
interface Combo { id: string; label: string; filters: Record<string, string[]> }
```

`buildFilters` is nearly a pass-through, `parseCombos` is a generic validator,
and the UI renders whatever the facet API returns. Filters AutoTrader adds later
appear on their own. No SQL migration was needed — combos are a JSON blob — but
`migrateCombo()` converts pre-refactor combos on read, and is idempotent.

Multi-select is real and now supported throughout: `fuel_type: [Petrol]` → 8,835,
`[Diesel]` → 1,141, `[Petrol, Diesel]` → 9,976. Exact OR.

### Verification survived, and grew

`match.ts` is what caught AutoTrader returning a £17,250 car for an £8,000 combo,
so it was kept and extended to fuel type, body type, doors and confirmed
write-offs — all already parsed and stored. It reads from the bag now.

`aggregated_trim` is deliberately **not** verified: trim exists only inside the
free-text `subTitle`, so any check would be substring guesswork that discards
real matches. Trusted to AutoTrader, and commented as such.

### Two bugs the work surfaced

- **A duplicate distance control.** `buildGroups` marked search-level facets as
  used but still emitted their *group*, so "Distance from you" would have
  appeared inside every combo despite living on the search. Caught by a test
  written before looking at the UI.
- **`GROUP_CONCAT(combo_label)` splits on a comma**, so a label containing one
  corrupted `matchedCombos`. Reachable now that labels are auto-generated from
  multi-select values. Switched to a unit separator — and since SQLite rejects
  `GROUP_CONCAT(DISTINCT x, sep)`, deduping moved to JS.

### UI notes

- 27 collapsed accordion groups in AutoTrader's structure, each showing a summary
  of its selection ("MINI · Cooper", "£5,500 – £7,000") so a combo reads without
  opening anything.
- **AutoTrader returns their groups roughly alphabetically**, which buried "Make
  and model" eighteen rows down. A priority list pulls the groups a search
  actually starts from to the front; the rest keep AutoTrader's order.
- Widget choice is structural, not a lookup: a `min_`/`max_` filter pair renders
  as two dropdowns, everything else as a multi-select. An invented `min_wingspan`
  /`max_wingspan` facet would render correctly, which is the point.
- Type-to-filter appears above 12 options, so 155 makes are usable on a phone.
- Facet responses are cached in D1 (1h TTL, keyed by filter context) and a stale
  copy is served if AutoTrader is unreachable — stale dropdowns beat none.

### Follow-up: collapsible combination panels

Review feedback: each combination panel should collapse to its name. With 27
accordion groups inside each, two combinations made the editor about 4,000px
tall before you could reach the save button.

Panels now collapse to a header row showing the combo name and its active filter
count. A combination that already has a make opens collapsed — it is configured,
so editing a saved search stays scannable — while a fresh one opens expanded
because it needs filling in. Collapsed panels also skip their facet fetch, which
removes a round trip per combination on load.

### Follow-up: narrowing a filter didn't remove excluded cars

Reported: reducing a combo's price range left the dearer cars on screen.

Root cause, not the symptom: a row in `search_listings` is written when a
listing matches and is **never re-evaluated**. The only deletions were dropping
a whole search, and `drain.ts` unlinking when a detail page contradicts a combo.
So lowering `max_price` meant AutoTrader simply stopped returning that car — and
with nothing touching its existing link, `getResults` kept serving it. The same
hole meant a listing could keep crediting a combo it no longer satisfied.

Fixed by enforcing the missing invariant at read time: every credit is re-checked
against the combo *as it stands now*, via `storedListingMatches()` — which reuses
the same two matchers as the ingest path, so there is one definition of "matches"
rather than a second copy that drifts. Credits that no longer hold are dropped;
a listing left with none disappears. This also means an edit takes effect
immediately rather than after the next 4-hourly run.

Reproduced live before fixing: a Mazda2 combo capped at £12,000 returned 35 cars;
lowering the cap to £7,000 left all 35 on screen. After the fix, 6, none above
the cap, with no refresh.

One existing test had to change: it linked a combo that was not in the saved
search, which `refreshSearch` would never do. Its setup was wrong, not the new
assertion.

### Self-inflicted note

Running `wrangler d1 execute --local` while `wrangler dev` was up killed workerd
with `SQLITE_BUSY: database is locked`. Stop the dev server before touching the
local D1.

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
