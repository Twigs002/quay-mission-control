# Quay 1 — Mission Control

Superuser-only operations overview for the Quay 1 app suite. Lives in the shared
app-switcher dropdown. One place to answer "is everything OK?".

- **Sites** — live up/down + response time for every Quay 1 app.
- **Clock** — who's clocked in right now, missing clock-outs, pending leave.
- **Jobs & Health** — every `com.quay1.*` launchd job: running / stalled / errored.
- **Code Errors** — recent errors pulled from the local automation logs.
- **Usage** — who opened which app, when (captured via the shared nav ping).
- **Issues** — report + triage issues logged by people.

## Architecture

- **Front-end** (`index.html`, `assets/`): static site on GitHub Pages. Vanilla JS
  + supabase-js. Signs in with username + PIN (any `staff.is_super`); reads
  everything from the shared Supabase project under RLS. No build step.
- **Schema** (`supabase/mission_control.sql`): new `mc_*` tables + superuser-only
  read policies. Apply once in the Supabase SQL editor.
- **Collector** (`collector/`): a local launchd daemon that scans `com.quay1.*`
  jobs, tails their logs, pings each site, and pushes summaries to Supabase every
  5 minutes. See `collector/README.md`.

## Setup (one-time)

1. Apply `supabase/mission_control.sql` in the Supabase SQL editor.
2. `bash scripts/install_collector.sh` to load the health collector.
3. Add `mission` to `quay-nav.js` SITES (already done in quay-dashboard-v2) and
   redeploy that repo so the app appears in every switcher.
