alter table public.photographers
  add column if not exists tax_enabled boolean not null default false,
  add column if not exists tax_percent numeric(6,3) not null default 0,
  add column if not exists tax_label text not null default 'Tax',
  add column if not exists tax_country text not null default 'CA',
  add column if not exists tax_rates_by_country jsonb not null default '{}'::jsonb;

comment on column public.photographers.tax_enabled is
  'Studio-wide checkout tax fallback. Gallery-level tax settings override this value.';
comment on column public.photographers.tax_percent is
  'Studio-wide checkout tax percent fallback, for example 13 for Ontario HST.';
comment on column public.photographers.tax_label is
  'Studio-wide checkout tax label shown in parent carts and receipts.';
comment on column public.photographers.tax_country is
  'Default ISO country code used for studio-wide checkout tax.';
comment on column public.photographers.tax_rates_by_country is
  'Optional country-to-percent map for studio-wide checkout tax fallback.';
