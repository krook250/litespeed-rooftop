# Rooftop Auto

Dealer inventory, merchandising and syndication for independent used car lots.
One inventory record that pushes to the dealer's own website, Meta, Google
Vehicle Ads and the aggregators.

Vertical product under Litespeed Marketing LLC. Positioned against CarsForSale,
Dealer Car Search and DealerCenter — **not** against a DMS. Rooftop works with
the dealer's DMS; it does not replace accounting, F&I, parts, service or title.

Stack: Next.js 16 (App Router, TypeScript) · Drizzle ORM · Postgres · Tailwind v4.
Deploy target: Vercel.

---

## Running it

You need a Postgres database. Neon's free tier is the least friction and works
identically for local dev and Vercel.

```bash
npm install
cp .env.example .env          # then paste your DATABASE_URL into .env
npm run db:migrate            # creates the schema
npm run db:seed               # loads the Evergreen Motors demo dealer
npm run dev
```

Open http://localhost:3000 — you land on the login. Credentials are pre-filled:

```
dave@evergreenmotorswa.com / rooftop
```

`npm run db:seed` is destructive and idempotent: it wipes every table and
rebuilds the demo from scratch. Run it before a dealer walkthrough to reset any
price changes you made while practising.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run db:generate` | Regenerate SQL migrations after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Wipe and reseed the demo dealer |
| `npm run db:reset` | Migrate then seed |

---

## The demo path

The walkthrough that lands, in order:

1. **`/admin`** — the lot at a glance. Aging distribution, at-risk list, recon
   board, water units, days supply and turn rate against real benchmarks.
2. **`/admin/inventory`** — 25 units, aging buckets colour-coded. Toggle
   **Days in stock** vs **Days front line** in the header: same lot, two clocks.
   Cost, pack, recon and gross are visible here and nowhere public.
3. **`/admin/inventory/{id}`** — one record. Photos, per-VIN merchandising, and
   per-channel copy overrides (Marketplace copy is not website copy).
4. **`/admin/syndication`** — the money screen. **Change a price in the left
   column and watch the row move.** Push channels land in seconds; feed channels
   go blue and wait for their next fetch, with a live countdown.
5. **`/s/vancouver`** and the VDP — what the shopper sees, updated by the same
   record.
6. **`/admin/reporting`** — days supply, turn rate, VDP views by channel, aging
   distribution, recon time. Every figure is computed from seeded data; nothing
   is hardcoded.

Two storefronts are live: `/s/vancouver` and `/s/battle-ground`. They render
from separate rooftops with their own branding, which is the multi-rooftop story
without needing to explain it.

### Things seeded on purpose

- A **broken CarGurus connection** on the Vancouver rooftop. Listings are still
  up but changes are not flowing since Jul 30, and the matrix shows those cells
  as *live but stale* rather than a clean green check. There is a Reconnect
  button. Showing a tool that catches a broken feed sells better than showing
  one that pretends feeds never break.
- **Cars.com not connected** and **Autotrader pending setup** on Battle Ground.
- Two **rejected listings** with believable reasons (unmapped trim, duplicate
  Craigslist content).
- Three **water units** — total cost above market — two of them pulled off the
  paid marketplaces to stop the bleed.
- Turn rate lands around 8–9x against a 12x benchmark. That gap is the pitch.

---

## How syndication is modelled

`src/lib/sync-engine.ts` is a mock. No network calls happen. But the state
machine, the timing model and the event log are the real ones — when the
integrations land, that file gets a transport and nothing else changes.

Two transports, and the difference is represented honestly:

- **`PUSH_API`** — we call the channel. Real world: seconds to a couple of
  minutes. Compressed to 4–9 seconds so a change lands inside a demo
  conversation.
- **`FEED_PULL`** — the channel fetches our feed on its own schedule.
  Rebuilding the feed does not make Google read it any sooner. Any tool showing
  an instant green check on a feed channel is showing you its own queue.

Every change writes a `sync_events` row. The activity log is append-only, which
is what makes "I changed it here and it went everywhere" auditable rather than a
magic trick.

The sync worker is driven from the browser on the syndication screen (the
"Sync worker running" pill, which you can pause mid-demo). In production that is
a background worker, not a page poll.

---

## Data model

| Table | Notes |
| --- | --- |
| `dealer_groups` → `rooftops` | A rooftop is one physical lot. |
| `storefronts` + `storefront_rooftops` | A storefront is one public website mapped to 1..N rooftops. This is how a group runs several physical rooftops as one virtual rooftop online. |
| `vehicles` | One record. `cost` / `pack` / `recon_cost` are **internal only** and never enter a syndication payload. |
| `vehicle_photos` | Ordered, one lead photo. |
| `price_changes` | Every reprice, with reason and who did it. |
| `channels` → `channel_connections` | A channel per rooftop, with its own account and health. |
| `vehicle_sync_states` | Current listing state per vehicle × connection, with `remote_url` so you can click into the live listing. |
| `sync_events` | Append-only activity log. |
| `vehicle_channel_overrides` | Per-VIN, per-channel title / description / price / exclude. |
| `vehicle_daily_stats`, `sales` | Reporting inputs. Days supply and turn rate are computed, not stored. |

Aging buckets and days-in-stock are **computed**, never stored — see
`src/lib/domain.ts`, which is the single source of truth for every dealer
number in the app.

VINs in the seed are structurally valid: real WMI, correct model-year code and a
correct position-9 check digit (`src/lib/vin.ts`), so anything pasted into a
decoder behaves sensibly.

---

## Photos

The demo ships without real lot photography, so `src/lib/photo-svg.ts` generates
studio-style vector renders keyed off the VIN, in each unit's actual exterior
colour, with the dealer name watermarked the way a lot watermarks its own
photos. The odometer shot shows the unit's real mileage.

They are served from `/api/photo` as SVG. Real photos replace them by swapping
the `url` string on `vehicle_photos` — nothing else in the app changes.

---

## Deliberately not built

Per scope: no real API integrations, no DMS-style accounting or F&I, no dealer
auth beyond the hardcoded demo login, no CRM. Leads are captured to a `leads`
table from the VDP form so reporting has something real to count, and that is
where it stops.

---

## Deploying to Vercel

1. Push this repo to GitHub, import it in Vercel.
2. Set `DATABASE_URL` as an environment variable (Neon connection string, or add
   the Neon integration).
3. Deploy, then run `npm run db:migrate && npm run db:seed` once against the
   production database from your machine with `DATABASE_URL` pointed at it.

Everything is server-rendered on demand; there is no ISR or edge runtime to
configure.
