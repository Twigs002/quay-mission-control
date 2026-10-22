/* Quay 1 — Mission Control. Owner-only ops overview.
 * Static site: vanilla JS + supabase-js (CDN). Light theme only. */
(function () {
  'use strict';

  var CFG = window.MC_CFG;
  if (!CFG) { console.error('MC_CFG missing (assets/config.js not loaded)'); return; }

  // ---- small DOM helpers -------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase() || '?'; }

  // ---- brand mark (inline SVG, no external asset) ------------------------
  var MARK = '<svg width="34" height="34" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#3D5BA6"/><path d="M12 26V15a3 3 0 0 1 3-3h7a6 6 0 0 1 0 12h-4" stroke="#FDC503" stroke-width="2.6" stroke-linecap="round"/><circle cx="25" cy="28" r="2.4" fill="#98C5ED"/></svg>';
  var MARK_LIGHT = '<svg width="32" height="32" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#5B3DA6"/><path d="M12 26V15a3 3 0 0 1 3-3h7a6 6 0 0 1 0 12h-4" stroke="#FDC503" stroke-width="2.6" stroke-linecap="round"/><circle cx="25" cy="28" r="2.4" fill="#98C5ED"/></svg>';

  // ---- icons (Lucide-style) ---------------------------------------------
  var IC = {
    overview: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
    sites: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    jobs: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="16" cy="18" r="1.4" fill="currentColor"/>',
    errors: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/>',
    usage: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
    issues: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    down: '<path d="M18 6 6 18M6 6l12 12"/>',
    empty: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>'
  };
  function svg(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (IC[name] || '') + '</svg>';
  }

  // ---- time helpers ------------------------------------------------------
  var SAST_TZ = 'Africa/Johannesburg';
  function parse(ts) { if (!ts) return null; var d = new Date(ts); return isNaN(d) ? null : d; }
  function relTime(ts) {
    var d = parse(ts); if (!d) return '—';
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    var past = s >= 0; s = Math.abs(s);
    var str;
    if (s < 45) str = 'just now';
    else if (s < 90) str = '1 min';
    else if (s < 3600) str = Math.round(s / 60) + ' min';
    else if (s < 5400) str = '1 hr';
    else if (s < 86400) str = Math.round(s / 3600) + ' hr';
    else if (s < 172800) str = '1 day';
    else if (s < 2592000) str = Math.round(s / 86400) + ' days';
    else str = Math.round(s / 2592000) + ' mo';
    if (str === 'just now') return str;
    return past ? str + ' ago' : 'in ' + str;
  }
  function sastDayKey(d) { // YYYY-MM-DD in SAST
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: SAST_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  function sastTime(d) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: SAST_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
    catch (e) { return d.toISOString().slice(11, 16); }
  }
  function sastDate(d) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: SAST_TZ, day: '2-digit', month: 'short' }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  function humanInterval(secs) {
    if (secs == null || secs <= 0) return '—';
    if (secs < 90) return 'every ' + secs + 's';
    if (secs < 5400) return 'every ' + Math.round(secs / 60) + ' min';
    if (secs < 172800) return 'every ' + Math.round(secs / 3600) + ' hr';
    return 'every ' + Math.round(secs / 86400) + ' days';
  }

  // ---- global state ------------------------------------------------------
  var sb = null;
  var session = { user: null, staff: null, owner: false };
  var DATA = { sites: [], jobs: [], errors: [], usage: [], issues: [], heartbeat: null, events: [], requests: [], staff: [] };
  var LOADED = false, LOAD_ERR = null;
  var currentView = 'overview';
  var refreshTimer = null;
  var ui = { jobFilter: 'all', errSearch: '', expanded: {} };

  // ========================================================= AUTH =========
  function authError(msg) { var e = $('loginError'); e.textContent = msg; e.classList.remove('hidden'); }

  function initClient() {
    if (!window.supabase || !window.supabase.createClient) return null;
    if (!sb) sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    return sb;
  }

  function lcList(arr) { return (arr || []).map(function (x) { return String(x).toLowerCase(); }); }

  function isOwner(user, staff) {
    var email = (user && user.email || '').toLowerCase();
    if (email && lcList(CFG.OWNER_EMAILS).indexOf(email) !== -1) return true;
    if (staff && staff.is_super) {
      // Shipping default: any superuser is allowed. Lock down by setting
      // RESTRICT_TO_OWNERS and listing usernames in OWNER_IDS.
      if (!CFG.RESTRICT_TO_OWNERS) return true;
      if ((CFG.OWNER_IDS || []).map(String).indexOf(String(staff.id)) !== -1) return true;
    }
    return false;
  }

  function startGoogle() {
    initClient();
    sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } })
      .then(function (r) { if (r.error) authError(r.error.message); });
  }

  function startPin(e) {
    e.preventDefault();
    initClient();
    var btn = $('pinSubmit'); btn.disabled = true;
    var user = $('pinUser').value.trim();
    var pin = $('pinPass').value;
    var email = user + '@' + CFG.AUTH_EMAIL_DOMAIN;
    sb.auth.signInWithPassword({ email: email, password: pin }).then(function (r) {
      btn.disabled = false;
      if (r.error) { authError('Sign-in failed: ' + r.error.message); return; }
      boot();
    });
  }

  function signOut() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    LOADED = false;
    initClient();
    sb.auth.signOut().finally(function () {
      session = { user: null, staff: null, owner: false };
      window.QUAY_SESSION = null;
      show('login');
    });
  }

  // decide screen after we have a session
  function boot() {
    initClient();
    if (!sb) { setTimeout(boot, 120); return; }
    sb.auth.getSession().then(function (r) {
      var sess = r && r.data && r.data.session;
      if (!sess || !sess.user) { show('login'); return; }
      session.user = sess.user;
      bootStaff(sess);
    }).catch(function () { show('login'); });
  }

  function bootStaff(sess) {
      // fetch staff row
      sb.from('staff').select('id,name,is_super').eq('auth_user_id', sess.user.id).maybeSingle()
        .then(function (sr) {
          session.staff = (sr && sr.data) || null;
          session.owner = isOwner(session.user, session.staff);
          if (!session.owner) { renderLock(); return; }
          window.QUAY_SESSION = { id: session.staff ? session.staff.id : null, name: (session.staff && session.staff.name) || session.user.email, super: true };
          enterApp();
        })
        .catch(function () {
          // staff lookup may be blocked; still allow owner-by-email
          session.staff = null;
          session.owner = isOwner(session.user, null);
          if (!session.owner) { renderLock(); return; }
          window.QUAY_SESSION = { id: null, name: session.user.email, super: true };
          enterApp();
        });
  }

  function show(which) {
    $('loginScreen').classList.toggle('hidden', which !== 'login');
    $('lockScreen').classList.toggle('hidden', which !== 'lock');
    var app = $('app'); app.classList.toggle('ready', which === 'app');
    if (which !== 'app') app.classList.remove('ready');
  }

  function renderLock() {
    var email = session.user.email || '(no email)';
    var sid = session.staff ? session.staff.id : null;
    $('lockEmail').textContent = email;
    $('lockCopyEmail').textContent = "'" + email + "'";
    if (sid) {
      $('lockStaffId').textContent = sid;
      $('lockCopyId').textContent = "'" + sid + "'";
    } else {
      $('lockStaffRow').classList.add('hidden');
      $('lockCopyIdRow').classList.add('hidden');
    }
    show('lock');
  }

  // ========================================================= APP ENTRY ====
  var NAV = [
    { id: 'overview', label: 'Overview', sub: 'Operations at a glance', icon: 'overview' },
    { id: 'sites', label: 'Sites', sub: 'App uptime & response', icon: 'sites' },
    { id: 'clock', label: 'Clock', sub: "Who's in right now", icon: 'clock' },
    { id: 'jobs', label: 'Jobs & Health', sub: 'Scheduled & daemon jobs', icon: 'jobs' },
    { id: 'errors', label: 'Code Errors', sub: 'Deduped log errors', icon: 'errors' },
    { id: 'usage', label: 'Usage', sub: 'App activity (30 days)', icon: 'usage' },
    { id: 'issues', label: 'Issues', sub: 'Reported bugs & requests', icon: 'issues' }
  ];

  function enterApp() {
    show('app');
    document.querySelectorAll('[data-logo]').forEach(function (n) { n.innerHTML = MARK; });
    document.querySelectorAll('[data-logo-light]').forEach(function (n) { n.innerHTML = MARK_LIGHT; });
    $('idName').textContent = (session.staff && session.staff.name) || 'Owner';
    $('idEmail').textContent = session.user.email || '';
    buildNav();
    wireChrome();
    // shared app switcher
    try { if (window.QuayNav && QuayNav.mount) QuayNav.mount({ isSuper: true, current: 'mission', anchor: '#mcLogo' }); } catch (e) {}
    switchView('overview');
    loadAll();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () { loadAll(true); }, 60000);
  }

  function buildNav() {
    var nav = $('nav'); nav.innerHTML = '';
    NAV.forEach(function (n) {
      var b = el('<button class="nav-item" data-view="' + n.id + '">' + svg(n.icon) + '<span>' + n.label + '</span><span class="badge-count hidden" data-badge="' + n.id + '"></span></button>');
      b.addEventListener('click', function () { switchView(n.id); closeMobileNav(); });
      nav.appendChild(b);
    });
  }

  function wireChrome() {
    $('refreshBtn').onclick = function () { loadAll(); };
    $('signOutBtn').onclick = signOut;
    $('menuToggle').onclick = function () { $('sidebar').classList.add('open'); $('scrim').classList.remove('hidden'); };
    $('scrim').onclick = closeMobileNav;
  }
  function closeMobileNav() { $('sidebar').classList.remove('open'); $('scrim').classList.add('hidden'); }

  function switchView(id) {
    currentView = id;
    var meta = NAV.filter(function (n) { return n.id === id; })[0] || NAV[0];
    $('viewTitle').textContent = meta.label;
    $('viewSub').textContent = meta.sub;
    document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === id); });
    render();
  }

  // ========================================================= DATA LOAD ====
  function loadAll(silent) {
    initClient();
    if (!sb) return;
    var btn = $('refreshBtn'); if (btn) btn.classList.add('spin');
    if (!LOADED && !silent) render(); // show skeletons first time
    // 14-day window: "in now"/today use the SAST-day filter in clockState, but
    // the wider window lets us catch someone who clocked in days ago and never
    // clocked out (missing-clock-out anomaly), which a 48h window would miss.
    var since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();

    var q = [
      sb.from('mc_site_health').select('*'),
      sb.from('mc_job_health').select('*'),
      sb.from('mc_code_errors').select('*').order('last_seen', { ascending: false }).limit(500),
      sb.from('mc_app_usage').select('*').order('ts', { ascending: false }).limit(1000),
      sb.from('mc_issues').select('*').order('created_at', { ascending: false }).limit(500),
      sb.from('mc_collector_heartbeat').select('*').eq('id', 1).maybeSingle(),
      sb.from('events').select('staff_id,ts,dir,note,location').gte('ts', since).order('ts', { ascending: false }),
      sb.from('requests').select('staff_id,type,start_date,end_date,days,reason,status').eq('status', 'Pending'),
      sb.from('staff').select('id,name,team,active,is_super')
    ];

    Promise.all(q.map(function (p) { return p.then(function (r) { return r; }, function (e) { return { error: e }; }); }))
      .then(function (res) {
        function d(r) { return (r && r.data) || []; }
        DATA.sites = d(res[0]);
        DATA.jobs = d(res[1]);
        DATA.errors = d(res[2]);
        DATA.usage = d(res[3]);
        DATA.issues = d(res[4]);
        DATA.heartbeat = (res[5] && res[5].data) || null;
        DATA.events = d(res[6]);
        DATA.requests = d(res[7]);
        DATA.staff = d(res[8]);
        LOAD_ERR = null;
        // surface a hard failure only if every table errored (e.g. not authed/RLS)
        var allErr = res.slice(0, 6).every(function (r) { return r && r.error; });
        if (allErr) LOAD_ERR = (res[0].error && res[0].error.message) || 'Could not load data.';
        LOADED = true;
        updateBadges();
        updateFreshness();
        render();
      })
      .finally(function () { if (btn) btn.classList.remove('spin'); });
  }

  function staffName(id) {
    for (var i = 0; i < DATA.staff.length; i++) if (String(DATA.staff[i].id) === String(id)) return DATA.staff[i].name;
    return 'Staff ' + id;
  }
  function staffTeam(id) {
    for (var i = 0; i < DATA.staff.length; i++) if (String(DATA.staff[i].id) === String(id)) return DATA.staff[i].team || '';
    return '';
  }

  // ---- derived -----------------------------------------------------------
  function sitesJoined() {
    var byId = {}; DATA.sites.forEach(function (s) { byId[s.site] = s; });
    return (CFG.SITES || []).map(function (c) {
      var h = byId[c.id] || null;
      return { id: c.id, label: c.label, url: c.url, health: h };
    });
  }
  function jobSeverity(state) { return ({ error: 0, stalled: 1, idle: 2, unknown: 3, ok: 4, disabled: 5 })[state] != null ? ({ error: 0, stalled: 1, idle: 2, unknown: 3, ok: 4, disabled: 5 })[state] : 3; }
  function sortedJobs() { return DATA.jobs.slice().sort(function (a, b) { return jobSeverity(a.state) - jobSeverity(b.state); }); }

  function clockState() {
    var today = sastDayKey(new Date());
    var latest = {}; // staff_id -> event (events already desc by ts)
    DATA.events.forEach(function (ev) {
      if (!ev.staff_id) return;
      if (!latest[ev.staff_id]) latest[ev.staff_id] = ev; // first seen = newest
    });
    var inNow = [], anomalies = [];
    Object.keys(latest).forEach(function (sid) {
      var ev = latest[sid]; var d = parse(ev.ts); if (!d) return;
      if (ev.dir === 'in') {
        if (sastDayKey(d) === today) inNow.push({ sid: sid, ts: ev.ts });
        else anomalies.push({ sid: sid, ts: ev.ts });
      }
    });
    var todayPunches = DATA.events.filter(function (ev) { var d = parse(ev.ts); return d && sastDayKey(d) === today; }).length;
    inNow.sort(function (a, b) { return parse(a.ts) - parse(b.ts); });
    return { inNow: inNow, anomalies: anomalies, todayPunches: todayPunches, pending: DATA.requests };
  }

  function usageWindow30() {
    var cut = Date.now() - 30 * 86400 * 1000;
    return DATA.usage.filter(function (u) { var d = parse(u.ts); return d && d.getTime() >= cut; });
  }

  function attentionItems() {
    var items = [];
    sortedJobs().forEach(function (j) {
      if (j.state === 'error' || j.state === 'stalled') {
        items.push({ kind: j.state === 'error' ? 'bad' : 'warn', title: (j.label || j.job), sub: (j.state === 'error' ? 'Job errored' : 'Job stalled') + (j.latest_error ? ' · ' + j.latest_error.slice(0, 80) : ''), when: j.last_log_ts || j.updated_at });
      }
    });
    sitesJoined().forEach(function (s) {
      if (s.health && s.health.ok === false) items.push({ kind: 'bad', title: s.label + ' is down', sub: 'HTTP ' + (s.health.http_status == null ? '—' : s.health.http_status), when: s.health.checked_at });
    });
    DATA.issues.forEach(function (i) {
      if (i.status !== 'closed' && (i.severity === 'critical' || i.severity === 'high')) {
        items.push({ kind: i.severity === 'critical' ? 'bad' : 'warn', title: i.title, sub: (i.severity.toUpperCase()) + ' issue · ' + (i.site || 'general'), when: i.created_at });
      }
    });
    return items;
  }

  // ---- freshness + badges ------------------------------------------------
  function updateFreshness() {
    var chip = $('freshChip'), txt = $('freshText'), foot = $('collectorFoot');
    var hb = DATA.heartbeat;
    if (!hb || !hb.last_run) { chip.className = 'freshness warn'; txt.textContent = 'Collector: no data'; foot.textContent = 'Collector: never reported'; return; }
    var ageMin = (Date.now() - parse(hb.last_run).getTime()) / 60000;
    var cls = 'freshness', word = 'Collector ' + relTime(hb.last_run);
    if (ageMin > 60) cls += ' bad'; else if (ageMin > 15) cls += ' warn';
    chip.className = cls; txt.textContent = word;
    foot.textContent = 'Collector ran ' + relTime(hb.last_run) + (hb.host ? ' · ' + hb.host : '');
  }
  function updateBadges() {
    var openIssues = DATA.issues.filter(function (i) { return i.status !== 'closed'; }).length;
    var badJobs = DATA.jobs.filter(function (j) { return j.state === 'error' || j.state === 'stalled'; }).length;
    setBadge('issues', openIssues, false);
    setBadge('jobs', badJobs, true);
  }
  function setBadge(view, n, amber) {
    var b = document.querySelector('[data-badge="' + view + '"]'); if (!b) return;
    if (n > 0) { b.textContent = n; b.classList.remove('hidden'); b.classList.toggle('amber', !!amber); }
    else b.classList.add('hidden');
  }

  // ========================================================= RENDER =======
  function render() {
    var c = $('content');
    if (!LOADED) { c.innerHTML = skeleton(); return; }
    var banner = LOAD_ERR ? '<div class="banner-error">' + svg('errors') + '<span>' + esc(LOAD_ERR) + ' Your session may have expired — try Refresh or sign out and back in.</span></div>' : '';
    var body;
    switch (currentView) {
      case 'sites': body = viewSites(); break;
      case 'clock': body = viewClock(); break;
      case 'jobs': body = viewJobs(); break;
      case 'errors': body = viewErrors(); break;
      case 'usage': body = viewUsage(); break;
      case 'issues': body = viewIssues(); break;
      default: body = viewOverview();
    }
    c.innerHTML = banner + '<div class="view">' + body + '</div>';
    postRender();
  }

  function skeleton() {
    var k = ''; for (var i = 0; i < 4; i++) k += '<div class="skel skel-card"></div>';
    return '<div class="kpi-grid">' + k + '</div><div class="load-note">Loading Mission Control…</div>';
  }

  function empty(title, sub, icon) {
    return '<div class="empty">' + svg(icon || 'empty') + '<b>' + esc(title) + '</b><span>' + esc(sub || '') + '</span></div>';
  }

  // ---- 1. OVERVIEW -------------------------------------------------------
  function viewOverview() {
    var sites = sitesJoined();
    var reported = sites.filter(function (s) { return s.health; });
    var up = reported.filter(function (s) { return s.health.ok; }).length;
    var cs = clockState();
    var openIssues = DATA.issues.filter(function (i) { return i.status !== 'closed'; }).length;
    var jobsOk = DATA.jobs.filter(function (j) { return j.state === 'ok'; }).length;
    var jobsBad = DATA.jobs.filter(function (j) { return j.state === 'error' || j.state === 'stalled'; }).length;
    var hb = DATA.heartbeat;

    var sitesCls = reported.length && up === reported.length ? 'ok' : (up < reported.length ? 'bad' : '');
    var jobsCls = jobsBad > 0 ? 'bad' : 'ok';
    var issuesCls = openIssues > 0 ? 'warn' : 'ok';

    var kpis = [
      kpi(sitesCls, 'sites', 'Sites up', reported.length ? (up + ' <small>/ ' + reported.length + '</small>') : '—', reported.length ? 'monitored apps' : 'no collector data yet'),
      kpi('', 'clock', 'Clocked in now', cs.inNow.length, cs.todayPunches + ' punches today'),
      kpi(issuesCls, 'issues', 'Open issues', openIssues, DATA.issues.length + ' total logged'),
      kpi(jobsCls, 'jobs', 'Jobs healthy', jobsOk + ' <small>/ ' + DATA.jobs.length + '</small>', jobsBad > 0 ? (jobsBad + ' need attention') : 'all nominal'),
      kpi('accent', 'overview', 'Collector', hb && hb.last_run ? relTime(hb.last_run).replace(' ago', '') : 'no data', hb && hb.last_run ? 'last run ago' : 'never reported')
    ].join('');

    var att = attentionItems();
    var attHtml;
    if (!att.length) attHtml = '<div class="card">' + empty('All clear', 'No errored jobs, downed sites, or high-severity issues.', 'overview') + '</div>';
    else attHtml = '<div class="card">' + att.map(function (a) {
      return '<div class="att-item"><span class="ic ' + a.kind + '">' + svg(a.kind === 'bad' ? 'errors' : 'jobs') + '</span><div class="body"><b>' + esc(a.title) + '</b><span>' + esc(a.sub) + '</span></div><span class="when">' + relTime(a.when) + '</span></div>';
    }).join('') + '</div>';

    return '<div class="kpi-grid">' + kpis + '</div>'
      + '<div class="section-title"><h3>Needs attention</h3><span class="count">' + att.length + ' item' + (att.length === 1 ? '' : 's') + '</span></div>'
      + attHtml;
  }

  function kpi(cls, icon, label, value, meta) {
    return '<div class="kpi ' + cls + '"><div class="label">' + svg(icon) + esc(label) + '</div><div class="value">' + value + '</div><div class="meta">' + esc(meta) + '</div></div>';
  }

  // ---- 2. SITES ----------------------------------------------------------
  function viewSites() {
    var sites = sitesJoined();
    if (!sites.length) return empty('No sites configured', 'Add entries to MC_CFG.SITES.');
    return '<div class="grid-cards">' + sites.map(function (s) {
      var h = s.health;
      var pill = !h ? '<span class="pill neutral"><span class="dot"></span>No data</span>'
        : (h.ok ? '<span class="pill ok"><span class="dot"></span>Up</span>' : '<span class="pill bad"><span class="dot"></span>Down</span>');
      var stats = !h ? '<div class="stats"><div>Waiting for collector</div></div>'
        : '<div class="stats"><div><b>' + (h.http_status == null ? '—' : h.http_status) + '</b>HTTP status</div><div><b>' + (h.response_ms == null ? '—' : h.response_ms + 'ms') + '</b>response</div></div>';
      return '<div class="card site-card"><div class="head"><div><b>' + esc(s.label) + '</b><div class="url">' + esc(s.url) + '</div></div>' + pill + '</div>'
        + stats
        + '<div class="foot"><span class="when" style="font-size:11.5px;color:var(--muted)">' + (h ? 'Checked ' + relTime(h.checked_at) : 'Not yet checked') + '</span>'
        + '<a class="btn-sm icon-btn" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open</a></div></div>';
    }).join('') + '</div>';
  }

  // ---- 3. CLOCK ----------------------------------------------------------
  function viewClock() {
    var cs = clockState();
    var inHtml = !cs.inNow.length ? empty('Nobody clocked in', 'No active clock-ins for today (SAST).', 'clock')
      : cs.inNow.map(function (p) {
        var nm = staffName(p.sid), tm = staffTeam(p.sid);
        return '<div class="person-row"><span class="avatar">' + esc(initials(nm)) + '</span><div class="nm"><b>' + esc(nm) + '</b><span>' + esc(tm || '—') + '</span></div><span class="since">since ' + sastTime(parse(p.ts)) + '</span></div>';
      }).join('');

    var anomHtml = !cs.anomalies.length ? empty('No anomalies', 'Everyone who clocked in also clocked out.', 'clock')
      : cs.anomalies.map(function (p) {
        var nm = staffName(p.sid);
        return '<div class="att-item"><span class="ic warn">' + svg('clock') + '</span><div class="body"><b>' + esc(nm) + '</b><span>Missing clock-out · in since ' + sastDate(parse(p.ts)) + ' ' + sastTime(parse(p.ts)) + '</span></div></div>';
      }).join('');

    var leaveHtml = !cs.pending.length ? empty('No pending leave', 'No requests awaiting approval.', 'issues')
      : '<div class="table-wrap"><table class="tbl"><thead><tr><th>Staff</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th></tr></thead><tbody>'
        + cs.pending.map(function (r) {
          return '<tr><td>' + esc(staffName(r.staff_id)) + '</td><td>' + esc(r.type || '—') + '</td><td>' + esc((r.start_date || '') + (r.end_date ? ' → ' + r.end_date : '')) + '</td><td>' + esc(r.days == null ? '—' : r.days) + '</td><td>' + esc(r.reason || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';

    return '<div class="kpi-grid"><div class="kpi ok"><div class="label">' + svg('clock') + 'In right now</div><div class="value">' + cs.inNow.length + '</div><div class="meta">live clock-ins (SAST)</div></div>'
      + '<div class="kpi"><div class="label">' + svg('clock') + 'Punches today</div><div class="value">' + cs.todayPunches + '</div><div class="meta">in + out events</div></div>'
      + '<div class="kpi ' + (cs.anomalies.length ? 'warn' : '') + '"><div class="label">' + svg('errors') + 'Missing clock-outs</div><div class="value">' + cs.anomalies.length + '</div><div class="meta">from prior days</div></div>'
      + '<div class="kpi ' + (cs.pending.length ? 'warn' : '') + '"><div class="label">' + svg('issues') + 'Pending leave</div><div class="value">' + cs.pending.length + '</div><div class="meta">awaiting approval</div></div></div>'
      + '<div class="two-col" style="margin-top:22px"><div><div class="section-title"><h3>Who\'s in</h3></div><div class="card">' + inHtml + '</div></div>'
      + '<div><div class="section-title"><h3>Anomalies</h3></div><div class="card">' + anomHtml + '</div></div></div>'
      + '<div class="section-title"><h3>Pending leave</h3></div>' + leaveHtml;
  }

  // ---- 4. JOBS & HEALTH --------------------------------------------------
  function viewJobs() {
    var all = sortedJobs();
    if (!all.length) return empty('No jobs reported', 'The collector has not written job health yet.', 'jobs');
    var counts = {}; DATA.jobs.forEach(function (j) { counts[j.state] = (counts[j.state] || 0) + 1; });
    var states = ['all', 'error', 'stalled', 'idle', 'ok', 'disabled', 'unknown'];
    var chips = states.map(function (st) {
      var n = st === 'all' ? DATA.jobs.length : (counts[st] || 0);
      if (st !== 'all' && !n) return '';
      return '<button class="chip' + (ui.jobFilter === st ? ' active' : '') + '" data-jobfilter="' + st + '">' + (st === 'all' ? 'All' : st.charAt(0).toUpperCase() + st.slice(1)) + '<span class="n">' + n + '</span></button>';
    }).join('');

    var rows = all.filter(function (j) { return ui.jobFilter === 'all' || j.state === ui.jobFilter; });
    var body = !rows.length ? '<tr><td colspan="6">' + empty('Nothing here', 'No jobs in this state.', 'jobs') + '</td></tr>'
      : rows.map(function (j, idx) {
        var open = ui.expanded['job' + j.job];
        var st = (j.state || 'unknown');
        var pill = '<span class="pill ' + st + '"><span class="dot"></span>' + st + '</span>';
        var main = '<tr data-jobkey="' + esc(j.job) + '"><td>' + pill + '</td><td><b style="color:var(--navy)">' + esc(j.label || j.job) + '</b></td><td>' + esc(j.category || '—') + '</td><td>' + relTime(j.last_log_ts) + '</td><td>' + esc(humanInterval(j.expected_interval_secs)) + '</td><td>' + (j.error_count_24h || 0) + '</td><td><button class="expand-btn" data-expand="job' + esc(j.job) + '">' + (open ? 'Hide' : 'Details') + '</button></td></tr>';
        var det = open ? '<tr class="row-expand"><td colspan="7"><div class="inner">'
          + '<div class="kv"><b>Program</b> <span class="mono">' + esc(j.program || '—') + '</span></div>'
          + '<div class="kv"><b>Log path</b> <span class="mono">' + esc(j.log_path || '—') + '</span></div>'
          + '<div class="kv"><b>PID</b> ' + esc(j.pid == null ? '—' : j.pid) + ' &nbsp; <b>Last exit</b> ' + esc(j.last_exit == null ? '—' : j.last_exit) + ' &nbsp; <b>Updated</b> ' + relTime(j.updated_at) + '</div>'
          + (j.latest_error ? '<div class="kv"><b>Latest error</b></div><pre>' + esc(j.latest_error) + '</pre>' : '<div class="kv"><b>Latest error</b> none</div>')
          + '</div></td></tr>' : '';
        return main + det;
      }).join('');

    return '<div class="chips">' + chips + '</div>'
      + '<div class="table-wrap"><table class="tbl"><thead><tr><th>Status</th><th>Job</th><th>Category</th><th>Last run</th><th>Schedule</th><th>Err 24h</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ---- 5. CODE ERRORS ----------------------------------------------------
  function viewErrors() {
    if (!DATA.errors.length) return empty('No code errors', 'No errors have been pulled from logs. That is a good thing.', 'errors');
    var term = ui.errSearch.toLowerCase();
    var list = DATA.errors.filter(function (e) {
      if (!term) return true;
      return (String(e.message || '') + ' ' + String(e.job || '') + ' ' + String(e.level || '')).toLowerCase().indexOf(term) !== -1;
    });
    var search = '<div class="chips"><div class="search-box">' + svg('search') + '<input class="input" id="errSearch" type="search" placeholder="Search message / job / level" value="' + esc(ui.errSearch) + '" aria-label="Search errors" /></div><span class="count" style="color:var(--muted);font-size:12px">' + list.length + ' of ' + DATA.errors.length + '</span></div>';
    if (!list.length) return search + empty('No matches', 'Nothing matches your search.', 'search');

    // group by job, preserve newest-first order of groups
    var groups = [], seen = {};
    list.forEach(function (e) { var k = e.job || '(unknown)'; if (!seen[k]) { seen[k] = []; groups.push(k); } seen[k].push(e); });
    var html = groups.map(function (g) {
      var items = seen[g].map(function (e) {
        var lvl = (e.level || 'error').toLowerCase();
        var cls = lvl.indexOf('crit') !== -1 ? 'critical' : lvl.indexOf('warn') !== -1 ? 'warn' : lvl.indexOf('trace') !== -1 ? 'high' : 'error';
        var open = ui.expanded['err' + e.fingerprint];
        return '<div class="err-card"><div class="top"><span class="pill ' + cls + '">' + esc(e.level || 'ERROR') + '</span><span class="pill neutral">×' + (e.count || 1) + '</span><span class="ct">' + esc(e.log_path || '') + '</span></div>'
          + '<div class="err-msg' + (open ? ' open' : '') + '" data-errmsg="' + esc(e.fingerprint) + '" tabindex="0" role="button" title="Click to expand">' + esc(e.message || '(no message)') + '</div>'
          + '<div class="seen"><span>First: ' + relTime(e.first_seen) + '</span><span>Last: ' + relTime(e.last_seen) + '</span></div></div>';
      }).join('');
      return '<div class="err-group"><div class="gl">' + svg('jobs') + esc(g) + ' <span class="count" style="color:var(--muted);font-weight:600">· ' + seen[g].length + '</span></div>' + items + '</div>';
    }).join('');
    return search + html;
  }

  // ---- 6. USAGE ----------------------------------------------------------
  function viewUsage() {
    var win = usageWindow30();
    if (!DATA.usage.length) return empty('No usage recorded', 'App-open pings will appear here once apps report in.', 'usage');

    // per-site counts
    var bySite = {}; win.forEach(function (u) { var s = u.site || 'unknown'; bySite[s] = (bySite[s] || 0) + 1; });
    var siteRows = Object.keys(bySite).map(function (s) { return { site: s, n: bySite[s] }; }).sort(function (a, b) { return b.n - a.n; });
    var max = siteRows.length ? siteRows[0].n : 1;
    var siteLabel = {}; (CFG.SITES || []).forEach(function (c) { siteLabel[c.id] = c.label; });
    var bars = siteRows.map(function (r) {
      return '<div class="bar-row"><span class="nm" title="' + esc(siteLabel[r.site] || r.site) + '">' + esc(siteLabel[r.site] || r.site) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(4, Math.round(r.n / max * 100)) + '%"></div></div><span class="num">' + r.n + '</span></div>';
    }).join('');

    // per-user table (use full 1000 window for who/last-seen)
    var byUser = {};
    DATA.usage.forEach(function (u) {
      var key = u.staff_id || u.name || 'anon';
      if (!byUser[key]) byUser[key] = { name: u.name || ('Staff ' + (u.staff_id || '?')), total: 0, last: u.ts, apps: {}, isSuper: u.is_super };
      var b = byUser[key]; b.total++; b.apps[u.site || '?'] = true;
      if (parse(u.ts) > parse(b.last)) b.last = u.ts;
    });
    var users = Object.keys(byUser).map(function (k) { return byUser[k]; }).sort(function (a, b) { return b.total - a.total; });
    var userRows = users.map(function (u) {
      var apps = Object.keys(u.apps).map(function (a) { return siteLabel[a] || a; }).join(', ');
      return '<tr><td><b style="color:var(--navy)">' + esc(u.name) + '</b>' + (u.isSuper ? ' <span class="pill ack" style="font-size:10px">super</span>' : '') + '</td><td>' + u.total + '</td><td>' + relTime(u.last) + '</td><td style="color:var(--muted)">' + esc(apps) + '</td></tr>';
    }).join('');

    // recent feed
    var feed = DATA.usage.slice(0, 40).map(function (u) {
      return '<div class="att-item"><span class="avatar">' + esc(initials(u.name)) + '</span><div class="body"><b>' + esc(u.name || 'Someone') + '</b><span>opened ' + esc(siteLabel[u.site] || u.site || '?') + (u.path ? ' · ' + esc(u.path) : '') + '</span></div><span class="when">' + relTime(u.ts) + '</span></div>';
    }).join('');

    return '<div class="two-col"><div><div class="section-title"><h3>Most active apps</h3><span class="count">last 30 days · ' + win.length + ' opens</span></div><div class="card card-pad">' + (bars || empty('No opens in 30 days', '', 'usage')) + '</div>'
      + '<div class="section-title"><h3>By user</h3></div><div class="table-wrap"><table class="tbl"><thead><tr><th>User</th><th>Opens</th><th>Last seen</th><th>Apps</th></tr></thead><tbody>' + userRows + '</tbody></table></div></div>'
      + '<div><div class="section-title"><h3>Recent activity</h3></div><div class="card">' + (feed || empty('Nothing yet', '', 'usage')) + '</div></div></div>';
  }

  // ---- 7. ISSUES ---------------------------------------------------------
  var SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  function viewIssues() {
    var list = DATA.issues.slice().sort(function (a, b) {
      var ao = a.status === 'closed' ? 1 : 0, bo = b.status === 'closed' ? 1 : 0;
      if (ao !== bo) return ao - bo;
      var sa = SEV_ORDER[a.severity] != null ? SEV_ORDER[a.severity] : 2, sb_ = SEV_ORDER[b.severity] != null ? SEV_ORDER[b.severity] : 2;
      if (sa !== sb_) return sa - sb_;
      return parse(b.created_at) - parse(a.created_at);
    });
    var reportBtn = '<button class="btn-sm icon-btn" id="reportIssueBtn" style="background:var(--blue);color:#fff;border-color:var(--blue)">' + svg('issues') + 'Report an issue</button>';
    var head = '<div class="chips" style="justify-content:space-between"><span class="count" style="font-size:13px;color:var(--muted)">' + list.filter(function (i) { return i.status !== 'closed'; }).length + ' open · ' + list.length + ' total</span>' + reportBtn + '</div>';
    if (!list.length) return head + '<div class="card">' + empty('No issues logged', 'Use “Report an issue” to add one.', 'issues') + '</div>';

    var rows = list.map(function (i) {
      return '<div class="att-item" data-issue="' + i.id + '" style="cursor:pointer" role="button" tabindex="0">'
        + '<span class="ic ' + (i.status === 'closed' ? 'warn' : (i.severity === 'critical' || i.severity === 'high' ? 'bad' : 'warn')) + '" style="' + (i.status === 'closed' ? 'opacity:.5' : '') + '">' + svg('issues') + '</span>'
        + '<div class="body"><b>' + esc(i.title) + '</b><span>' + esc((i.site || 'general')) + ' · reported by ' + esc(i.reporter_name || 'unknown') + ' · ' + relTime(i.created_at) + '</span></div>'
        + '<span class="pill ' + (i.severity || 'medium') + '">' + esc(i.severity || 'medium') + '</span>'
        + '<span class="pill ' + (i.status || 'open') + '" style="margin-left:6px">' + esc(i.status || 'open') + '</span></div>';
    }).join('');
    return head + '<div class="card">' + rows + '</div>';
  }

  // ========================================================= POST-RENDER ==
  function postRender() {
    // job filter chips
    document.querySelectorAll('[data-jobfilter]').forEach(function (b) {
      b.onclick = function () { ui.jobFilter = b.getAttribute('data-jobfilter'); render(); };
    });
    // job detail expanders
    document.querySelectorAll('[data-expand]').forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute('data-expand'); ui.expanded[k] = !ui.expanded[k]; render(); };
    });
    // error search (keep focus)
    var es = $('errSearch');
    if (es) {
      es.oninput = function () { ui.errSearch = es.value; var pos = es.selectionStart; render(); var n = $('errSearch'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } };
    }
    // error message expand
    document.querySelectorAll('[data-errmsg]').forEach(function (m) {
      m.onclick = function () { var k = 'err' + m.getAttribute('data-errmsg'); ui.expanded[k] = !ui.expanded[k]; m.classList.toggle('open'); };
      m.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); m.click(); } };
    });
    // issue rows + report
    document.querySelectorAll('[data-issue]').forEach(function (r) {
      var opener = function () { openIssue(r.getAttribute('data-issue')); };
      r.onclick = opener;
      r.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); opener(); } };
    });
    var rb = $('reportIssueBtn'); if (rb) rb.onclick = openReportForm;
  }

  // ========================================================= ISSUES WRITE =
  function modal(title, bodyHtml, footHtml) {
    var m = el('<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="mh"><h3>' + esc(title) + '</h3><button class="close-x" aria-label="Close">' + svg('down') + '</button></div><div class="mb">' + bodyHtml + '</div><div class="mf">' + (footHtml || '') + '</div></div></div>');
    m.querySelector('.close-x').onclick = closeModal;
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    $('modalRoot').innerHTML = ''; $('modalRoot').appendChild(m);
    return m;
  }
  function closeModal() { $('modalRoot').innerHTML = ''; }
  function toast(msg) {
    var t = el('<div class="toast">' + esc(msg) + '</div>'); $('toastRoot').innerHTML = ''; $('toastRoot').appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  function openIssue(id) {
    var issue = DATA.issues.filter(function (i) { return String(i.id) === String(id); })[0];
    if (!issue) return;
    var body = '<div style="display:flex;gap:8px;margin-bottom:12px"><span class="pill ' + (issue.severity || 'medium') + '">' + esc(issue.severity || 'medium') + '</span><span class="pill ' + (issue.status || 'open') + '">' + esc(issue.status || 'open') + '</span><span class="pill neutral">' + esc(issue.site || 'general') + '</span></div>'
      + '<p style="margin:0 0 6px;color:var(--muted);font-size:12.5px">Reported by ' + esc(issue.reporter_name || 'unknown') + ' · ' + relTime(issue.created_at) + '</p>'
      + '<div style="white-space:pre-wrap;font-size:13.5px;line-height:1.55;color:var(--ink);background:var(--panel);border-radius:10px;padding:12px 14px;margin-top:8px">' + (esc(issue.body || '').trim() || '<span style="color:var(--muted)">No description.</span>') + '</div>'
      + (issue.resolved_at ? '<p style="margin-top:10px;color:var(--muted);font-size:12.5px">Resolved ' + relTime(issue.resolved_at) + (issue.resolved_by ? ' by ' + esc(issue.resolved_by) : '') + '</p>' : '')
      + '<div class="field" style="margin-top:16px"><label for="issStatus">Change status</label><select class="input" id="issStatus"><option value="open"' + (issue.status === 'open' ? ' selected' : '') + '>Open</option><option value="ack"' + (issue.status === 'ack' ? ' selected' : '') + '>Acknowledged</option><option value="closed"' + (issue.status === 'closed' ? ' selected' : '') + '>Closed</option></select></div>';
    var foot = '<button class="btn-sm icon-btn" id="issCancel">Cancel</button><button class="btn-sm icon-btn" id="issSave" style="background:var(--blue);color:#fff;border-color:var(--blue)">Save</button>';
    var m = modal(issue.title, body, foot);
    m.querySelector('#issCancel').onclick = closeModal;
    m.querySelector('#issSave').onclick = function () {
      var btn = m.querySelector('#issSave'); btn.disabled = true; btn.textContent = 'Saving…';
      var newStatus = m.querySelector('#issStatus').value;
      var patch = { status: newStatus };
      if (newStatus === 'closed') { patch.resolved_at = new Date().toISOString(); patch.resolved_by = (session.staff && session.staff.name) || session.user.email; }
      else { patch.resolved_at = null; patch.resolved_by = null; }
      // optimistic
      issue.status = newStatus; issue.resolved_at = patch.resolved_at; issue.resolved_by = patch.resolved_by;
      updateBadges();
      sb.from('mc_issues').update(patch).eq('id', issue.id).then(function (r) {
        closeModal();
        if (r.error) { toast('Save failed: ' + r.error.message); } else { toast('Issue updated'); }
        loadAll(true);
      });
    };
  }

  function openReportForm() {
    var siteOpts = '<option value="general">General</option>' + (CFG.SITES || []).map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>'; }).join('');
    var body = '<div class="field"><label for="rfTitle">Title *</label><input class="input" id="rfTitle" type="text" placeholder="Short summary" required /></div>'
      + '<div class="field"><label for="rfSite">Area</label><select class="input" id="rfSite">' + siteOpts + '</select></div>'
      + '<div class="field"><label for="rfSev">Severity</label><select class="input" id="rfSev"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>'
      + '<div class="field"><label for="rfBody">Details</label><textarea class="input" id="rfBody" placeholder="What happened? Steps, expected vs actual…"></textarea></div>';
    var foot = '<button class="btn-sm icon-btn" id="rfCancel">Cancel</button><button class="btn-sm icon-btn" id="rfSubmit" style="background:var(--blue);color:#fff;border-color:var(--blue)">Submit</button>';
    var m = modal('Report an issue', body, foot);
    m.querySelector('#rfCancel').onclick = closeModal;
    m.querySelector('#rfSubmit').onclick = function () {
      var title = m.querySelector('#rfTitle').value.trim();
      if (!title) { m.querySelector('#rfTitle').focus(); toast('A title is required'); return; }
      var btn = m.querySelector('#rfSubmit'); btn.disabled = true; btn.textContent = 'Submitting…';
      var row = {
        title: title,
        site: m.querySelector('#rfSite').value,
        severity: m.querySelector('#rfSev').value,
        body: m.querySelector('#rfBody').value.trim() || null,
        status: 'open',
        reporter_staff_id: session.staff ? String(session.staff.id) : null,
        reporter_name: (session.staff && session.staff.name) || session.user.email
      };
      sb.from('mc_issues').insert(row).then(function (r) {
        closeModal();
        if (r.error) { toast('Could not submit: ' + r.error.message); }
        else { toast('Issue reported'); }
        loadAll(true);
      });
    };
  }

  // ========================================================= INIT =========
  function wireLogin() {
    document.querySelectorAll('[data-logo]').forEach(function (n) { n.innerHTML = MARK; });
    $('lockSignOut').onclick = signOut;
    var gbtn = $('googleBtn');
    if (CFG.ENABLE_GOOGLE) {
      gbtn.onclick = startGoogle;
    } else if (gbtn) {
      gbtn.classList.add('hidden');            // no broken OAuth path until configured
    }
    if (CFG.ALLOW_PIN_FALLBACK) {
      $('pinBlock').classList.remove('hidden');
      $('pinForm').onsubmit = startPin;
      // When Google is hidden, PIN is the only path — drop the "or" wording.
      if (!CFG.ENABLE_GOOGLE) {
        var dv = document.querySelector('#pinBlock .divider');
        if (dv) dv.textContent = 'Sign in with your username + PIN';
      }
    }
  }

  function start() {
    wireLogin();
    // wait for supabase-js (deferred script order should guarantee it, but be safe)
    var tries = 0;
    (function waitSb() {
      if (window.supabase && window.supabase.createClient) { initClient(); boot(); return; }
      if (tries++ > 60) { authError('Could not load Supabase client. Check your connection and reload.'); return; }
      setTimeout(waitSb, 100);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
