-- Floating Clawd: one personal "today" task list, shared by laptop and phone.

create table if not exists public.tasks (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  done        boolean not null default false,
  done_at     timestamptz,
  for_date    date not null,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create index if not exists tasks_user_date_idx on public.tasks (user_id, for_date);

alter table public.tasks enable row level security;

create policy "tasks: read own"   on public.tasks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "tasks: insert own" on public.tasks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "tasks: update own" on public.tasks for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy: clients soft-delete (deleted = true) so other devices learn about it.

-- Last write wins on the client-stamped updated_at: an older write is skipped,
-- so an edit queued offline can't overwrite a newer one from the other device.
create or replace function public.tasks_reject_stale() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at < old.updated_at then return null; end if;
  return new;
end $$;

drop trigger if exists tasks_reject_stale on public.tasks;
create trigger tasks_reject_stale before update on public.tasks
for each row execute function public.tasks_reject_stale();

alter publication supabase_realtime add table public.tasks;
