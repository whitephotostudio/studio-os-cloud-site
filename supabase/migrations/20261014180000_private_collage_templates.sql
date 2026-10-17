-- Preview feature. Apply only after review; no production application is implied.
begin;
create table public.collage_templates (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id),
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  unique(id, photographer_id)
);
create table public.collage_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  photographer_id uuid not null,
  version_number integer not null check (version_number > 0),
  design jsonb not null check (jsonb_typeof(design) = 'object' and design->>'version' = '1' and design->'overlay' = 'null'::jsonb),
  artwork_key text,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key(template_id, photographer_id) references public.collage_templates(id, photographer_id),
  unique(template_id, version_number),
  unique(id, photographer_id),
  check (artwork_key is null or artwork_key ~ ('^order-automation/' || photographer_id::text || '/collages/artwork/[a-f0-9]{64}[.]png$'))
);
create table public.collage_template_galleries (
  version_id uuid not null,
  photographer_id uuid not null,
  school_id uuid references public.schools(id),
  project_id uuid references public.projects(id),
  revoked_at timestamptz,
  foreign key(version_id, photographer_id) references public.collage_template_versions(id, photographer_id),
  check ((school_id is null) <> (project_id is null))
);
create unique index collage_school_version on public.collage_template_galleries(version_id, school_id) where school_id is not null;
create unique index collage_project_version on public.collage_template_galleries(version_id, project_id) where project_id is not null;
alter table public.collage_templates enable row level security;
alter table public.collage_template_versions enable row level security;
alter table public.collage_template_galleries enable row level security;
revoke all on public.collage_templates, public.collage_template_versions, public.collage_template_galleries from public, anon, authenticated;
grant select on public.collage_templates, public.collage_template_versions, public.collage_template_galleries to authenticated;
grant all on public.collage_templates, public.collage_template_versions, public.collage_template_galleries to service_role;
create policy collage_owner_templates on public.collage_templates for select to authenticated using (exists(select 1 from public.photographers p where p.id = photographer_id and p.user_id = auth.uid()));
create policy collage_owner_versions on public.collage_template_versions for select to authenticated using (exists(select 1 from public.photographers p where p.id = photographer_id and p.user_id = auth.uid()));
create policy collage_owner_galleries on public.collage_template_galleries for select to authenticated using (exists(select 1 from public.photographers p where p.id = photographer_id and p.user_id = auth.uid()));

create function public.keep_collage_version_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Collage versions and gallery grants are immutable. Save a new version.' using errcode = '42501'; end;
$$;
create trigger collage_versions_immutable before update or delete on public.collage_template_versions for each row execute function public.keep_collage_version_immutable();
revoke all on function public.keep_collage_version_immutable() from public, anon, authenticated, service_role;
create function public.keep_collage_gallery_grant_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null
    and new.version_id is not distinct from old.version_id and new.photographer_id is not distinct from old.photographer_id
    and new.school_id is not distinct from old.school_id and new.project_id is not distinct from old.project_id then return new; end if;
  raise exception 'Collage gallery grants are immutable except for one-way withdrawal.' using errcode = '42501';
end;
$$;
create trigger collage_grants_immutable before update or delete on public.collage_template_galleries for each row execute function public.keep_collage_gallery_grant_immutable();
revoke all on function public.keep_collage_gallery_grant_immutable() from public, anon, authenticated, service_role;
create function public.withdraw_collage_gallery_access(p_version_id uuid, p_photographer_id uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare withdrawn integer;
begin
  perform 1 from public.collage_template_versions where id = p_version_id and photographer_id = p_photographer_id for update;
  if not found then raise exception 'Collage version belongs to another studio' using errcode = '42501'; end if;
  update public.collage_template_galleries set revoked_at = now() where version_id = p_version_id and photographer_id = p_photographer_id and revoked_at is null;
  get diagnostics withdrawn = row_count;
  return withdrawn;
end;
$$;
revoke all on function public.withdraw_collage_gallery_access(uuid,uuid) from public, anon, authenticated;
grant execute on function public.withdraw_collage_gallery_access(uuid,uuid) to service_role;

create function public.save_collage_template_version(p_template_id uuid, p_photographer_id uuid, p_name text,
  p_design jsonb, p_artwork_key text, p_content_hash text, p_published boolean, p_school_ids uuid[], p_project_ids uuid[])
returns public.collage_template_versions language plpgsql security definer set search_path = '' as $$
declare current_template public.collage_templates; saved public.collage_template_versions; next_number integer;
begin
  if p_template_id is null or p_photographer_id is null or cardinality(p_school_ids) > 100 or cardinality(p_project_ids) > 100 then raise exception 'Invalid collage publication'; end if;
  -- Service-only entry point. Recheck every relationship inside the same transaction.
  if not exists(select 1 from public.photographers where id = p_photographer_id) then raise exception 'Studio unavailable' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id::text, 17));
  select * into current_template from public.collage_templates where id = p_template_id for update;
  if found and current_template.photographer_id <> p_photographer_id then raise exception 'Collage owner changed' using errcode = '42501'; end if;
  if not found then insert into public.collage_templates(id,photographer_id,name) values(p_template_id,p_photographer_id,p_name);
  else update public.collage_templates set name = p_name where id = p_template_id; end if;
  if exists(select 1 from unnest(p_school_ids) supplied(id) where not exists(select 1 from public.schools s where s.id = supplied.id and s.photographer_id = p_photographer_id))
    or exists(select 1 from unnest(p_project_ids) supplied(id) where not exists(select 1 from public.projects p where p.id = supplied.id and p.photographer_id = p_photographer_id)) then
    raise exception 'Collage gallery belongs to another studio' using errcode = '42501';
  end if;
  select coalesce(max(version_number),0)+1 into next_number from public.collage_template_versions where template_id = p_template_id;
  insert into public.collage_template_versions(template_id,photographer_id,version_number,design,artwork_key,content_hash,published)
    values(p_template_id,p_photographer_id,next_number,p_design,p_artwork_key,p_content_hash,p_published) returning * into saved;
  insert into public.collage_template_galleries(version_id,photographer_id,school_id) select saved.id,p_photographer_id,id from (select distinct unnest(p_school_ids) id) ids;
  insert into public.collage_template_galleries(version_id,photographer_id,project_id) select saved.id,p_photographer_id,id from (select distinct unnest(p_project_ids) id) ids;
  return saved;
end;
$$;
revoke all on function public.save_collage_template_version(uuid,uuid,text,jsonb,text,text,boolean,uuid[],uuid[]) from public, anon, authenticated;
grant execute on function public.save_collage_template_version(uuid,uuid,text,jsonb,text,text,boolean,uuid[],uuid[]) to service_role;

alter table public.order_items add column if not exists collage_snapshot jsonb;
alter table public.order_items add constraint collage_snapshot_shape check (collage_snapshot is null or (jsonb_typeof(collage_snapshot) = 'object' and collage_snapshot->>'version' = '1'));
alter table public.order_items add constraint collage_one_recipe_per_copy check (collage_snapshot is null or quantity is not distinct from 1);
create function public.keep_order_collage_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.collage_snapshot is not null and new.collage_snapshot is distinct from old.collage_snapshot then raise exception 'Purchased collage selections are immutable' using errcode = '42501'; end if;
  return new;
end;
$$;
create trigger order_collage_immutable before update on public.order_items for each row execute function public.keep_order_collage_immutable();
revoke all on function public.keep_order_collage_immutable() from public, anon, authenticated, service_role;

-- Preserve transactional checkout replay while retaining the immutable print recipe.
create or replace function public.create_checkout_order_once(
  p_key text, p_hash text, p_orders jsonb, p_items jsonb, p_response jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.checkout_attempts; o jsonb; i jsonb;
begin
  -- Also serialize identical cart submissions from two tabs/devices. The
  -- explicit attempt key protects long retries; this short content window
  -- catches independently generated keys for the same accidental submission.
  perform pg_advisory_xact_lock(hashtextextended(p_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_key, 1));
  select * into saved from public.checkout_attempts where key = p_key;
  if found then
    if saved.payload_hash <> p_hash then raise exception 'Checkout contents changed; reload your cart.'; end if;
    return saved.response;
  end if;
  select * into saved from public.checkout_attempts where payload_hash = p_hash
    and created_at > now() - interval '10 minutes' order by created_at limit 1;
  if found then
    insert into public.checkout_attempts(key,payload_hash,response) values(p_key,p_hash,saved.response);
    return saved.response;
  end if;
  if jsonb_array_length(p_orders) < 1 or jsonb_array_length(p_items) < 1 then raise exception 'Empty checkout'; end if;
  for o in select value from jsonb_array_elements(p_orders) loop
    insert into public.orders (id, photographer_id, parent_name, parent_email, parent_phone,
      customer_name, customer_email, package_id, package_name, package_price,
      special_notes, notes, status, payment_status, seen_by_photographer, subtotal_cents,
      tax_cents, total_cents, total_amount, currency, cart_snapshot, school_id, class_id,
      student_id, project_id, order_group_id)
    values ((o->>'id')::uuid, (o->>'photographer_id')::uuid, o->>'parent_name', o->>'parent_email', o->>'parent_phone',
      o->>'customer_name', o->>'customer_email', (o->>'package_id')::uuid, o->>'package_name', (o->>'package_price')::numeric,
      o->>'special_notes', o->>'notes', 'payment_pending', 'pending', false, (o->>'subtotal_cents')::integer,
      (o->>'tax_cents')::integer, (o->>'total_cents')::integer, (o->>'total_amount')::numeric, o->>'currency',
      o->'cart_snapshot', (o->>'school_id')::uuid, (o->>'class_id')::uuid,
      (o->>'student_id')::uuid, (o->>'project_id')::uuid, (o->>'order_group_id')::uuid);
  end loop;
  for i in select value from jsonb_array_elements(p_items) loop
    insert into public.order_items (order_id, product_name, quantity, price, unit_price_cents, line_total_cents, sku, collage_snapshot)
    values ((i->>'order_id')::uuid, i->>'product_name', (i->>'quantity')::integer,
      (i->>'price')::numeric, (i->>'unit_price_cents')::integer, (i->>'line_total_cents')::integer, i->>'sku', nullif(i->'collage_snapshot', 'null'::jsonb));
  end loop;
  insert into public.checkout_attempts(key, payload_hash, response) values (p_key, p_hash, p_response);
  return p_response;
end $$;
revoke all on function public.create_checkout_order_once(text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_order_once(text,text,jsonb,jsonb,jsonb) to service_role;

commit;
