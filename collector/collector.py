#!/usr/bin/env python3
"""Quay 1 Mission Control - local health collector daemon.

Scans local launchd jobs (com.quay1.*), their logs, and app site reachability,
then upserts summaries into Supabase (project dqszbqiimbfvmmnpgpsb) via the
PostgREST REST API using the SERVICE ROLE key (bypasses RLS).

Design notes:
  * Pure stdlib only (urllib for HTTP). /usr/bin/python3 (3.9) has no `requests`,
    so we avoid that dependency entirely - the brief allows stdlib + requests and
    stdlib-only is the robust subset.
  * Job discovery is self-maintaining: it globs the LaunchAgents dir and also
    greps `launchctl list` so loaded-but-not-on-disk jobs are still seen. No
    hardcoded job list.
  * Every per-job / per-site step is wrapped in try/except so one failure can
    never crash the cycle.

Usage:
  collector.py --once                # single cycle (used by launchd StartInterval)
  collector.py                       # loop forever, default 300s interval
  collector.py --interval 600        # loop with a custom interval
"""
import argparse
import glob
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone, timedelta

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VERSION = "mc-collector/1.0"
REPO_ROOT = "/Users/paganstorm/Projects/quay-mission-control"
CONFIG_JS = os.path.join(REPO_ROOT, "assets", "config.js")

SUPABASE_URL_DEFAULT = "https://dqszbqiimbfvmmnpgpsb.supabase.co"
KEYCHAIN_SERVICE = "SUPABASE_SERVICE_ROLE_KEY"
KEYCHAIN_ACCOUNT = "supabase-quay-clock"

LAUNCH_AGENT_DIRS = [
    os.path.expanduser("~/Library/LaunchAgents"),
    "/Library/LaunchDaemons",
]
PLIST_GLOBS = ["com.quay1.*.plist", "com.quay1.*.plist.disabled"]

# Error detection
ERROR_PATTERNS = [
    ("CRITICAL", re.compile(r"\bCRITICAL\b")),
    ("TRACEBACK", re.compile(r"Traceback \(most recent call last\)")),
    ("FATAL", re.compile(r"\bFATAL\b")),
    ("ERROR", re.compile(r"\bERROR\b")),
    ("ERROR", re.compile(r"\bException\b")),
]
TAIL_BYTES = 400 * 1024          # never read more than 400 KB from the end of a log
ERROR_WINDOW_SECS = 24 * 3600    # only count errors from the last 24h
STALL_MULTIPLIER = 3             # stalled if (now - last_log) > N * expected_interval
MAX_CODE_ERROR_ROWS = 200        # cap error rows pushed per cycle
HTTP_TIMEOUT = 10

# leading log timestamp, e.g. "2026-10-22 12:24:54" or ISO "2026-10-22T12:24:54"
TS_RE = re.compile(r"^\[?(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})")


def log(msg):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"{now}  [mc-collector] {msg}", flush=True)


def utc_iso(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------
def resolve_creds():
    """Return (supabase_url, service_key_or_None). Mirrors live_dialfire_daemon.py."""
    url = (os.environ.get("SUPABASE_URL") or SUPABASE_URL_DEFAULT).strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not key:
        # Fall back to the macOS Keychain so the plist needn't embed the secret:
        #   security add-generic-password -s SUPABASE_SERVICE_ROLE_KEY \
        #     -a supabase-quay-clock -w '<jwt>'
        try:
            key = subprocess.check_output(
                ["security", "find-generic-password",
                 "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
                stderr=subprocess.DEVNULL,
            ).decode().strip()
        except Exception:
            key = ""
    return url, key


# ---------------------------------------------------------------------------
# Supabase REST (stdlib urllib)
# ---------------------------------------------------------------------------
import urllib.request
import urllib.error
import urllib.parse


def _headers(key, extra=None):
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def supabase_upsert(url, key, table, rows, on_conflict=None):
    """Upsert rows (merge-duplicates) into a PostgREST table. Returns True on 2xx."""
    if not rows:
        return True
    endpoint = f"{url}/rest/v1/{table}"
    if on_conflict:
        endpoint += "?on_conflict=" + urllib.parse.quote(on_conflict)
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        endpoint, data=body, method="POST",
        headers=_headers(key, {
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }),
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        log(f"[supabase] upsert {table} HTTP {e.code}: {detail}")
    except Exception as e:
        log(f"[supabase] upsert {table} failed: {e}")
    return False


def supabase_select_fingerprints(url, key, fingerprints):
    """GET existing mc_code_errors rows by fingerprint -> {fp: {first_seen,count}}."""
    out = {}
    if not fingerprints:
        return out
    in_list = ",".join(f'"{fp}"' for fp in fingerprints)
    q = urllib.parse.urlencode({
        "select": "fingerprint,first_seen,count",
        "fingerprint": f"in.({in_list})",
    })
    endpoint = f"{url}/rest/v1/mc_code_errors?{q}"
    req = urllib.request.Request(endpoint, method="GET", headers=_headers(key))
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            for row in json.loads(resp.read().decode("utf-8")):
                out[row["fingerprint"]] = row
    except Exception as e:
        log(f"[supabase] select mc_code_errors failed (treating all as new): {e}")
    return out


# ---------------------------------------------------------------------------
# plist + launchctl parsing
# ---------------------------------------------------------------------------
def plutil_json(path):
    """Convert a plist to JSON. Returns dict, list, or None."""
    try:
        out = subprocess.check_output(
            ["plutil", "-convert", "json", "-o", "-", path],
            stderr=subprocess.DEVNULL,
        )
        return json.loads(out.decode("utf-8"))
    except Exception:
        return None


_LC_PID = re.compile(r'"PID"\s*=\s*(\d+)')
_LC_EXIT = re.compile(r'"LastExitStatus"\s*=\s*(-?\d+)')
_LC_STR = lambda field: re.compile(r'"%s"\s*=\s*"([^"]*)"' % field)


def launchctl_detail(label):
    """`launchctl list <Label>` -> dict with pid, last_exit, stdout, stderr, args.

    Returns None if the job is not loaded (nonzero exit / no output)."""
    try:
        out = subprocess.check_output(
            ["launchctl", "list", label],
            stderr=subprocess.DEVNULL,
        ).decode("utf-8")
    except Exception:
        return None
    d = {"loaded": True, "pid": None, "last_exit": None,
         "stdout": None, "stderr": None, "args": None}
    m = _LC_PID.search(out)
    if m:
        d["pid"] = int(m.group(1))
    m = _LC_EXIT.search(out)
    if m:
        d["last_exit"] = int(m.group(1))
    m = _LC_STR("StandardOutPath").search(out)
    if m:
        d["stdout"] = m.group(1)
    m = _LC_STR("StandardErrorPath").search(out)
    if m:
        d["stderr"] = m.group(1)
    # ProgramArguments block
    pa = re.search(r'"ProgramArguments"\s*=\s*\((.*?)\);', out, re.DOTALL)
    if pa:
        d["args"] = re.findall(r'"([^"]*)"', pa.group(1))
    return d


def launchctl_quay_labels():
    """Grep `launchctl list` for every loaded com.quay1 label -> {label: (pid, status)}."""
    found = {}
    try:
        out = subprocess.check_output(
            ["launchctl", "list"], stderr=subprocess.DEVNULL).decode("utf-8")
    except Exception:
        return found
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3 and "com.quay1." in parts[2]:
            label = parts[2].strip()
            pid = None if parts[0].strip() in ("-", "") else int(parts[0])
            status = None if parts[1].strip() in ("-", "") else int(parts[1])
            found[label] = (pid, status)
    return found


def derive_interval_from_calendar(cal):
    """StartCalendarInterval -> a sane expected interval in seconds (daily-ish)."""
    if isinstance(cal, dict):
        return 86400           # a single daily time
    if isinstance(cal, list) and cal:
        return max(1, 86400 // len(cal))  # N times per day
    return None


def discover_jobs():
    """Glob LaunchAgents/Daemons + launchctl grep. Returns list of job dicts."""
    jobs = {}        # label -> job dict
    seen_paths = set()

    for d in LAUNCH_AGENT_DIRS:
        for pat in PLIST_GLOBS:
            for path in glob.glob(os.path.join(d, pat)):
                if path in seen_paths:
                    continue
                seen_paths.add(path)
                try:
                    job = _job_from_plist(path)
                    if job:
                        jobs[job["job"]] = job
                except Exception as e:
                    log(f"[discover] {path}: {e}")

    # Catch loaded jobs that aren't on disk (or whose file we missed).
    for label, (pid, status) in launchctl_quay_labels().items():
        if label not in jobs:
            jobs[label] = {
                "job": label, "label": _friendly(label), "category": "other",
                "plist_path": None, "disabled": False, "run_at_load": None,
                "keep_alive": None, "start_interval": None,
                "start_calendar": None, "program_args": None,
                "stdout": None, "stderr": None,
                "expected_interval_secs": None,
            }
    return list(jobs.values())


def _friendly(label):
    return label.replace("com.quay1.", "").replace(".", " ")


def _job_from_plist(path):
    base = os.path.basename(path)
    is_disabled_file = base.endswith(".plist.disabled")
    label = base[:-len(".plist.disabled")] if is_disabled_file else base[:-len(".plist")]

    parsed = plutil_json(path)
    # Real Mac plists parse to a dict. In some stub/export setups the file is
    # just the ProgramArguments array - handle both shapes.
    d = {}
    prog_args = None
    if isinstance(parsed, dict):
        d = parsed
        prog_args = d.get("ProgramArguments")
        label = d.get("Label") or label
    elif isinstance(parsed, list):
        prog_args = parsed

    start_interval = d.get("StartInterval")
    start_calendar = d.get("StartCalendarInterval")
    expected = start_interval
    if expected is None and start_calendar is not None:
        expected = derive_interval_from_calendar(start_calendar)

    return {
        "job": label,
        "label": _friendly(label),
        "plist_path": path,
        "disabled": bool(d.get("Disabled")) or is_disabled_file,
        "run_at_load": d.get("RunAtLoad"),
        "keep_alive": d.get("KeepAlive"),
        "start_interval": start_interval,
        "start_calendar": start_calendar,
        "program_args": prog_args,
        "stdout": d.get("StandardOutPath"),
        "stderr": d.get("StandardErrorPath"),
        "expected_interval_secs": expected,
        "category": None,  # filled after runtime enrichment
    }


def categorize(job, pid):
    if job["disabled"]:
        return "disabled"
    si = job.get("start_interval")
    has_schedule = si is not None or job.get("start_calendar") is not None
    resident = pid is not None
    is_daemon = (
        (si is not None and si <= 300)
        or bool(job.get("keep_alive"))
        or (not has_schedule and (bool(job.get("run_at_load")) or resident))
    )
    if is_daemon:
        return "daemon"
    if has_schedule:
        return "scheduled"
    return "other"


# ---------------------------------------------------------------------------
# Log scanning
# ---------------------------------------------------------------------------
def script_dir_logs(prog_args):
    """Find logs/*.log next to the script in ProgramArguments."""
    paths = []
    if not prog_args:
        return paths
    for arg in prog_args:
        if isinstance(arg, str) and (arg.endswith(".py") or arg.endswith(".sh")):
            d = os.path.dirname(arg)
            paths.extend(glob.glob(os.path.join(d, "logs", "*.log")))
            break
    return paths


def candidate_logs(job):
    out = []
    for p in (job.get("stdout"), job.get("stderr")):
        if p:
            out.append(p)
    out.extend(script_dir_logs(job.get("program_args")))
    # dedupe, keep only existing non-empty-path files
    seen, result = set(), []
    for p in out:
        if p and p not in seen and os.path.isfile(p):
            seen.add(p)
            result.append(p)
    return result


def read_tail(path, nbytes=TAIL_BYTES):
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            if size > nbytes:
                f.seek(size - nbytes)
                f.readline()  # discard partial first line
            return f.read().decode("utf-8", "replace")
    except Exception:
        return ""


def parse_line_ts(line):
    m = TS_RE.match(line)
    if not m:
        return None
    try:
        dt = datetime(*[int(x) for x in m.groups()])  # naive local time
        return dt.astimezone()  # attach local tz
    except Exception:
        return None


def match_level(line):
    for level, rx in ERROR_PATTERNS:
        if rx.search(line):
            return level
    return None


_NORM_HEX = re.compile(r"0x[0-9a-fA-F]+")
_NORM_PATH = re.compile(r"/[^\s:]+")
_NORM_NUM = re.compile(r"\d+")


def normalise(message):
    s = _NORM_HEX.sub("0xHEX", message)
    s = _NORM_PATH.sub("/PATH", s)
    s = _NORM_NUM.sub("#", s)
    return re.sub(r"\s+", " ", s).strip()[:200]


def scan_logs(job, now):
    """Scan candidate logs. Mutates job with last_log_ts/error_count_24h/latest_error.
    Returns list of error occurrence dicts for mc_code_errors."""
    cutoff = now - timedelta(seconds=ERROR_WINDOW_SECS)
    last_log_ts = None
    error_count = 0
    latest_error = None
    latest_error_ts = None
    log_path_for_row = None
    errors = {}  # fingerprint -> {level,message,log_path,count,first,last}

    for path in candidate_logs(job):
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
        except Exception:
            continue
        if last_log_ts is None or mtime > last_log_ts:
            last_log_ts = mtime
        if log_path_for_row is None:
            log_path_for_row = path

        file_recent = mtime >= cutoff
        text = read_tail(path)
        for line in text.splitlines():
            level = match_level(line)
            if not level:
                continue
            ts = parse_line_ts(line)
            if ts is not None:
                if ts < cutoff:
                    continue
                eff_ts = ts.astimezone(timezone.utc)
            else:
                # No per-line timestamp: rely on file mtime for the 24h gate.
                if not file_recent:
                    continue
                eff_ts = mtime
            error_count += 1
            msg = line.strip()[:500]
            fp = hashlib.sha1(
                f"{job['job']}|{normalise(msg)}".encode("utf-8")).hexdigest()
            rec = errors.get(fp)
            if rec is None:
                errors[fp] = {"fingerprint": fp, "level": level, "message": msg,
                              "log_path": path, "count": 1,
                              "first": eff_ts, "last": eff_ts}
            else:
                rec["count"] += 1
                if eff_ts < rec["first"]:
                    rec["first"] = eff_ts
                if eff_ts > rec["last"]:
                    rec["last"] = eff_ts
                    rec["message"] = msg
            if latest_error_ts is None or eff_ts >= latest_error_ts:
                latest_error_ts = eff_ts
                latest_error = msg

    job["last_log_ts"] = last_log_ts
    job["error_count_24h"] = error_count
    job["latest_error"] = latest_error
    job["log_path"] = log_path_for_row
    return errors


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
def compute_state(job, now):
    """Job state from ACTUAL run outcome, not merely "a log contains ERROR".

    Hard 'error' is reserved for a genuinely failed last run (nonzero launchd
    exit) or a stalled schedule. A job that ran and exited cleanly but whose
    logs carry handled/transient noise in the window (recovered Sheets/HTTP
    timeouts, DNS blips on wake, per-record skips) is 'warn' (amber) — it is NOT
    broken. This stops the board painting healthy jobs red.
    """
    if job["category"] == "disabled":
        return "disabled"

    last_exit = job.get("last_exit")
    pid = job.get("pid")
    # A currently-running daemon is up, whatever its last recorded exit was
    # (long-running jobs show the status of their previous restart). Only treat
    # a NON-running job's nonzero exit as a real failure — and not when it was
    # simply signalled to stop (SIGTERM=15 / 128+15=143 on reload/sleep).
    SIGNAL_EXITS = (15, 143)
    if not pid and isinstance(last_exit, int) and last_exit != 0 and last_exit not in SIGNAL_EXITS:
        return "error"

    expected = job.get("expected_interval_secs")
    last_log_ts = job.get("last_log_ts")
    if expected and last_log_ts:
        age = (now - last_log_ts).total_seconds()
        if age > STALL_MULTIPLIER * expected:
            return "stalled"

    loaded = job.get("loaded", False)
    recent_threshold = STALL_MULTIPLIER * expected if expected else ERROR_WINDOW_SECS
    has_recent = bool(last_log_ts) and (now - last_log_ts).total_seconds() <= recent_threshold
    has_errors = job.get("error_count_24h", 0) > 0

    # Recent log activity is the strongest "it's alive" signal — stronger than
    # launchctl's loaded flag, whose per-job reads can intermittently come back
    # empty. If a job wrote to its log inside the window, it ran: ok (or amber
    # if the logs are noisy), never "unknown".
    if has_recent:
        return "warn" if has_errors else "ok"
    if loaded:
        # Loaded, scheduled, no recent output yet — waiting for its next run.
        return "warn" if has_errors else "idle"
    # No recent activity and not confirmed loaded: noise → warn, else unclear.
    if has_errors:
        return "warn"
    return "unknown"


def enrich_runtime(job):
    """Attach launchctl runtime state (pid, last_exit) + fallback log paths."""
    detail = launchctl_detail(job["job"])
    if detail is None:
        job["loaded"] = False
        job["pid"] = None
        job["last_exit"] = None
        return
    job["loaded"] = True
    job["pid"] = detail["pid"]
    job["last_exit"] = detail["last_exit"]
    # Fallbacks when the plist file lacked these (e.g. stub plists).
    if not job.get("stdout") and detail.get("stdout"):
        job["stdout"] = detail["stdout"]
    if not job.get("stderr") and detail.get("stderr"):
        job["stderr"] = detail["stderr"]
    if not job.get("program_args") and detail.get("args"):
        job["program_args"] = detail["args"]


# ---------------------------------------------------------------------------
# Sites
# ---------------------------------------------------------------------------
_SITE_OBJ = re.compile(r"\{[^{}]*?\}")
_KEY = lambda k: re.compile(r"%s\s*:\s*'([^']*)'" % k)


def load_sites():
    """Parse the SITES array out of assets/config.js."""
    try:
        with open(CONFIG_JS, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception as e:
        log(f"[sites] cannot read {CONFIG_JS}: {e}")
        return []
    m = re.search(r"SITES\s*:\s*\[(.*?)\]", text, re.DOTALL)
    if not m:
        log("[sites] no SITES array found in config.js")
        return []
    block = m.group(1)
    sites = []
    for obj in _SITE_OBJ.findall(block):
        gid = _KEY("id").search(obj)
        label = _KEY("label").search(obj)
        url = _KEY("url").search(obj)
        if gid and url:
            sites.append({"id": gid.group(1),
                          "label": label.group(1) if label else gid.group(1),
                          "url": url.group(1)})
    return sites


def check_site(site, now):
    url = site["url"]
    t0 = time.time()
    status = None
    ok = False
    req = urllib.request.Request(
        url, method="GET",
        headers={"User-Agent": "mc-collector/1.0 (+quay1 mission control)"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception as e:
        log(f"[sites] {site['id']} ({url}) error: {e}")
    ms = int((time.time() - t0) * 1000)
    if status is not None:
        ok = 200 <= status < 400
    return {
        "site": site["id"], "label": site["label"], "url": url,
        "http_status": status, "ok": ok, "response_ms": ms,
        "checked_at": utc_iso(now),
    }


# ---------------------------------------------------------------------------
# Cycle
# ---------------------------------------------------------------------------
def run_once(url, key, push):
    t0 = time.time()
    now = datetime.now(timezone.utc)
    host = socket.gethostname()

    # --- jobs ---
    jobs = discover_jobs()
    job_rows = []
    all_errors = {}  # fingerprint -> record
    for job in jobs:
        try:
            enrich_runtime(job)
            job["category"] = categorize(job, job.get("pid"))
            errs = scan_logs(job, now)
            for fp, rec in errs.items():
                rec["job"] = job["job"]
                all_errors[fp] = rec  # per-cycle fingerprints are job-scoped & unique
            job["state"] = compute_state(job, now)
            program = " ".join(job["program_args"]) if job.get("program_args") else None
            job_rows.append({
                "job": job["job"],
                "label": job["label"],
                "category": job["category"],
                "state": job["state"],
                "last_exit": job.get("last_exit"),
                "pid": job.get("pid"),
                "last_log_ts": utc_iso(job.get("last_log_ts")),
                "expected_interval_secs": job.get("expected_interval_secs"),
                "error_count_24h": job.get("error_count_24h", 0),
                "latest_error": job.get("latest_error"),
                "program": program,
                "log_path": job.get("log_path"),
                "updated_at": utc_iso(now),
            })
        except Exception as e:
            log(f"[job] {job.get('job')} failed: {e}")
            log(traceback.format_exc())

    states = {}
    for r in job_rows:
        states[r["state"]] = states.get(r["state"], 0) + 1
    log(f"[jobs] {len(job_rows)} jobs: " +
        ", ".join(f"{k}={v}" for k, v in sorted(states.items())))

    # --- sites ---
    sites = load_sites()
    site_rows = []
    for s in sites:
        try:
            site_rows.append(check_site(s, now))
        except Exception as e:
            log(f"[sites] {s.get('id')} failed: {e}")
    up = sum(1 for r in site_rows if r["ok"])
    log(f"[sites] {len(site_rows)} checked, {up} ok")

    # --- code errors (cap + preserve first_seen) ---
    error_rows = []
    if all_errors:
        ranked = sorted(all_errors.values(), key=lambda r: r["last"], reverse=True)
        if len(ranked) > MAX_CODE_ERROR_ROWS:
            log(f"[errors] {len(ranked)} distinct errors; truncating to "
                f"{MAX_CODE_ERROR_ROWS} most-recent")
            ranked = ranked[:MAX_CODE_ERROR_ROWS]
        # Preserve first_seen across cycles: GET the existing rows and only set
        # first_seen from this cycle when the fingerprint is new.
        # `count` is the number of occurrences currently visible in the 24h scan
        # window (NOT cumulative): each cycle re-reads the same tail, so adding
        # to the prior count would inflate it ~288x/day. Current-window count is
        # a stable, meaningful "how often is this erroring lately" figure.
        fps = [r["fingerprint"] for r in ranked]
        existing = supabase_select_fingerprints(url, key, fps) if push else {}
        for r in ranked:
            fp = r["fingerprint"]
            prior = existing.get(fp)
            first_seen = prior["first_seen"] if prior else utc_iso(r["first"])
            count = r["count"]
            error_rows.append({
                "fingerprint": fp,
                "job": r["job"],
                "log_path": r["log_path"],
                "level": r["level"],
                "message": r["message"],
                "first_seen": first_seen,
                "last_seen": utc_iso(r["last"]),
                "count": count,
                "updated_at": utc_iso(now),
            })
    log(f"[errors] {len(error_rows)} error rows to upsert")

    # --- push ---
    if push:
        supabase_upsert(url, key, "mc_job_health", job_rows, on_conflict="job")
        supabase_upsert(url, key, "mc_code_errors", error_rows, on_conflict="fingerprint")
        supabase_upsert(url, key, "mc_site_health", site_rows, on_conflict="site")
    else:
        log("[push] SKIPPED (no SERVICE_ROLE_KEY) - scan completed locally only")

    duration_ms = int((time.time() - t0) * 1000)
    hb = [{
        "id": 1, "last_run": utc_iso(now), "duration_ms": duration_ms,
        "host": host, "version": VERSION,
        "note": f"{len(job_rows)} jobs, {len(site_rows)} sites, {len(error_rows)} errors",
        "updated_at": utc_iso(now),
    }]
    if push:
        supabase_upsert(url, key, "mc_collector_heartbeat", hb, on_conflict="id")
    log(f"[cycle] done in {duration_ms}ms")
    return duration_ms


def main():
    ap = argparse.ArgumentParser(description="Quay 1 Mission Control collector")
    ap.add_argument("--once", action="store_true", help="run a single cycle and exit")
    ap.add_argument("--interval", type=int, default=300,
                    help="loop interval in seconds (default 300)")
    args = ap.parse_args()

    url, key = resolve_creds()
    push = bool(key)
    log("=" * 60)
    log(f"starting {VERSION} on {socket.gethostname()}")
    log(f"supabase_url = {url}")
    if push:
        log(f"service_key  = {key[:8]}...{key[-4:]} (len={len(key)})")
    else:
        log("SERVICE_ROLE_KEY not found in env or Keychain "
            f"(service={KEYCHAIN_SERVICE}, account={KEYCHAIN_ACCOUNT}); "
            "will scan locally but NOT push to Supabase")
    log("=" * 60)

    if args.once:
        try:
            run_once(url, key, push)
        except Exception as e:
            log(f"[cycle] error: {e}")
            log(traceback.format_exc())
        return

    log(f"loop mode, interval={args.interval}s")
    while True:
        try:
            run_once(url, key, push)
        except Exception as e:
            log(f"[cycle] error: {e}")
            log(traceback.format_exc())
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
