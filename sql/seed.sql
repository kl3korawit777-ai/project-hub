-- Project Hub · seed (รันซ้ำได้) — แก้ v_email ให้ตรงกับอีเมลที่ล็อกอิน
do $$
declare
  v_email text := 'kl3korawit777@gmail.com';
  v_uid uuid;
  v_pid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'ไม่พบผู้ใช้อีเมล % — ล็อกอินที่หน้าเว็บก่อน หรือแก้ v_email ให้ตรง', v_email;
  end if;

  insert into public.hub_projects (user_id, slug, name, tagline, status, tags)
  values (v_uid, 'project-hub', 'Project Hub', 'เว็บรวมทุกโปรเจกต์ของฉัน', 'active', array['web','supabase'])
  on conflict (user_id, slug) do nothing;

  select id into v_pid from public.hub_projects where user_id = v_uid and slug = 'project-hub';

  if not exists (select 1 from public.hub_milestones where project_id = v_pid) then
    insert into public.hub_milestones (project_id, user_id, title, done, sort_order) values
      (v_pid, v_uid, 'ตั้งฐานข้อมูลและล็อกอิน', true, 1),
      (v_pid, v_uid, 'หน้ารายการโปรเจกต์', false, 2),
      (v_pid, v_uid, 'หน้ารายละเอียด/แก้ไข', false, 3);
  end if;

  if not exists (select 1 from public.hub_updates where project_id = v_pid) then
    insert into public.hub_updates (project_id, user_id, version, note)
    values (v_pid, v_uid, '0.1', 'เริ่มต้นโปรเจกต์ เฟส 0');
  end if;
end $$;
