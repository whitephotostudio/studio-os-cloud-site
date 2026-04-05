-- Allow authenticated users to INSERT media for projects they own
create policy "Photographers can insert media for own projects"
  on public.media for insert
  to authenticated
  with check (
    exists (
      select 1 from public.projects p
      join public.photographers ph on ph.id = p.photographer_id
      where p.id = media.project_id
        and ph.user_id = auth.uid()
    )
  );

-- Allow authenticated users to SELECT media for projects they own
create policy "Photographers can view media for own projects"
  on public.media for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      join public.photographers ph on ph.id = p.photographer_id
      where p.id = media.project_id
        and ph.user_id = auth.uid()
    )
  );

-- Allow authenticated users to UPDATE media for projects they own
create policy "Photographers can update media for own projects"
  on public.media for update
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      join public.photographers ph on ph.id = p.photographer_id
      where p.id = media.project_id
        and ph.user_id = auth.uid()
    )
  );

-- Allow authenticated users to DELETE media for projects they own
create policy "Photographers can delete media for own projects"
  on public.media for delete
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      join public.photographers ph on ph.id = p.photographer_id
      where p.id = media.project_id
        and ph.user_id = auth.uid()
    )
  );
