alter table public.photographers
  add column if not exists subscription_billing_interval text not null default 'month';

update public.photographers
set subscription_billing_interval = coalesce(nullif(lower(subscription_billing_interval), ''), 'month')
where true;

alter table public.subscriptions
  add column if not exists billing_interval text not null default 'month';

update public.subscriptions
set billing_interval = coalesce(nullif(lower(billing_interval), ''), 'month')
where true;

insert into public.credit_packages (
  id,
  name,
  credits,
  price_cents,
  active,
  sort_order,
  created_at,
  package_code
)
values
  ('f3b3aa37-3da0-44ee-924f-4f65f2ee1db6', 'Background Credits 250', 250, 1250, true, 1, now(), 'background_credits_250'),
  ('78d926f6-b6d3-48eb-88c4-e4e0ec31f56f', 'Background Credits 1000', 1000, 4500, true, 2, now(), 'background_credits_1000'),
  ('e4b2d2aa-4b67-47b6-a6c9-ff5be3b3770d', 'Background Credits 2500', 2500, 10000, true, 3, now(), 'background_credits_2500'),
  ('4c8b6320-21c6-49f0-b70a-a2fd7bd83d7e', 'Background Credits 5000', 5000, 17500, true, 4, now(), 'background_credits_5000'),
  ('1d4d4229-6dcc-4227-9854-e0ea84629558', 'Background Credits 10000', 10000, 30000, true, 5, now(), 'background_credits_10000')
on conflict (package_code) do update
set
  name = excluded.name,
  credits = excluded.credits,
  price_cents = excluded.price_cents,
  active = excluded.active,
  sort_order = excluded.sort_order;
