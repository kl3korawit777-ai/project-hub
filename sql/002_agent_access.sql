-- Project Hub · 002 ให้ AI ประจำโปรเจกต์อ่าน/อัปเดตข้อมูลของตัวเองได้ (รันซ้ำได้)
-- ต้องรัน sql/schema.sql ก่อนอย่างน้อยหนึ่งครั้ง
-- AI เรียกผ่าน /rest/v1/rpc/<ฟังก์ชัน> ด้วย anon/publishable key + token (ส่งเป็นพารามิเตอร์)
-- ฐานข้อมูลเก็บเฉพาะ sha256 ของ token ส่วน token จริงเห็นครั้งเดียวตอนสร้าง

do $$
begin
  if to_regclass('public.hub_projects') is null
     or to_regclass('public.hub_milestones') is null
     or to_regclass('public.hub_updates') is null then
    raise exception 'ไม่พบตาราง hub_* — ให้รัน sql/schema.sql ก่อน แล้วค่อยรันไฟล์นี้';
  end if;
end $$;

-- ---------- schema ภายใน (ไม่เปิดผ่าน API) ----------
create schema if not exists hub_private;
revoke all on schema hub_private from public, anon, authenticated;

-- ---------- ตาราง token ----------
create table if not exists public.hub_agent_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.hub_projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  token_hash bytea not null unique,
  token_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists hub_agent_tokens_project_idx on public.hub_agent_tokens(project_id);

alter table public.hub_agent_tokens enable row level security;
drop policy if exists hub_agent_tokens_select_own on public.hub_agent_tokens;
create policy hub_agent_tokens_select_own on public.hub_agent_tokens
  for select to authenticated using (user_id = auth.uid());

-- เจ้าของอ่านได้อย่างเดียว และอ่านได้เฉพาะบางคอลัมน์ (ไม่รวม token_hash)
revoke all on public.hub_agent_tokens from public, anon, authenticated;
grant select (id, project_id, user_id, label, token_hint, created_at, last_used_at, revoked_at)
  on public.hub_agent_tokens to authenticated;

-- ---------- คอลัมน์ใหม่ใน hub_updates ----------
alter table public.hub_updates
  add column if not exists source text not null default 'owner' check (source in ('owner', 'agent'));
alter table public.hub_updates add column if not exists agent_label text;
alter table public.hub_updates
  add column if not exists agent_token_id uuid references public.hub_agent_tokens(id) on delete set null;
alter table public.hub_updates add column if not exists created_at timestamptz not null default now();
create index if not exists hub_updates_agent_rate_idx on public.hub_updates(agent_token_id, created_at);

-- ---------- view (ต่อท้ายคอลัมน์เดิม) ----------
create or replace view public.hub_project_overview with (security_invoker = true) as
select p.*,
  (select count(*) from public.hub_milestones m where m.project_id = p.id)::int as milestones_total,
  (select count(*) from public.hub_milestones m where m.project_id = p.id and m.done)::int as milestones_done,
  lu.date as last_update_date,
  lu.note as last_update_note,
  lu.source as last_update_source,
  lu.agent_label as last_update_agent
from public.hub_projects p
left join lateral (
  select u.date, u.note, u.source, u.agent_label from public.hub_updates u
  where u.project_id = p.id order by u.date desc, u.id desc limit 1
) lu on true;

revoke all on public.hub_project_overview from anon;
grant select on public.hub_project_overview to authenticated;

-- =====================================================================
-- ฟังก์ชันภายใน (hub_private)
-- =====================================================================

-- ตรวจ token: คืนบริบทของ token หรือ raise 28000
create or replace function hub_private.agent_auth(p_token text)
returns table (token_id uuid, project_id uuid, user_id uuid, label text)
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.hub_agent_tokens;
begin
  if p_token is null or p_token !~ '^hub_[0-9a-f]{64}$' then
    raise exception 'invalid_token: token ไม่ถูกต้อง' using errcode = '28000';
  end if;
  select * into v_row from public.hub_agent_tokens t
   where t.token_hash = sha256(convert_to(p_token, 'UTF8')) and t.revoked_at is null;
  if not found then
    raise exception 'invalid_token: token ไม่ถูกต้องหรือถูกยกเลิกแล้ว' using errcode = '28000';
  end if;
  if v_row.last_used_at is null or v_row.last_used_at < now() - interval '1 minute' then
    update public.hub_agent_tokens set last_used_at = now() where id = v_row.id;
  end if;
  return query select v_row.id, v_row.project_id, v_row.user_id, v_row.label;
end $$;

create or replace function hub_private.text_field(x jsonb, fname text, maxlen int)
returns text language plpgsql set search_path = '' as $$
declare s text;
begin
  if x is null or jsonb_typeof(x) = 'null' then return null; end if;
  if jsonb_typeof(x) <> 'string' then
    raise exception 'invalid_value: % ต้องเป็นข้อความ', fname;
  end if;
  s := btrim(x #>> '{}');
  if s = '' then return null; end if;
  if char_length(s) > maxlen then
    raise exception 'invalid_value: % ยาวเกิน % ตัวอักษร', fname, maxlen;
  end if;
  return s;
end $$;

create or replace function hub_private.url_field(x jsonb, fname text)
returns text language plpgsql set search_path = '' as $$
declare s text;
begin
  s := hub_private.text_field(x, fname, 500);
  if s is not null and s !~* '^https?://\S+$' then
    raise exception 'invalid_url: % ต้องขึ้นต้นด้วย http:// หรือ https:// (พบ "%")', fname, left(s, 60);
  end if;
  return s;
end $$;

create or replace function hub_private.date_field(x jsonb, fname text)
returns date language plpgsql set search_path = '' as $$
declare s text;
begin
  if x is null or jsonb_typeof(x) = 'null' then return null; end if;
  if jsonb_typeof(x) <> 'string' then
    raise exception 'invalid_date: % ต้องเป็นข้อความรูปแบบ YYYY-MM-DD', fname;
  end if;
  s := btrim(x #>> '{}');
  if s = '' then return null; end if;
  if s !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'invalid_date: % "%" ไม่ถูกต้อง (ใช้รูปแบบ YYYY-MM-DD)', fname, left(s, 30);
  end if;
  begin
    return s::date;
  exception when others then
    raise exception 'invalid_date: % "%" ไม่มีอยู่จริงในปฏิทิน', fname, s;
  end;
end $$;

-- =====================================================================
-- ฟังก์ชันของเจ้าของ (authenticated เท่านั้น)
-- =====================================================================

create or replace function public.hub_create_agent_token(p_project_id uuid, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_label text := btrim(p_label);
  v_token text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated: ต้องล็อกอินก่อน' using errcode = '28000';
  end if;
  if v_label is null or char_length(v_label) not between 1 and 60 then
    raise exception 'invalid_label: ชื่อ AI ต้องยาว 1–60 ตัวอักษร';
  end if;
  perform 1 from public.hub_projects where id = p_project_id and user_id = v_uid for update;
  if not found then
    raise exception 'project_not_found: ไม่พบโปรเจกต์นี้';
  end if;
  if (select count(*) from public.hub_agent_tokens
       where project_id = p_project_id and revoked_at is null) >= 5 then
    raise exception 'token_limit: โปรเจกต์นี้มี token ที่ใช้งานอยู่ครบ 5 ตัวแล้ว ยกเลิกตัวเก่าก่อน';
  end if;
  v_token := 'hub_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.hub_agent_tokens (project_id, user_id, label, token_hash, token_hint)
  values (p_project_id, v_uid, v_label, sha256(convert_to(v_token, 'UTF8')), right(v_token, 4))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'hint', right(v_token, 4), 'label', v_label);
end $$;

create or replace function public.hub_revoke_agent_token(p_token_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated: ต้องล็อกอินก่อน' using errcode = '28000';
  end if;
  update public.hub_agent_tokens set revoked_at = now()
   where id = p_token_id and user_id = auth.uid() and revoked_at is null;
  if not found then
    raise exception 'token_not_found: ไม่พบ token นี้หรือถูกยกเลิกไปแล้ว';
  end if;
end $$;

-- =====================================================================
-- ฟังก์ชันของ AI (anon + authenticated) — ตรวจสิทธิ์ด้วย token ทุกครั้ง
-- =====================================================================

create or replace function public.hub_agent_get_project(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select * into v from hub_private.agent_auth(p_token);
  return jsonb_build_object(
    'today', (now() at time zone 'Asia/Bangkok')::date,
    'project', (select to_jsonb(p) - 'user_id' from public.hub_projects p where p.id = v.project_id),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'done', m.done, 'due_date', m.due_date)
                       order by m.sort_order, m.id)
      from public.hub_milestones m where m.project_id = v.project_id), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('date', u.date, 'version', u.version, 'note', u.note,
                                          'source', u.source, 'agent_label', u.agent_label)
                       order by u.date desc, u.created_at desc)
      from (select * from public.hub_updates where project_id = v.project_id
             order by date desc, created_at desc limit 10) u), '[]'::jsonb)
  );
end $$;

create or replace function public.hub_agent_add_update(
  p_token text, p_note text, p_version text default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_note text := btrim(p_note);
  v_version text := nullif(btrim(p_version), '');
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_date date;
  v_id uuid;
begin
  select * into v from hub_private.agent_auth(p_token);
  if v_note is null or char_length(v_note) not between 1 and 2000 then
    raise exception 'invalid_note: ข้อความอัปเดตต้องยาว 1–2000 ตัวอักษร';
  end if;
  if v_version is not null and char_length(v_version) > 30 then
    raise exception 'invalid_version: version ยาวเกิน 30 ตัวอักษร';
  end if;
  v_date := coalesce(p_date, v_today);
  if v_date > v_today then
    raise exception 'invalid_date: วันที่อัปเดตห้ามเป็นวันในอนาคต (วันนี้คือ %)', v_today;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v.token_id::text, 0));
  if (select count(*) from public.hub_updates
       where agent_token_id = v.token_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited: บันทึกอัปเดตได้ไม่เกิน 20 รายการต่อชั่วโมงต่อ token รอสักครู่แล้วลองใหม่';
  end if;
  insert into public.hub_updates (project_id, user_id, date, version, note, source, agent_label, agent_token_id)
  values (v.project_id, v.user_id, v_date, v_version, v_note, 'agent', v.label, v.token_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'date', v_date);
end $$;

create or replace function public.hub_agent_set_milestone(p_token text, p_milestone_id uuid, p_done boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select * into v from hub_private.agent_auth(p_token);
  if p_done is null then
    raise exception 'invalid_done: ต้องระบุ true หรือ false';
  end if;
  update public.hub_milestones set done = p_done
   where id = p_milestone_id and project_id = v.project_id;
  if not found then
    raise exception 'milestone_not_found: ไม่พบขั้นตอนนี้ในโปรเจกต์ของ token';
  end if;
  return jsonb_build_object('id', p_milestone_id, 'done', p_done);
end $$;

create or replace function public.hub_agent_add_milestone(p_token text, p_title text, p_due_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_title text := btrim(p_title);
  v_order int;
  v_id uuid;
begin
  select * into v from hub_private.agent_auth(p_token);
  if v_title is null or char_length(v_title) not between 1 and 200 then
    raise exception 'invalid_title: ชื่อขั้นตอนต้องยาว 1–200 ตัวอักษร';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v.project_id::text, 1));
  if (select count(*) from public.hub_milestones where project_id = v.project_id) >= 100 then
    raise exception 'milestone_limit: โปรเจกต์นี้มีขั้นตอนครบ 100 ขั้นแล้ว';
  end if;
  select coalesce(max(sort_order), 0) + 1 into v_order from public.hub_milestones where project_id = v.project_id;
  insert into public.hub_milestones (project_id, user_id, title, due_date, sort_order)
  values (v.project_id, v.user_id, v_title, p_due_date, v_order)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'title', v_title, 'sort_order', v_order);
end $$;

create or replace function public.hub_agent_update_project(p_token text, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v record;
  p public.hub_projects;
  k text;
  bad text[] := '{}';
  allowed constant text[] := array['status', 'tagline', 'tags', 'start_date', 'end_date', 'web_url', 'github_url', 'folder_path'];
  x jsonb;
  t jsonb;
  s text;
  new_tags text[];
begin
  select * into v from hub_private.agent_auth(p_token);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'invalid_changes: ต้องส่งฟิลด์ที่จะแก้เป็น JSON object อย่างน้อย 1 ฟิลด์ (แก้ได้เฉพาะ: %)', array_to_string(allowed, ', ');
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not (k = any(allowed)) then bad := bad || k; end if;
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'field_not_allowed: แก้ฟิลด์ % ไม่ได้ (แก้ได้เฉพาะ: %)', array_to_string(bad, ', '), array_to_string(allowed, ', ');
  end if;

  select * into p from public.hub_projects where id = v.project_id for update;

  if p_changes ? 'status' then
    x := p_changes -> 'status';
    if jsonb_typeof(x) <> 'string' or (x #>> '{}') not in ('idea', 'planning', 'active', 'paused', 'done') then
      raise exception 'invalid_status: status ต้องเป็น idea, planning, active, paused หรือ done';
    end if;
    p.status := x #>> '{}';
  end if;
  if p_changes ? 'tagline' then p.tagline := hub_private.text_field(p_changes -> 'tagline', 'tagline', 300); end if;
  if p_changes ? 'folder_path' then p.folder_path := hub_private.text_field(p_changes -> 'folder_path', 'folder_path', 300); end if;
  if p_changes ? 'web_url' then p.web_url := hub_private.url_field(p_changes -> 'web_url', 'web_url'); end if;
  if p_changes ? 'github_url' then p.github_url := hub_private.url_field(p_changes -> 'github_url', 'github_url'); end if;
  if p_changes ? 'start_date' then p.start_date := hub_private.date_field(p_changes -> 'start_date', 'start_date'); end if;
  if p_changes ? 'end_date' then p.end_date := hub_private.date_field(p_changes -> 'end_date', 'end_date'); end if;
  if p.start_date is not null and p.end_date is not null and p.end_date < p.start_date then
    raise exception 'invalid_date_range: วันสิ้นสุด (%) ต้องไม่ก่อนวันเริ่ม (%)', p.end_date, p.start_date;
  end if;

  if p_changes ? 'tags' then
    x := p_changes -> 'tags';
    if jsonb_typeof(x) = 'null' then
      p.tags := '{}';
    elsif jsonb_typeof(x) <> 'array' then
      raise exception 'invalid_tags: tags ต้องเป็น array ของข้อความ';
    else
      if jsonb_array_length(x) > 12 then
        raise exception 'invalid_tags: ใส่แท็กได้ไม่เกิน 12 แท็ก';
      end if;
      new_tags := '{}';
      for t in select * from jsonb_array_elements(x) loop
        if jsonb_typeof(t) <> 'string' then
          raise exception 'invalid_tags: แท็กแต่ละตัวต้องเป็นข้อความ';
        end if;
        s := btrim(t #>> '{}');
        if char_length(s) not between 1 and 30 then
          raise exception 'invalid_tags: แท็กต้องยาว 1–30 ตัวอักษร (พบ "%")', left(s, 40);
        end if;
        if not (s = any(new_tags)) then new_tags := new_tags || s; end if;
      end loop;
      p.tags := new_tags;
    end if;
  end if;

  update public.hub_projects
     set status = p.status, tagline = p.tagline, tags = p.tags,
         start_date = p.start_date, end_date = p.end_date,
         web_url = p.web_url, github_url = p.github_url, folder_path = p.folder_path
   where id = v.project_id;

  return (select to_jsonb(q) - 'user_id' from public.hub_projects q where q.id = v.project_id);
end $$;

-- =====================================================================
-- สิทธิ์: Supabase ให้ execute กับ anon อัตโนมัติ จึง revoke ทั้งหมดก่อนแล้ว grant ใหม่
-- =====================================================================
revoke all on all functions in schema hub_private from public, anon, authenticated;

revoke all on function public.hub_create_agent_token(uuid, text) from public, anon, authenticated;
revoke all on function public.hub_revoke_agent_token(uuid) from public, anon, authenticated;
revoke all on function public.hub_agent_get_project(text) from public, anon, authenticated;
revoke all on function public.hub_agent_add_update(text, text, text, date) from public, anon, authenticated;
revoke all on function public.hub_agent_set_milestone(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.hub_agent_add_milestone(text, text, date) from public, anon, authenticated;
revoke all on function public.hub_agent_update_project(text, jsonb) from public, anon, authenticated;

grant execute on function public.hub_create_agent_token(uuid, text) to authenticated;
grant execute on function public.hub_revoke_agent_token(uuid) to authenticated;
grant execute on function public.hub_agent_get_project(text) to anon, authenticated;
grant execute on function public.hub_agent_add_update(text, text, text, date) to anon, authenticated;
grant execute on function public.hub_agent_set_milestone(text, uuid, boolean) to anon, authenticated;
grant execute on function public.hub_agent_add_milestone(text, text, date) to anon, authenticated;
grant execute on function public.hub_agent_update_project(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
