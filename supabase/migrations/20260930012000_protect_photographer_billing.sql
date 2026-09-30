-- Photographer profile editing must not grant owner access or rewrite billing.
begin;

create or replace function public.protect_photographer_billing_fields()
returns trigger language plpgsql set search_path = public as $$
declare protected text; before_row jsonb:=to_jsonb(old); after_row jsonb:=to_jsonb(new);
begin
  -- Invoker security deliberately preserves the originating SQL identity.
  -- Stripe handlers and the existing service-only trial/device RPCs can update
  -- billing, including when a trusted SECURITY DEFINER routine is invoked.
  if current_user not in ('authenticated','anon') then return new; end if;
  foreach protected in array array[
    'id','user_id','created_at','studio_id','is_platform_admin',
    'stripe_account_id','stripe_connected_account_id',
    'stripe_connect_onboarding_complete','stripe_connect_charges_enabled','stripe_connect_payouts_enabled',
    'stripe_platform_customer_id','stripe_subscription_id',
    'stripe_subscription_item_base_id','stripe_subscription_item_extra_keys_id','stripe_subscription_item_usage_id',
    'subscription_plan_code','subscription_billing_interval','subscription_status',
    'subscription_current_period_start','subscription_current_period_end',
    'order_usage_rate_cents','extra_desktop_keys','trial_starts_at','trial_ends_at'
  ] loop
    if (before_row->protected) is distinct from (after_row->protected) then
      raise exception 'Billing and access fields can only be changed by Studio OS billing.' using errcode='42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.protect_photographer_billing_fields() from public,anon,authenticated;
drop trigger if exists protect_photographer_billing on public.photographers;
create trigger protect_photographer_billing before update on public.photographers
  for each row execute function public.protect_photographer_billing_fields();

-- Confirmed signup and the service-only/native trial initializer create the
-- profile. Deleting/recreating it from a client could reset the free trial.
revoke insert,delete on public.photographers from anon,authenticated;
commit;
