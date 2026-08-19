# Build log

A running record of how this was built — decisions, dead ends, and things
discovered about AutoTrader that aren't obvious from the code. Newest first.

---

## 2026-08-19 — MOT history: the odometer as evidence

The DVSA credentials arrived, which exposed how lopsided the feature was: the
OAuth flow, the lookup and a route had all been written months earlier, and
nothing in the SPA ever called any of it. A plate typed on a starred card was
saved and then used for nothing.

### What the panel is actually for

Two questions the advert cannot answer:

- **Does the odometer ever go backwards?** Consecutive MOTs are the only public
  mileage record a private buyer can check.
- **Does the advertised mileage agree with the last test?** A car can only gain
  miles after a test, so an advert *below* the last reading is the direction
  that matters. Above it is just time passing.

A third fell out for free: DVSA returns the make for a plate, so a mistyped
registration is caught rather than presented as this car's history.

### Two bugs found while splitting fetch from derive

- **Kilometre readings were read as miles.** `odometerUnit` is `KM` on some
  tests — usually an import. A 72,000 km reading among mile readings looks like
  the odometer leapt 32,000 miles and then fell back, which fabricates a
  clocking warning on an honest car. Now converted before comparison.
- **`completedDate` has two formats.** Current records are ISO; older ones are
  dotted (`2018.05.12 10:57:24`). One vehicle's history spans both eras, and
  `new Date()` returns Invalid Date for the older form.

### Storage: the payload, not the verdict

Same rule as `advert_text`, and the table for it already existed in the initial
migration. DVSA's response is stored verbatim per plate; the timeline, the
clocking flag and the mileage comparison are computed on every read. Tightening
the clocking rule later re-judges every car at once — no migration, no rows left
carrying an answer from an older version of the code.

A week's TTL for data that changes annually, with an explicit re-check in the
panel, and a stale copy served when DVSA is unreachable — last week's MOT
history is the same MOT history.

The card gets a small derived summary; the full test list is fetched only when
the modal opens. Cars with no plate never join the MOT table at all.

### Failure modes get their own sentences

No credentials (501), no DVSA record for that plate (404) and DVSA being down
(502) previously collapsed into one 502 "lookup failed". They mean entirely
different things to someone standing in a car park, so they now read
differently.

### Two incidental fixes

- `setVrm` used to **upsert** into `starred`, so saving a plate silently
  shortlisted the car. Now that a plate can be entered from the modal on any
  car, it updates the shortlist row only if one already exists.
- The card's plate box, which only appeared once a car was starred, is gone —
  the modal takes a plate on any car and shows the answer in the same place.

### Testing

37 new tests. The route tests stub `fetch` **by URL rather than call order**:
the OAuth token is cached for the life of the module, so after the first test
the token request never happens and an ordered stub hands the token response to
the MOT call instead — which fails as a *passing* 200 with an empty history.

---

## 2026-08-11 — Import badges, and storing inputs rather than outputs

Two adverts looked wrong and neither actually was:

- A MINI badged "Imported" with nothing about it in the description. AutoTrader's
  own provenance check says `IMPORTED: FAILED`, labelled *"Imported from another
  country"* — stronger evidence than the seller's words. It was unfindable in
  the modal because the check rendered as **"Imported: failed"**, which reads
  like a broken check rather than a finding. `fullDetail.ts` was overriding
  AutoTrader's descriptive label with a terse noun; their wording now wins.
- A Suzuki whose advert says "FRESHLY IMPORTED" and carried no badge. Detection
  worked; the *storage* didn't.

### The real fault: a derived value was persisted

`import_mentioned` stored the **output** of a regex without its **input**. So
the flag could not be recomputed: changing the pattern left every existing row
silently wrong, repairable only by a migration — and again by another one the
next time the pattern changed. The first attempt at a fix was exactly that
migration, which was the wrong instinct and was called out as such.

The advert text is now stored (~0.9KB per listing; 0.44MB at 500 cars against
D1's 5GB) and the flag is derived on read. Changing `mentionsImport` now applies
everywhere at once. This is the same principle already used for combination
matching — re-verified at read time rather than cached — which had been got
right there and violated here.

### Refresh: on observation, not on a timer

The question this exposed was broader: detail data was fetched **once** and
never again, so a seller's edits were invisible forever.

Rather than a staleness policy, the fix uses a fetch already being made. The
modal fetches the live page every time it opens, so that response is now written
back to storage. **Opening a car repairs its stored record** — at no extra
request, with no timer to tune, and no backfill migration. Verified on both
reported adverts: opening each populated its data correctly.

For cars nobody opens, a **price change** re-queues the detail, on the reasoning
that a seller who changed the price probably changed other things too.

### Badges

Solid = AutoTrader's provenance check. Dashed outline, same colour = the
advert's own words, shown only when they publish no check. Same claim, visibly
different strength of evidence.

---

## 2026-08-11 — Global filters, discard, copy button, favicon, import fallback

**Global filters.** `SavedSearch.globalFilters` applies to every combination,
with the combination winning where it sets the same filter — so a search shares
a write-off exclusion and mileage cap while each car keeps its own price range.

The merge lives in one helper, `effectiveCombo`, because it has to happen in
four places or the feature silently half-works: the filters sent to AutoTrader,
the ingest matcher, the detail-page unlink check, and — most easily missed —
the **read-time verification** in `getResults`. Without that last one,
tightening a global would not retro-filter listings already stored, exactly the
bug fixed earlier for combinations.

Verified live rather than by assertion alone: with no price filter, 4 results;
global £7,500, **1**; a combination overriding at £9,000, back to **4** — all
without a refresh.

A first attempt at that check looked like a failure and wasn't. The seed's
Mazda2 combination sets its own `max_price`, so the global was correctly
overridden; the test setup obscured the behaviour rather than the behaviour
being wrong.

**Discard.** A `discarded` table keyed on `advert_id`, like `starred`, so ruling
a car out hides it from every search that finds it. The listing row survives, so
price history and deltas continue, and it stays hidden when re-seen on a later
run rather than returning as "New".

**Import fallback.** AutoTrader's `IMPORTED` check was already extracted and
badged — 12 of 12 adverts in a live sample carried it. The gap is adverts with
no vehicle check at all, so `mentionsImport` reads the advert text
`normaliseAdvert` already parses, at zero extra requests. Deliberately strict:
"not imported", "imported parts", "import spec" and "Important:" must all be
rejected, because a wrong badge here costs a wasted trip. Twelve phrasings are
pinned in tests.

**Copy button.** Extracted `CopyButton` with real feedback and a fallback for
insecure contexts, replacing a fire-and-forget `writeText` that reported
nothing. Confirmed by sampling the label over time — it shows its failure state
under headless, where clipboard writes are denied, then resets.

**Favicon and title.** An SVG icon in `web/public` (Vite's default `publicDir`,
which did not exist), plus a document title that follows the view so several
saved searches are distinguishable when pinned.

### Follow-up: the results toolbar took three lines

Review feedback. Actions, sort and four checkboxes stacked to roughly 180px
before a single car was visible on a phone.

Now one row at **61px**: the actions are icon buttons (with `aria-label` and
`title`, since an icon reads as nothing to a screen reader), the sort sits
inline taking the leftover width, and the toggles moved behind a menu button
that carries a count badge — they are off most of the time, so the count is
enough to show at a glance that something is filtering.

The star and discard buttons on each card lost their button chrome at the same
time. Two bordered blocks stacked beside the title read heavier than the title;
they keep the 44px touch target but are now plain icons.

Two test artifacts worth remembering, both the same trap: `agent-browser`'s
`--name` matches on substring, so clicking "Filters" hit **"Edit filters"** and
navigated away, and earlier clicking "Make" hit the "Make and model" accordion
header. Target by class or ref when names overlap.

### Icons: lucide-react

The first pass used unicode glyphs (⟳ ⚙ ★ ☰). They render from whatever font
the platform picks, so weights and baselines never matched and some are emoji on
one OS and line art on another.

Now `lucide-react`: one consistent stroke set, tree-shaken to **+1.7 kB
gzipped** for the fourteen icons used. Every icon is `aria-hidden`, with the
accessible name on the button, since an SVG reads as nothing.

Worth noting one thing the swap exposed: "Edit filters" and the results filter
menu had both landed on the same icon. They do different jobs — one edits the
search's filter definition, the other filters the visible list — so they now use
`SlidersHorizontal` and `ListFilter` respectively.

### Test-harness note

`ALTER TABLE ADD COLUMN` is not idempotent the way `CREATE TABLE IF NOT EXISTS`
is, and the integration helper re-applies every migration before each test
against a shared database. It now tolerates "duplicate column name" and nothing
else. Real deployments apply each migration once.

---

## 2026-08-11 — Continuous deployment, and a binding rename that would have broken production

`.github/workflows/ci.yml`: `verify` on every PR and push, `deploy` on `main`
only, `smoke` after a successful deploy.

- **Migrations apply before the deploy**, so new code never meets an old schema.
  `wrangler d1 migrations apply` skips its confirmation prompt automatically
  when not attached to a terminal, so CI needs no extra flag — its `--help` says
  so, rather than this being assumed.
- **wrangler is called directly**, not through `cloudflare/wrangler-action`.
  The lockfile already pins the version the tests ran against, so this avoids
  version drift and keeps a third-party action out of the path of a token that
  can deploy code.
- **The smoke test is its own job.** It hits AutoTrader for real, so a failure
  means their schema moved or the market is empty — not that the deploy broke,
  which by then has already succeeded.
- Two guard steps fail with plain messages if `database_id` is still
  `REPLACE_ME` or the secrets are missing, instead of an opaque wrangler error.

### workers.dev would have quietly reopened on the next deploy

A custom domain behind Cloudflare Access was set up in the dashboard. The repo
knew nothing about it, and that is not neutral: `workers_dev` **defaults to
true**, so every deploy re-creates a `*.workers.dev` URL — one that answers
without passing through the Access policy, which only covers the custom domain.
Cloudflare's docs also state that wrangler overrides dashboard-configured routes
on deploy.

So the next merge to `main` would have silently reopened an unauthenticated way
in. Fixed with `workers_dev: false` and `preview_urls: false`.

`preview_urls` matters just as much and is easier to miss: it publishes
`<version>-<name>.<subdomain>.workers.dev`, which the custom domain's Access
policy does not cover.

No `routes` key, on purpose — the hostname stays out of a public repo, and
Cloudflare's documented way to keep routes dashboard-managed is to omit the keys
and set `workers_dev: false`. Confirmed `wrangler deploy --dry-run` accepts
that combination: routes are normally required when `workers_dev` is false, but
a Worker with cron triggers is exempt.

### The smoke job lasted exactly one deploy

It was wired to run after each deploy. AutoTrader returned **HTTP 403 on the
first request** from GitHub's runners. Isolated it properly rather than guessing:
the same commit, same code, passes from a laptop — so it is IP-range blocking,
not schema drift and not the deploy.

Removed rather than made non-blocking. A job that fails on every deploy is one
you stop reading, which is the same crying-wolf failure already fixed inside the
smoke script itself. The reason is recorded in `scripts/smoke.ts` so it does not
get re-added.

Two options were left on the table if post-deploy verification is wanted later:
smoke-test the deployed Worker instead (its requests to AutoTrader originate
from Cloudflare, not GitHub), which needs a Cloudflare Access service token once
Access is enabled.

### Also worth recording: secrets went to the wrong environment

The first deploy failed on the guard step with both secrets empty. The cause was
an environment accidentally *named* `CLOUDFLARE_ACCOUNT_ID` holding both
secrets, while the workflow looked at `production` — which GitHub had created
empty when the run referenced it. The guard reported exactly which secrets were
missing and where they belonged, instead of an opaque wrangler auth error.

### The find

While testing the `REPLACE_ME` guard, it passed when it should have failed —
because the working tree already had a real database id. Reading the diff:
`wrangler d1 create` had rewritten `wrangler.jsonc` and **renamed the D1 binding
from `DB` to `uk_car_finder`**.

`src/index.ts` declares `DB: D1Database` and there are 19 uses of `env.DB` in
`src/` alone. With that rename, `wrangler deploy` still succeeds and every
single API request then throws on an undefined binding — the worst shape of
failure, silent at deploy and total at runtime.

Binding restored to `DB`, verified with `wrangler deploy --dry-run`
(`env.DB (uk-car-finder)`), and a comment added to the config saying why it must
stay that way, since `wrangler d1 create` will try to rename it again.

---

## 2026-08-10 — Detail modal with the full photo gallery

The result cards showed one thumbnail and a link out to AutoTrader. Now tapping
the photo or title opens the whole advert in place.

### Fetched, not stored

The advert is fetched when you open it, reusing `fetchDetailPage` and
`extractAdvert` from the enrichment path. Storing every payload would add ~200KB
per listing for the few you actually look at, and photos, price and availability
all change. The cost is one request per open — user-initiated and rare — and a
sold advert reports itself plainly (404 → "no longer on AutoTrader") instead of
silently serving stale data.

### `fullDetail.ts`, separate from `normalise.ts`

`normaliseAdvert` deliberately extracts only what matching needs, and the drain
depends on it. Rather than widen it, `normaliseFullDetail` is a second reader of
the same `RawAdvert`: gallery with Interior/Exterior tags, spec tables, the
equipment list with Standard/Optional, the seller's description, MOT and service
history, the vehicle checks, and the seller.

Image URLs contain a literal `{resize}` token that AutoTrader's own site swaps
for `w600`/`w800`; left alone the URL 404s. `expandImageUrl` fills it, which also
lets thumbnails pull 160px versions instead of full-size originals.

Section shapes vary wildly between adverts — 10, 32, 44 and 68 photos across the
fixtures and live tests; a private advert with no spec table and no description;
a dealer's with 110 features in one "Other" bucket. Every section is optional and
nothing throws on a missing one.

### Verified

Live against a real advert: 68 photos in two categories, 7 feature groups, 16
description paragraphs, 5 history checks. In the browser: counter 1/68 → 2/68 on
next, Interior filter → 1/39, Escape closes and restores body scroll, no console
errors.

One blemish found by looking at it: the MOT badge read "MOT 12 months MOT
included", because AutoTrader's value sometimes already contains the word. Now
only prefixed when it doesn't.

### Follow-up: missing thumbnails, modal padding, and a wrong-model advert

**Cards without a photo.** `image_url` was only ever written by `applyDetail`,
so a listing had no thumbnail until the 15-minute detail queue reached it — on
the free plan, potentially hours after a big first run. The database confirmed
it exactly: 80 unenriched listings had 0 photos, 40 enriched had 40.

`SearchListing` turns out to expose `images: [String]!` — the whole gallery, in
the search response we already make. The cover photo is now stored at first
sighting, and `applyDetail` uses `COALESCE` so enrichment can't blank one it
lacks. Verified on a clean database: 35 listings, 35 photos, 27 of them still
unenriched, 0 broken images in the browser.

**Modal padding**, as asked.

**A Mazda6 in a Mazda2 search.** Spotted in the padding screenshot. The same
promoted-advert problem as the £17,250 car, through a different hole: `match.ts`
verified make and price but never *model*, so a £11,700 Mazda6 passed both. Now
checked against the title, comparing with punctuation and case stripped — the
facet says "C-Class" where a title says "C Class". Read-time verification meant
it disappeared without a refresh; a fresh run now rejects 4 rather than 2.

### Follow-up: why a search wouldn't save

Reported as "the test scenario can't be saved". Reproduced in the browser: the
combination was fine — make selected, label derived — but **Save was greyed out
because the postcode was empty, and nothing said so.** The only hint covered a
missing make. Checked whether the requirement was self-imposed: it isn't, the
search gateway rejects a request without one ("postcode - A required filter").

The disabled button now names exactly what is missing, and which combination it
is missing from.

The "Use MINI + Mazda2 example" button is gone. It existed to seed a test
scenario, which a script does better: `pnpm run seed [--refresh] [--url ...]`.
It posts through the API rather than writing to D1, so it exercises the same
validation the browser does, works against a deployed Worker, and can't hit the
SQLITE_BUSY that touching the local database while wrangler holds it causes.

### Process note

`pnpm run typecheck | tail -2 && echo OK` reported success while tsc was
failing — `tail` exits 0 regardless, so the `&&` always fired. Check the exit
code of the command itself, not of a pipeline ending in `tail`.

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
- ~~Register for the DVSA MOT History API~~ — done 2026-08-19; the panel and
  the per-plate cache landed with it.
