alter table public.collections
drop constraint if exists collections_kind_check;

alter table public.collections
add constraint collections_kind_check
check (kind in ('album', 'class', 'gallery', 'composite'));
