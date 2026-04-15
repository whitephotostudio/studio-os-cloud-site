-- Feature Requests table
create table if not exists feature_requests (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references photographers(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'declined')),
  vote_count int not null default 0,
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Feature Request Votes table (one vote per photographer per request)
create table if not exists feature_request_votes (
  id uuid primary key default gen_random_uuid(),
  feature_request_id uuid not null references feature_requests(id) on delete cascade,
  photographer_id uuid not null references photographers(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(feature_request_id, photographer_id)
);

-- Indexes
create index if not exists idx_feature_requests_status on feature_requests(status);
create index if not exists idx_feature_requests_vote_count on feature_requests(vote_count desc);
create index if not exists idx_feature_request_votes_request on feature_request_votes(feature_request_id);
create index if not exists idx_feature_request_votes_photographer on feature_request_votes(photographer_id);

-- RPC functions for atomic vote count updates
create or replace function increment_vote_count(request_id uuid)
returns void language sql security definer as $$
  update feature_requests set vote_count = vote_count + 1 where id = request_id;
$$;

create or replace function decrement_vote_count(request_id uuid)
returns void language sql security definer as $$
  update feature_requests set vote_count = greatest(vote_count - 1, 0) where id = request_id;
$$;

-- RLS policies
alter table feature_requests enable row level security;
alter table feature_request_votes enable row level security;

-- Anyone authenticated can read feature requests
create policy "Authenticated users can read feature requests"
  on feature_requests for select
  to authenticated
  using (true);

-- Photographers can insert their own requests
create policy "Photographers can insert own requests"
  on feature_requests for insert
  to authenticated
  with check (
    photographer_id in (
      select id from photographers where user_id = auth.uid()
    )
  );

-- Anyone authenticated can read votes
create policy "Authenticated users can read votes"
  on feature_request_votes for select
  to authenticated
  using (true);

-- Photographers can insert their own votes
create policy "Photographers can insert own votes"
  on feature_request_votes for insert
  to authenticated
  with check (
    photographer_id in (
      select id from photographers where user_id = auth.uid()
    )
  );

-- Photographers can delete their own votes (unvote)
create policy "Photographers can delete own votes"
  on feature_request_votes for delete
  to authenticated
  using (
    photographer_id in (
      select id from photographers where user_id = auth.uid()
    )
  );
