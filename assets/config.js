/* Quay 1 — Mission Control shared frontend config.
 * Safe to commit: anon key is public, RLS gates all reads/writes.
 */
window.MC_CFG = Object.freeze({
  SUPABASE_URL: 'https://dqszbqiimbfvmmnpgpsb.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxc3picWlpbWJmdm1tbnBncHNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDk4OTQsImV4cCI6MjA5NjQyNTg5NH0.M9RQnJEidyIMZAwbELTSPakiSnvuWBdHTjD7nuOdCZY',
  AUTH_EMAIL_DOMAIN: 'quay1.local',

  // --- Access gate ----------------------------------------------------------
  // Shipping mode: any Quay 1 SUPERUSER (staff.is_super) signs in with their
  // normal username + PIN. No Google setup required.
  //
  // To later lock it down to specific people, set RESTRICT_TO_OWNERS = true and
  // list the allowed superuser usernames in OWNER_IDS (and/or Google addresses
  // in OWNER_EMAILS). Anyone who signs in but isn't allowed sees a screen
  // naming their exact identity, so you can never hard-lock yourself out.
  RESTRICT_TO_OWNERS: false,
  OWNER_IDS: ['admin'],                    // used only when RESTRICT_TO_OWNERS
  OWNER_EMAILS: [],                        // used only when RESTRICT_TO_OWNERS

  ALLOW_PIN_FALLBACK: true,                // username + PIN sign-in (primary)
  ENABLE_GOOGLE: true,                     // Supabase Google OAuth configured 2026-10-23

  // The apps Mission Control watches (mirrors quay-nav.js SITES order).
  SITES: [
    { id: 'dashboard', label: 'Performance Dashboard', url: 'https://twigs002.github.io/quay-dashboard-v2/' },
    { id: 'leads',     label: 'Seller Leads',          url: 'https://twigs002.github.io/quay-leads/' },
    { id: 'hubspot',   label: 'Team Insights',         url: 'https://twigs002.github.io/quay-hubspot/' },
    { id: 'boarding',  label: 'On/Offboarding Tool',   url: 'https://twigs002.github.io/quay-1-onoff-boarding-tool/' },
    { id: 'polar',     label: 'Polar Push',            url: 'https://twigs002.github.io/polar-push/' },
    { id: 'invoicing', label: 'Broker Invoicing',      url: 'https://twigs002.github.io/broker-invoicing/' },
    { id: 'clock',     label: 'Clock In/Out',          url: 'https://staffclock-app.vercel.app/' },
  ],
});
