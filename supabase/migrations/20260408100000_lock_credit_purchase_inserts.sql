-- Prevent client-side credit manipulation.
-- Only the service_role (used by Stripe webhooks / server-side API routes) may
-- insert purchase or refund transactions, or increase credit balances.
-- Authenticated users may still SELECT their own rows and INSERT usage
-- transactions (which deduct credits).

-- ── studio_credits ──────────────────────────────────────────────────────────

-- Enable RLS (idempotent)
alter table public.studio_credits enable row level security;

-- Allow users to read their own credit balance
drop policy if exists "Users can read own credits" on public.studio_credits;
create policy "Users can read own credits"
  on public.studio_credits for select
  using (studio_id = auth.uid());

-- Allow users to update their own row ONLY when balance decreases (deduction).
-- Prevents client-side balance increases (free credits).
drop policy if exists "Users can deduct own credits" on public.studio_credits;
create policy "Users can deduct own credits"
  on public.studio_credits for update
  using (studio_id = auth.uid())
  with check (balance <= (select sc.balance from public.studio_credits sc where sc.studio_id = auth.uid() limit 1));

-- Allow users to insert their own initial row (balance = 0 only)
drop policy if exists "Users can init own credits" on public.studio_credits;
create policy "Users can init own credits"
  on public.studio_credits for insert
  with check (studio_id = auth.uid() and balance = 0);

-- ── credit_transactions ─────────────────────────────────────────────────────

alter table public.credit_transactions enable row level security;

-- Users can read their own transaction history
drop policy if exists "Users can read own transactions" on public.credit_transactions;
create policy "Users can read own transactions"
  on public.credit_transactions for select
  using (studio_id = auth.uid());

-- Users may only insert usage transactions (which deduct credits).
-- Purchase and refund transactions are written by the service_role via webhook.
drop policy if exists "Users can insert usage transactions" on public.credit_transactions;
create policy "Users can insert usage transactions"
  on public.credit_transactions for insert
  with check (studio_id = auth.uid() and type = 'usage' and amount <= 0);
