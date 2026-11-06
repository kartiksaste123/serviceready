-- ServiceReady core schema for PayPal AI Hackathon (applied to Supabase project as migration 20261106071343)
create extension if not exists "pgcrypto";

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text not null default '',
  email text not null,
  currency text not null default 'USD' check (currency = 'USD'),
  default_deposit_pct integer not null default 30 check (default_deposit_pct between 0 and 100),
  reminder_tone text not null default 'friendly' check (reminder_tone in ('friendly','neutral','firm')),
  max_reminders integer not null default 3 check (max_reminders >= 0),
  wait_days_before_nudge integer not null default 3 check (wait_days_before_nudge >= 0),
  auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  title text not null,
  description text not null default '',
  deliverables jsonb not null default '[]'::jsonb,
  price_cents integer not null check (price_cents >= 0),
  deposit_pct integer not null check (deposit_pct between 0 and 100),
  lead_time_days integer not null default 7 check (lead_time_days >= 0),
  status text not null default 'draft' check (status in ('published','draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists services_seller_id_idx on public.services(seller_id);
create index if not exists services_seller_status_idx on public.services(seller_id, status);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  service_id uuid not null references public.services(id),
  service_title text not null,
  client_name text not null,
  client_email text not null,
  brief text not null default '',
  scope_summary text not null default '',
  line_items jsonb not null default '[]'::jsonb,
  total_cents integer not null check (total_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  balance_cents integer not null check (balance_cents >= 0),
  status text not null default 'quoted' check (status in ('quoted','deposit_paid','delivered','balance_invoiced','paid','cancelled')),
  source text not null default 'web' check (source in ('web','mcp','webmcp','agent_sim')),
  approval_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quotes_seller_id_idx on public.quotes(seller_id);
create index if not exists quotes_status_idx on public.quotes(status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  kind text not null check (kind in ('deposit','balance')),
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending',
  paypal_order_id text,
  paypal_capture_id text,
  paypal_invoice_id text,
  invoice_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_quote_id_idx on public.payments(quote_id);
create unique index if not exists payments_paypal_order_id_uidx on public.payments(paypal_order_id) where paypal_order_id is not null;
create unique index if not exists payments_paypal_capture_id_uidx on public.payments(paypal_capture_id) where paypal_capture_id is not null;
create unique index if not exists payments_paypal_invoice_id_uidx on public.payments(paypal_invoice_id) where paypal_invoice_id is not null;

create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references public.quotes(id) on delete cascade,
  seller_id uuid references public.sellers(id) on delete cascade,
  actor text not null check (actor in ('seller_agent','client_agent','collections_agent','system','seller','client','paypal')),
  kind text not null check (kind in ('tool_call','message','webhook','decision','approval')),
  tool text,
  input jsonb,
  output jsonb,
  text text,
  created_at timestamptz not null default now()
);
create index if not exists agent_events_quote_id_idx on public.agent_events(quote_id);

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  client_name text not null,
  action text not null check (action in ('wait','send_reminder','thank_and_close','escalate')),
  reason text not null default '',
  evidence text not null default '',
  draft_message text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists proposals_quote_id_idx on public.proposals(quote_id);
create index if not exists proposals_status_idx on public.proposals(status);

create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  from_party text not null check (from_party in ('client','seller')),
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists replies_quote_id_idx on public.replies(quote_id);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  paypal_transmission_id text unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.sellers enable row level security;
alter table public.services enable row level security;
alter table public.quotes enable row level security;
alter table public.payments enable row level security;
alter table public.agent_events enable row level security;
alter table public.proposals enable row level security;
alter table public.replies enable row level security;
alter table public.webhook_events enable row level security;

-- Hackathon demo: judges share one seeded seller, so reads/writes are open via the anon key.
-- Tighten to auth.uid() = sellers.auth_user_id before any real launch.
create policy sellers_public_read on public.sellers for select using (true);
create policy services_public_read on public.services for select using (status = 'published' or true);
create policy quotes_public_read on public.quotes for select using (true);
create policy payments_public_read on public.payments for select using (true);
create policy agent_events_public_read on public.agent_events for select using (true);
create policy proposals_public_read on public.proposals for select using (true);
create policy replies_public_read on public.replies for select using (true);
create policy sellers_anon_write on public.sellers for all using (true) with check (true);
create policy services_anon_write on public.services for all using (true) with check (true);
create policy quotes_anon_write on public.quotes for all using (true) with check (true);
create policy payments_anon_write on public.payments for all using (true) with check (true);
create policy agent_events_anon_write on public.agent_events for all using (true) with check (true);
create policy proposals_anon_write on public.proposals for all using (true) with check (true);
create policy replies_anon_write on public.replies for all using (true) with check (true);
create policy webhook_events_service on public.webhook_events for all using (true) with check (true);
