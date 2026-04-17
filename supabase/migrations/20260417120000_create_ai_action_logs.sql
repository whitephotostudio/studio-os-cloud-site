-- ═══════════════════════════════════════════════════════════════════════════
-- Studio Assistant — ai_action_logs
--
-- Every parsed + executed command from the dashboard Studio Assistant is
-- written here so photographers (and eventually support) can audit what the
-- assistant did on their behalf.
--
-- Rows are scoped to photographer_id.  Service-role writes happen from the
-- /api/studio-assistant/run route after auth has been established.  Clients
-- can only read their own rows.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ai_action_logs (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid references public.photographers(id) on delete cascade,
  user_id uuid,
  intent text not null,
  status text not null default 'pending',   -- pending | succeeded | rejected | failed
  command_text text,                         -- original user-typed/spoken command
  params jsonb not null default '{}'::jsonb, -- structured params the executor saw
  confidence numeric,                        -- 0..1 parser score
  requires_confirmation boolean not null default false,
  confirmed boolean not null default false,
  result jsonb,                              -- sanitized executor result
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_action_logs_photographer_idx
  on public.ai_action_logs (photographer_id, created_at desc);

create index if not exists ai_action_logs_intent_idx
  on public.ai_action_logs (photographer_id, intent, created_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Service-role (API routes) bypasses RLS, so all inserts happen server-side.
-- Photographers are allowed to read (but not mutate) their own log rows.

alter table public.ai_action_logs enable row level security;

drop policy if exists "Photographer reads own ai action logs" on public.ai_action_logs;
create policy "Photographer reads own ai action logs"
  on public.ai_action_logs for select
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

-- Explicit deny: clients cannot write directly.  If an INSERT/UPDATE/DELETE
-- policy is missing, PostgREST rejects the request by default, but we add a
-- no-op placeholder here to make the intent obvious on future audits.

comment on table public.ai_action_logs is
  'Audit log of Studio Assistant actions.  Writes happen server-side only.';
