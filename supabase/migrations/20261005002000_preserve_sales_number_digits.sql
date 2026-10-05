-- PostgreSQL lpad truncates digits when a sequence outgrows the configured
-- minimum width. Correct future allocation without renumbering legal records.
-- CREATE OR REPLACE preserves the existing internal function's privileges.
create or replace function public._sales_allocate_number(
  p_photographer_id uuid, p_kind text, p_prefix text, p_padding integer
) returns table(sequence_number bigint, document_number text)
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  v_sequence bigint;
  v_number text;
  v_minimum bigint;
  v_attempt integer;
begin
  if p_kind is null or p_kind not in ('invoice', 'quote') then
    raise exception 'Unsupported sales document kind' using errcode = '22023';
  end if;
  if p_padding is null or p_padding not between 1 and 12 then
    raise exception 'Sales number padding must be between 1 and 12' using errcode = '22023';
  end if;

  -- Imports normally advance this counter themselves. A restored or absent
  -- counter must also respect every typed legacy sequence, including deleted
  -- drafts, without interpreting custom document labels as sequence numbers.
  select coalesce(max(d.sequence_number), 0) + 1 into v_minimum
  from public.sales_documents d
  where d.photographer_id = p_photographer_id and d.kind = p_kind
    and d.sequence_number > 0;

  for v_attempt in 1..1000 loop
    insert into public.sales_number_sequences(photographer_id, kind, next_sequence)
    values (p_photographer_id, p_kind, v_minimum + 1)
    on conflict (photographer_id, kind) do update
      set next_sequence = greatest(public.sales_number_sequences.next_sequence, v_minimum) + 1,
          updated_at = timezone('utc', now())
    returning next_sequence - 1 into v_sequence;

    v_number := left(coalesce(p_prefix, ''), 100) ||
      lpad(v_sequence::text, greatest(length(v_sequence::text), p_padding), '0');
    if not exists (
      select 1 from public.sales_documents d
      where d.photographer_id = p_photographer_id and d.kind = p_kind
        and d.document_number = v_number
    ) then
      return query select v_sequence, v_number;
      return;
    end if;
  end loop;

  -- Raising rolls back this call's counter updates with its transaction.
  raise exception 'Sales number allocation needs reconciliation: too many existing number collisions'
    using errcode = '54000';
end;
$function$;
