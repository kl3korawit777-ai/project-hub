-- Project Hub · schema (รันซ้ำได้)
create extension if not exists pgcrypto;

create table if not exists public.hub_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  tagline text,
  status text not null default 'idea' check (status in ('idea','planning','active','paused','done')),
  tags text[] not null default '{}',
  start_date date,
  end_date date,
  web_url text,
  github_url text,
  folder_path text,
  extra_links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table if not exists public.hub_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.hub_projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  due_date date,
  done boolean not null default false,
  sort_order int not null default 0
);

create table if not exists public.hub_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.hub_projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null default current_date,
  version text,
  note text not null
);

create index if not exists hub_milestones_project_idx on public.hub_milestones(project_id);
create index if not exists hub_updates_project_idx on public.hub_updates(project_id);

-- ---------- triggers ----------
create or replace function public.hub_set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists hub_projects_updated_at on public.hub_projects;
create trigger hub_projects_updated_at before update on public.hub_projects
  for each row execute function public.hub_set_updated_at();

create or replace function public.hub_touch_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  pid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  update public.hub_projects set updated_at = now() where id = pid;
  return null;
end $$;

drop trigger if exists hub_milestones_touch on public.hub_milestones;
create trigger hub_milestones_touch after insert or update or delete on public.hub_milestones
  for each row execute function public.hub_touch_parent();

drop trigger if exists hub_updates_touch on public.hub_updates;
create trigger hub_updates_touch after insert or update or delete on public.hub_updates
  for each row execute function public.hub_touch_parent();

-- ---------- RLS ----------
alter table public.hub_projects   enable row level security;
alter table public.hub_milestones enable row level security;
alter table public.hub_updates    enable row level security;

drop policy if exists hub_projects_own on public.hub_projects;
create policy hub_projects_own on public.hub_projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists hub_milestones_own on public.hub_milestones;
create policy hub_milestones_own on public.hub_milestones for all to authenticated
  using (user_id = auth.uid()
         and project_id in (select id from public.hub_projects where user_id = auth.uid()))
  with check (user_id = auth.uid()
         and project_id in (select id from public.hub_projects where user_id = auth.uid()));

drop policy if exists hub_updates_own on public.hub_updates;
create policy hub_updates_own on public.hub_updates for all to authenticated
  using (user_id = auth.uid()
         and project_id in (select id from public.hub_projects where user_id = auth.uid()))
  with check (user_id = auth.uid()
         and project_id in (select id from public.hub_projects where user_id = auth.uid()));

-- ---------- สิทธิ์ ----------
revoke all on public.hub_projects, public.hub_milestones, public.hub_updates from anon;
grant select, insert, update, delete on public.hub_projects, public.hub_milestones, public.hub_updates to authenticated;

-- ---------- view ----------
-- สร้างเฉพาะเมื่อยังไม่มี: ถ้าเคยรัน 002_agent_access.sql แล้ว view จะมีคอลัมน์ last_update_source/agent
-- การรัน schema.sql ซ้ำต้องไม่ทับ view นั้นด้วยเวอร์ชันเก่า
do $do$
begin
  if not exists (select 1 from pg_views where schemaname = 'public' and viewname = 'hub_project_overview') then
    create view public.hub_project_overview with (security_invoker = true) as
    select p.*,
      (select count(*) from public.hub_milestones m where m.project_id = p.id)::int as milestones_total,
      (select count(*) from public.hub_milestones m where m.project_id = p.id and m.done)::int as milestones_done,
      lu.date as last_update_date,
      lu.note as last_update_note
    from public.hub_projects p
    left join lateral (
      select u.date, u.note from public.hub_updates u
      where u.project_id = p.id order by u.date desc, u.id desc limit 1
    ) lu on true;
  end if;
end $do$;

revoke all on public.hub_project_overview from anon;
grant select on public.hub_project_overview to authenticated;
