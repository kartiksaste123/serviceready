-- Deposit AUTHORIZE → capture-on-start support (Orders v2 intent=AUTHORIZE).
alter table public.payments add column if not exists intent text not null default 'CAPTURE';
alter table public.payments add column if not exists paypal_authorization_id text;
create unique index if not exists payments_paypal_authorization_id_uidx
  on public.payments(paypal_authorization_id) where paypal_authorization_id is not null;
