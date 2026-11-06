-- Demo seller used by the live judge path (/s/maya-rao-studio)
insert into public.sellers (slug, name, tagline, email, default_deposit_pct, reminder_tone, max_reminders, wait_days_before_nudge)
values ('maya-rao-studio', 'Maya Rao Studio', 'Brand identities for independent businesses — logos, kits and launch pages.', 'maya@mayarao.studio', 30, 'friendly', 3, 3)
on conflict (slug) do nothing;

insert into public.services (seller_id, title, description, deliverables, price_cents, deposit_pct, lead_time_days, status)
select s.id, v.title, v.description, v.deliverables::jsonb, v.price_cents, v.deposit_pct, v.lead_time_days, 'published'
from public.sellers s,
(values
  ('Brand Identity Sprint', 'Logo, color system, and type for an early-stage product.', '["Logo suite","Color + type tokens","Usage guide"]', 250000, 30, 10),
  ('Landing Page Design', 'High-converting marketing page in Figma, ready for handoff.', '["Desktop + mobile comps","Component notes","Export assets"]', 180000, 40, 7),
  ('Pitch Deck Refresh', 'Investor story redesign with charts and cover.', '["12-slide deck","Chart templates","Export PDF"]', 120000, 50, 5)
) as v(title, description, deliverables, price_cents, deposit_pct, lead_time_days)
where s.slug = 'maya-rao-studio'
  and not exists (select 1 from public.services x where x.seller_id = s.id and x.title = v.title);
