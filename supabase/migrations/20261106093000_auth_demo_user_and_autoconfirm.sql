-- ServiceReady auth: demo judge user link + hackathon email autoconfirm.
-- Applied to project zowgpalngptmtipqcgme (demo user created via Auth signup API).

-- Unique seller-per-auth-user (nulls allowed for legacy rows).
create unique index if not exists sellers_auth_user_id_uidx
  on public.sellers(auth_user_id)
  where auth_user_id is not null;

-- Link seeded demo seller to demo@serviceready.app when that auth user exists.
update public.sellers
set auth_user_id = (select id from auth.users where email = 'demo@serviceready.app'),
    updated_at = now()
where slug = 'maya-rao-studio'
  and exists (select 1 from auth.users where email = 'demo@serviceready.app');

-- Confirm demo user email if present.
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
where email = 'demo@serviceready.app';

update auth.identities
set identity_data = identity_data || jsonb_build_object('email_verified', true),
    updated_at = now()
where user_id = (select id from auth.users where email = 'demo@serviceready.app' limit 1);

-- Hackathon: auto-confirm email/password signups so judges can register without SMTP.
create or replace function public.auth_auto_confirm_email()
returns trigger
language plpgsql
security definer
set search_path = auth, public
as $$
begin
  if new.email is not null and new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auth_auto_confirm_email on auth.users;
create trigger trg_auth_auto_confirm_email
  before insert on auth.users
  for each row
  execute function public.auth_auto_confirm_email();
