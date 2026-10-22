# Mission Control - Health Collector

A local launchd daemon that watches this Mac's Quay 1 automation and pushes
health summaries to Supabase for the Mission Control dashboard.

## What it does (each cycle)

1. **Job discovery** - globs `~/Library/LaunchAgents/com.quay1.*.plist`
   (and `.plist.disabled`, and `/Library/LaunchDaemons`), parses each with
   `plutil`, and also greps `launchctl list` so loaded-but-not-on-disk jobs are
   still caught. No job list is hardcoded - add a `com.quay1.*` agent and it
   shows up automatically next cycle.
2. **Log scan** - for each job it reads the *tail* (≤400 KB) of its
   StandardOut/StandardError plus any `logs/*.log` next to the script, counts
   `ERROR / CRITICAL / FATAL / Traceback / Exception` lines in the last 24h,
   keeps the newest as `latest_error`, and dedupes distinct errors by a
   normalised fingerprint.
3. **State** - classifies each job `ok / idle / stalled / error / disabled /
   unknown` (see `compute_state`).
4. **Site health** - GETs every app URL from `../assets/config.js` (`SITES`)
   with a 10s timeout and records status + latency.
5. **Heartbeat** - upserts a single freshness row every cycle.

Results land in `mc_job_health`, `mc_code_errors`, `mc_site_health`,
`mc_collector_heartbeat` (defined in `../supabase/mission_control.sql` - apply
that first).

## Credentials

The collector writes with the Supabase **SERVICE ROLE** key (bypasses RLS). It
is resolved exactly like the other Quay daemons:

1. `SUPABASE_SERVICE_ROLE_KEY` env var, else
2. the macOS Keychain:
   `security find-generic-password -s SUPABASE_SERVICE_ROLE_KEY -a supabase-quay-clock -w`

`SUPABASE_URL` comes from the env or defaults to the Quay 1 project URL.

If the key is missing the collector logs a clear
`SERVICE_ROLE_KEY not found` line and still completes the local job/site scan
(it just skips the push).

### Store the key if missing

```bash
security add-generic-password -s SUPABASE_SERVICE_ROLE_KEY \
  -a supabase-quay-clock -w '<service-role-jwt>'
```

## Install (launchd)

```bash
bash scripts/install_collector.sh
```

Copies the plist into `~/Library/LaunchAgents/`, unloads any previous copy, then
loads it. Runs once at load and every 300s thereafter. Logs go to
`collector/logs/collector.{stdout,stderr}.log`.

## Run manually

```bash
# single cycle (what launchd runs):
/usr/bin/python3 collector/collector.py --once

# loop in the foreground with a custom interval:
/usr/bin/python3 collector/collector.py --interval 600
```

## Notes

- Pure Python stdlib (uses `urllib`, not `requests`) so it runs on the system
  `/usr/bin/python3` with no venv.
- Robust by design: one failing job or site is logged and skipped, never
  crashing the cycle.
