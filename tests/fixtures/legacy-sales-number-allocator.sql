-- Exact pre-repair deployed allocator, captured read-only on 2026-10-04.
CREATE OR REPLACE FUNCTION public._sales_allocate_number(p_photographer_id uuid, p_kind text, p_prefix text, p_padding integer)
 RETURNS TABLE(sequence_number bigint, document_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sequence bigint;
  v_number text;
begin
  if p_kind not in ('invoice', 'quote') then
    raise exception 'Unsupported sales document kind' using errcode = '22023';
  end if;

  loop
    insert into public.sales_number_sequences (photographer_id, kind, next_sequence)
    values (p_photographer_id, p_kind, 2)
    on conflict (photographer_id, kind) do update
      set next_sequence = public.sales_number_sequences.next_sequence + 1,
          updated_at = timezone('utc', now())
    returning next_sequence - 1 into v_sequence;

    v_number := left(coalesce(p_prefix, ''), 100) || lpad(v_sequence::text, p_padding, '0');
    exit when not exists (
      select 1 from public.sales_documents d
       where d.photographer_id = p_photographer_id
         and d.kind = p_kind
         and d.document_number = v_number
    );
  end loop;

  return query select v_sequence, v_number;
end;
$function$;
