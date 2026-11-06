-- Cancellation / no-show policy engine, final-bill tip, and tamper-proof order fingerprints.
alter table public.sellers add column if not exists free_cancel_hours integer not null default 48 check (free_cancel_hours between 0 and 720);
alter table public.sellers add column if not exists late_cancel_keep_pct integer not null default 50 check (late_cancel_keep_pct between 0 and 100);
alter table public.sellers add column if not exists no_show_keep_pct integer not null default 100 check (no_show_keep_pct between 0 and 100);
-- Policy is snapshotted onto each quote so later rule edits never apply retroactively.
alter table public.quotes add column if not exists cancel_policy jsonb;
alter table public.quotes add column if not exists tip_cents integer not null default 0 check (tip_cents >= 0);
alter table public.quotes add column if not exists deposit_paid_at timestamptz;
alter table public.quotes add column if not exists work_started_at timestamptz;
-- HMAC over the quote's amounts (server secret) — detects any row tampering before PayPal is called.
alter table public.quotes add column if not exists price_sig text;
-- HMAC over quote id + kind + amount + currency + intent; re-checked against the PayPal order before capture.
alter table public.payments add column if not exists fingerprint text;
alter table public.payments add column if not exists kept_cents integer;
alter table public.payments add column if not exists refunded_cents integer;
