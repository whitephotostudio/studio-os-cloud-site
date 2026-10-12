-- Own-row profile UPDATE must not grant administrator-managed voice or beta
-- entitlements. Keep the existing billing/access guard and profile grants intact.
begin;

create or replace function public.protect_photographer_voice_beta_entitlements()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  protected text;
  before_row jsonb := to_jsonb(old);
  after_row jsonb := to_jsonb(new);
begin
  -- Use the actual database role, never a client-controlled JWT role claim.
  -- Trusted service handlers and existing SECURITY DEFINER routines retain
  -- authority to administer entitlements and account for paid voice usage.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  foreach protected in array array[
    'voice_premium_enabled',
    'voice_monthly_char_limit',
    'voice_chars_used_this_month',
    'voice_usage_period_start',
    'studio_app_beta_access'
  ] loop
    if (before_row -> protected) is distinct from (after_row -> protected) then
      raise exception 'Voice and beta access fields can only be changed by Studio OS administration.'
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.protect_photographer_voice_beta_entitlements()
  from public, anon, authenticated;

drop trigger if exists protect_photographer_voice_beta_entitlements
  on public.photographers;
create trigger protect_photographer_voice_beta_entitlements
  before update on public.photographers
  for each row
  execute function public.protect_photographer_voice_beta_entitlements();

-- INSERT remains governed by the existing signup/service-only permissions.
-- Default values and trusted profile creation are deliberately unchanged.
commit;
