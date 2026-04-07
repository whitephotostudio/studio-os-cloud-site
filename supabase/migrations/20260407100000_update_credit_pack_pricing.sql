-- Update credit pack pricing: background removal credits are purchased only.
-- No subscription plan includes free background-removal credits.
-- New pricing:
--   250  credits = $15.00
--   1000 credits = $55.00
--   2500 credits = $129.00
--   5000 credits = $239.00
--  10000 credits = $449.00

update public.credit_packages
set
  name = '250 Credits',
  price_cents = 1500
where package_code = 'background_credits_250';

update public.credit_packages
set
  name = '1000 Credits',
  price_cents = 5500
where package_code = 'background_credits_1000';

update public.credit_packages
set
  name = '2500 Credits',
  price_cents = 12900
where package_code = 'background_credits_2500';

update public.credit_packages
set
  name = '5000 Credits',
  price_cents = 23900
where package_code = 'background_credits_5000';

update public.credit_packages
set
  name = '10000 Credits',
  price_cents = 44900
where package_code = 'background_credits_10000';
