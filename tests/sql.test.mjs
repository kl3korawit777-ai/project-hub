// ทดสอบ sql/schema.sql + sql/002_agent_access.sql บน Postgres จริง (embedded-postgres)
// จำลอง Supabase: schema auth, auth.uid() จาก request.jwt.claim.sub, role anon/authenticated
// รัน: cd tests && npm i && node sql.test.mjs
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, '../sql/schema.sql'), 'utf8');
const AGENT = readFileSync(process.env.AGENT_SQL || join(here, '../sql/002_agent_access.sql'), 'utf8');

const SHIM = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
-- เหมือน Supabase: วัตถุใหม่ใน public ให้สิทธิ์ anon/authenticated อัตโนมัติ
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

const dir = mkdtempSync(join(tmpdir(), 'hubpg-'));
const pgsrv = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: 54329, persistent: false });
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); }
};

await pgsrv.initialise();
await pgsrv.start();
await pgsrv.createDatabase('hub');
await pgsrv.createDatabase('hub_empty');
const c = pgsrv.getPgClient('hub');
await c.connect();
const ce = pgsrv.getPgClient('hub_empty');
await ce.connect();

// รันเป็น role/ผู้ใช้ที่กำหนด
async function as(role, uid, sql, params) {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
  if (role !== 'postgres') await c.query(`set role ${role}`);
  try { return await c.query(sql, params); } finally { await c.query('reset role'); }
}
async function err(promise) {
  try { await promise; return null; } catch (e) { return e; }
}
const expectErr = async (name, promise, { code, msg } = {}) => {
  const e = await err(promise);
  const good = !!e && (!code || e.code === code) && (!msg || String(e.message).includes(msg));
  ok(name, good, e ? `[${e.code}] ${e.message}` : 'ไม่มี error');
  return e;
};

try {
  // ---------- รันซ้ำได้ทุกลำดับ ----------
  await c.query(SHIM);
  await ce.query(SHIM);
  const e0 = await err(ce.query(AGENT));
  ok('002 ก่อน schema.sql บน DB ว่าง: ขึ้นข้อความให้รัน schema.sql ก่อน', !!e0 && e0.message.includes('schema.sql'), e0 && e0.message);

  const seq = [['schema', SCHEMA], ['002', AGENT], ['schema', SCHEMA], ['002', AGENT], ['002', AGENT], ['schema', SCHEMA], ['schema', SCHEMA]];
  for (const [n, sql] of seq) {
    const e = await err(c.query(sql));
    ok(`รัน ${n} ซ้ำ ไม่พัง`, e === null, e && e.message);
  }
  const cols = (await c.query("select column_name from information_schema.columns where table_schema='public' and table_name='hub_project_overview'")).rows.map((r) => r.column_name);
  ok('view ยังมี last_update_source/agent หลังรัน schema.sql ซ้ำ', cols.includes('last_update_source') && cols.includes('last_update_agent'), cols.join(','));

  // ---------- ข้อมูลตั้งต้น ----------
  const A = randomUUID();
  const B = randomUUID();
  await c.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [A, 'a@x.com', B, 'b@x.com']);
  const mkProj = async (uid, slug) => (await c.query(
    "insert into public.hub_projects(user_id,slug,name) values ($1,$2,$3) returning id", [uid, slug, 'โปรเจกต์ ' + slug])).rows[0].id;
  const pA = await mkProj(A, 'a1');
  const pA2 = await mkProj(A, 'a2');
  const pB = await mkProj(B, 'b1');
  const mk = async (proj, uid, title, n) => (await c.query(
    'insert into public.hub_milestones(project_id,user_id,title,sort_order) values ($1,$2,$3,$4) returning id', [proj, uid, title, n])).rows[0].id;
  const mA = await mk(pA, A, 'ขั้น A1', 1);
  const mA2 = await mk(pA2, A, 'ขั้นของ A2', 1);
  await mk(pB, B, 'ขั้นของ B', 1);

  // ---------- สร้าง/ยกเลิก token ----------
  await expectErr('ผู้ใช้อื่น (B) สร้าง token ให้โปรเจกต์ของ A ไม่ได้',
    as('authenticated', B, 'select public.hub_create_agent_token($1,$2)', [pA, 'x']), { msg: 'project_not_found' });
  await expectErr('anon เรียก hub_create_agent_token ไม่ได้ (สิทธิ์)',
    as('anon', null, 'select public.hub_create_agent_token($1,$2)', [pA, 'x']), { code: '42501' });
  await expectErr('ไม่มีผู้ใช้ (uid ว่าง) แม้เป็น authenticated ก็สร้างไม่ได้',
    as('authenticated', null, 'select public.hub_create_agent_token($1,$2)', [pA, 'x']), { code: '28000' });
  await expectErr('ชื่อ AI ว่างไม่ได้',
    as('authenticated', A, 'select public.hub_create_agent_token($1,$2)', [pA, '   ']), { msg: 'invalid_label' });
  await expectErr('ชื่อ AI เกิน 60 ตัวไม่ได้',
    as('authenticated', A, 'select public.hub_create_agent_token($1,$2)', [pA, 'x'.repeat(61)]), { msg: 'invalid_label' });

  const create = async (proj, label) => (await as('authenticated', A, 'select public.hub_create_agent_token($1,$2) as r', [proj, label])).rows[0].r;
  const t1 = await create(pA, 'Claude Code · A1');
  ok('token รูปแบบ hub_ + 64 hex และ hint = 4 ตัวท้าย', /^hub_[0-9a-f]{64}$/.test(t1.token) && t1.hint === t1.token.slice(-4), t1.token);
  const t2 = await create(pA2, 'Claude Code · A2');

  const hashRow = (await c.query('select encode(token_hash,$1) h from public.hub_agent_tokens where id=$2', ['hex', t1.id])).rows[0].h;
  const { createHash } = await import('node:crypto');
  ok('ฐานข้อมูลเก็บ sha256 ของ token', hashRow === createHash('sha256').update(t1.token).digest('hex'));

  // token จริงต้องไม่อยู่ในฐานข้อมูล
  let leaked = false;
  const tables = (await c.query("select table_schema, table_name from information_schema.tables where table_schema in ('public','hub_private','auth') and table_type='BASE TABLE'")).rows;
  for (const t of tables) {
    const dump = (await c.query(`select coalesce(string_agg(row_to_json(x)::text, ' '), '') s from ${t.table_schema}."${t.table_name}" x`)).rows[0].s;
    if (dump.includes(t1.token) || dump.includes(t2.token)) leaked = true;
  }
  ok('token จริงไม่ปรากฏในข้อมูลของตารางใดเลย', !leaked);

  // ---------- สิทธิ์การอ่านตาราง token / hub_private ----------
  await expectErr('anon อ่าน hub_agent_tokens ไม่ได้',
    as('anon', null, 'select id from public.hub_agent_tokens'), { code: '42501' });
  await expectErr('เจ้าของอ่าน token_hash ไม่ได้',
    as('authenticated', A, 'select token_hash from public.hub_agent_tokens'), { code: '42501' });
  await expectErr('เจ้าของ select * ไม่ได้ (ต้องระบุคอลัมน์)',
    as('authenticated', A, 'select * from public.hub_agent_tokens'), { code: '42501' });
  const own = await as('authenticated', A, 'select id,label,token_hint,created_at,last_used_at,revoked_at from public.hub_agent_tokens');
  ok('เจ้าของเห็น token ของตัวเอง 2 ตัว', own.rows.length === 2);
  const other = await as('authenticated', B, 'select id from public.hub_agent_tokens');
  ok('ผู้ใช้อื่นไม่เห็น token ของ A (RLS)', other.rows.length === 0);
  await expectErr('เจ้าของ insert เข้า hub_agent_tokens ตรงๆ ไม่ได้',
    as('authenticated', A, "insert into public.hub_agent_tokens(project_id,label,token_hash,token_hint) values ($1,'x','\\x00','abcd')", [pA]), { code: '42501' });
  await expectErr('เจ้าของ update hub_agent_tokens ตรงๆ ไม่ได้',
    as('authenticated', A, 'update public.hub_agent_tokens set revoked_at = null'), { code: '42501' });
  await expectErr('เจ้าของ delete hub_agent_tokens ตรงๆ ไม่ได้',
    as('authenticated', A, 'delete from public.hub_agent_tokens'), { code: '42501' });
  await expectErr('anon เรียก hub_private.agent_auth ไม่ได้',
    as('anon', null, 'select * from hub_private.agent_auth($1)', [t1.token]), { code: '42501' });
  await expectErr('authenticated เรียก hub_private.agent_auth ไม่ได้',
    as('authenticated', A, 'select * from hub_private.agent_auth($1)', [t1.token]), { code: '42501' });
  await expectErr('anon อ่านตาราง hub_projects ตรงๆ ไม่ได้',
    as('anon', null, 'select * from public.hub_projects'), { code: '42501' });
  await expectErr('anon อ่าน view overview ไม่ได้',
    as('anon', null, 'select * from public.hub_project_overview'), { code: '42501' });

  const fn = (await c.query(`select p.proname,
      has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname like 'hub\\_%'`)).rows;
  const g = (n) => fn.find((r) => r.proname === n);
  ok('สิทธิ์ execute: ฟังก์ชันเจ้าของ anon=false authenticated=true',
    ['hub_create_agent_token', 'hub_revoke_agent_token'].every((n) => g(n) && !g(n).anon_x && g(n).auth_x));
  ok('สิทธิ์ execute: ฟังก์ชัน AI anon=true authenticated=true',
    ['hub_agent_get_project', 'hub_agent_add_update', 'hub_agent_set_milestone', 'hub_agent_add_milestone', 'hub_agent_update_project']
      .every((n) => g(n) && g(n).anon_x && g(n).auth_x));
  const priv = (await c.query(`select count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='hub_private' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`)).rows[0].n;
  ok('ฟังก์ชันใน hub_private ไม่มีใครนอกจากเจ้าของ execute ได้', Number(priv) === 0, priv);

  // ---------- token ผิด -> 28000 ----------
  const anon = (sql, params) => as('anon', null, sql, params);
  const get = (tok) => anon('select public.hub_agent_get_project($1) as r', [tok]);
  await expectErr('token ผิดรูปแบบ -> 28000', get('abc'), { code: '28000', msg: 'invalid_token' });
  await expectErr('token null -> 28000', get(null), { code: '28000' });
  await expectErr('token ตัวพิมพ์ใหญ่ (ผิดรูปแบบ) -> 28000', get(t1.token.toUpperCase()), { code: '28000' });
  await expectErr('token รูปแบบถูกแต่ไม่มีอยู่จริง -> 28000', get('hub_' + '0'.repeat(64)), { code: '28000' });

  // ---------- ดูข้อมูลโปรเจกต์ ----------
  const info = (await get(t1.token)).rows[0].r;
  ok('get_project: ได้โปรเจกต์ของ token (ไม่มี user_id) + milestones + today',
    info.project.id === pA && !('user_id' in info.project) && info.milestones.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(info.today) && Array.isArray(info.updates));

  // ---------- last_used_at ----------
  const lu1 = (await c.query('select last_used_at from public.hub_agent_tokens where id=$1', [t1.id])).rows[0].last_used_at;
  ok('last_used_at ถูกอัปเดตเมื่อใช้', lu1 !== null);
  await get(t1.token);
  const lu2 = (await c.query('select last_used_at from public.hub_agent_tokens where id=$1', [t1.id])).rows[0].last_used_at;
  ok('last_used_at ไม่อัปเดตถี่เกินนาทีละครั้ง', +lu1 === +lu2);
  await c.query("update public.hub_agent_tokens set last_used_at = now() - interval '2 minutes' where id=$1", [t1.id]);
  await get(t1.token);
  const lu3 = (await c.query('select last_used_at from public.hub_agent_tokens where id=$1', [t1.id])).rows[0].last_used_at;
  ok('last_used_at อัปเดตอีกครั้งหลังเกิน 1 นาที', +lu3 > +lu1 - 1);

  // ---------- milestones ----------
  const setM = (tok, id, done) => anon('select public.hub_agent_set_milestone($1,$2,$3) as r', [tok, id, done]);
  await expectErr('ติ๊ก milestone ของโปรเจกต์อื่น (ด้วย token ของ A1) ไม่ได้', setM(t1.token, mA2, true), { msg: 'milestone_not_found' });
  ok('milestone ของโปรเจกต์อื่นไม่ถูกแก้', (await c.query('select done from public.hub_milestones where id=$1', [mA2])).rows[0].done === false);
  await setM(t1.token, mA, true);
  ok('ติ๊ก milestone ของตัวเองได้', (await c.query('select done from public.hub_milestones where id=$1', [mA])).rows[0].done === true);
  await setM(t1.token, mA, false);
  ok('ยกเลิกติ๊กได้', (await c.query('select done from public.hub_milestones where id=$1', [mA])).rows[0].done === false);
  await expectErr('done เป็น null ไม่ได้', setM(t1.token, mA, null), { msg: 'invalid_done' });

  const addM = (tok, title, due) => anon('select public.hub_agent_add_milestone($1,$2,$3) as r', [tok, title, due || null]);
  const m1 = (await addM(t1.token, '  ขั้นใหม่  ', '2026-12-31')).rows[0].r;
  ok('add_milestone ต่อท้าย sort_order และ trim ชื่อ', m1.sort_order === 2 && m1.title === 'ขั้นใหม่');
  await expectErr('add_milestone ชื่อว่างไม่ได้', addM(t1.token, '  '), { msg: 'invalid_title' });
  await expectErr('add_milestone ชื่อเกิน 200 ไม่ได้', addM(t1.token, 'x'.repeat(201)), { msg: 'invalid_title' });
  for (let i = 0; i < 98; i++) await addM(t2.token, 'ขั้น ' + i); // A2 มี 1 อยู่แล้ว -> 99
  await addM(t2.token, 'ขั้นที่ 100');
  await expectErr('add_milestone ขั้นที่ 101 ไม่ได้', addM(t2.token, 'เกิน'), { msg: 'milestone_limit' });

  // ---------- แก้ฟิลด์โปรเจกต์ ----------
  const upd = (tok, ch) => anon('select public.hub_agent_update_project($1,$2::jsonb) as r', [tok, JSON.stringify(ch)]);
  const before = (await c.query('select name, user_id, updated_at from public.hub_projects where id=$1', [pA])).rows[0];
  const e1 = await expectErr('แก้ name ไม่ได้', upd(t1.token, { name: 'ชื่อใหม่' }), { msg: 'field_not_allowed' });
  ok('ข้อความ field_not_allowed บอกว่าแก้ฟิลด์ไหนได้', e1 && e1.message.includes('tagline') && e1.message.includes('name'));
  await expectErr('แก้ user_id ไม่ได้', upd(t1.token, { user_id: B }), { msg: 'field_not_allowed' });
  await expectErr('แก้ id/slug ไม่ได้', upd(t1.token, { slug: 'hack', id: pB }), { msg: 'field_not_allowed' });
  await expectErr('ส่ง {} ไม่ได้', upd(t1.token, {}), { msg: 'invalid_changes' });
  await expectErr('URL javascript: ไม่ผ่าน', upd(t1.token, { web_url: 'javascript:alert(1)' }), { msg: 'invalid_url' });
  await expectErr('URL ที่ไม่มี // ไม่ผ่าน', upd(t1.token, { github_url: 'http:example.com' }), { msg: 'invalid_url' });
  await expectErr('URL มีช่องว่างไม่ผ่าน', upd(t1.token, { web_url: 'https://a b.com' }), { msg: 'invalid_url' });
  await expectErr('status ผิดไม่ผ่าน', upd(t1.token, { status: 'hacked' }), { msg: 'invalid_status' });
  await expectErr('วันที่รูปแบบผิดไม่ผ่าน', upd(t1.token, { start_date: '20/10/2026' }), { msg: 'invalid_date' });
  await expectErr('วันที่ไม่มีอยู่จริง (30 ก.พ.) ไม่ผ่าน', upd(t1.token, { start_date: '2026-02-30' }), { msg: 'invalid_date' });
  await expectErr('วันจบก่อนวันเริ่มไม่ผ่าน', upd(t1.token, { start_date: '2026-10-10', end_date: '2026-10-01' }), { msg: 'invalid_date_range' });
  await expectErr('tags เกิน 12 ตัวไม่ผ่าน', upd(t1.token, { tags: Array.from({ length: 13 }, (_, i) => 't' + i) }), { msg: 'invalid_tags' });
  await expectErr('tag ยาวเกิน 30 ตัวไม่ผ่าน', upd(t1.token, { tags: ['x'.repeat(31)] }), { msg: 'invalid_tags' });
  await expectErr('tags ไม่ใช่ array ไม่ผ่าน', upd(t1.token, { tags: 'a,b' }), { msg: 'invalid_tags' });
  await expectErr('tagline ไม่ใช่ข้อความไม่ผ่าน', upd(t1.token, { tagline: 123 }), { msg: 'invalid_value' });
  await expectErr('tagline เกิน 300 ไม่ผ่าน', upd(t1.token, { tagline: 'x'.repeat(301) }), { msg: 'invalid_value' });
  const afterBad = (await c.query('select * from public.hub_projects where id=$1', [pA])).rows[0];
  ok('คำขอที่ผิดไม่ทำให้ข้อมูลเปลี่ยนเลย', afterBad.name === before.name && afterBad.status === 'idea' && afterBad.web_url === null && +afterBad.updated_at === +before.updated_at);

  const good = (await upd(t1.token, {
    status: 'active', tagline: ' สรุปสั้นๆ ', tags: ['ai', ' web ', 'ai'], start_date: '2026-10-01', end_date: '2026-12-31',
    web_url: 'https://example.com/app', github_url: 'https://github.com/x/y', folder_path: 'C:/work/x',
  })).rows[0].r;
  ok('แก้ฟิลด์ที่อนุญาตได้ครบ (trim, dedupe tags)', good.status === 'active' && good.tagline === 'สรุปสั้นๆ' && JSON.stringify(good.tags) === '["ai","web"]'
    && good.start_date === '2026-10-01' && good.web_url === 'https://example.com/app' && !('user_id' in good));
  const afterGood = (await c.query('select name, user_id, updated_at from public.hub_projects where id=$1', [pA])).rows[0];
  ok('name/user_id ไม่เปลี่ยน และ updated_at เลื่อน', afterGood.name === before.name && afterGood.user_id === before.user_id && +afterGood.updated_at > +before.updated_at);
  const cleared = (await upd(t1.token, { web_url: null, tags: [], tagline: '' })).rows[0].r;
  ok('ล้างค่าด้วย null / "" / [] ได้', cleared.web_url === null && cleared.tagline === null && cleared.tags.length === 0);
  await expectErr('แก้วันเริ่มให้เลยวันจบเดิมไม่ผ่าน', upd(t1.token, { start_date: '2027-06-01' }), { msg: 'invalid_date_range' });
  ok('โปรเจกต์ของ B ไม่ถูกแตะ', (await c.query('select status from public.hub_projects where id=$1', [pB])).rows[0].status === 'idea');

  // ---------- บันทึกอัปเดต ----------
  const addU = (tok, note, version, date) => anon('select public.hub_agent_add_update($1,$2,$3,$4) as r', [tok, note, version || null, date || null]);
  const bkk = (await c.query("select (now() at time zone 'Asia/Bangkok')::date::text d")).rows[0].d;
  const u1 = (await addU(t1.token, 'ทำหน้าล็อกอินเสร็จ', 'v0.1')).rows[0].r;
  ok('add_update: วันที่ default = วันนี้ตามเวลา Asia/Bangkok', u1.date === bkk, `${u1.date} vs ${bkk}`);
  const row = (await c.query('select * from public.hub_updates where id=$1', [u1.id])).rows[0];
  ok('add_update: source=agent, agent_label, agent_token_id, user_id เป็นของเจ้าของ',
    row.source === 'agent' && row.agent_label === 'Claude Code · A1' && row.agent_token_id === t1.id && row.user_id === A && row.version === 'v0.1');
  await expectErr('add_update วันในอนาคตไม่ได้', addU(t1.token, 'x', null, '2099-01-01'), { msg: 'invalid_date' });
  await expectErr('add_update ข้อความว่างไม่ได้', addU(t1.token, '   '), { msg: 'invalid_note' });
  await expectErr('add_update ข้อความเกิน 2000 ไม่ได้', addU(t1.token, 'x'.repeat(2001)), { msg: 'invalid_note' });
  await expectErr('add_update version เกิน 30 ไม่ได้', addU(t1.token, 'x', 'v'.repeat(31)), { msg: 'invalid_version' });
  await addU(t1.token, 'ข้อความยาว 2000 ได้', null, '2026-01-01').then(() => ok('add_update ข้อความ 2000 ตัว + วันที่ย้อนหลังได้', true));
  // นับรวมแล้ว 2 รายการ: เพิ่มอีก 18 -> 20 ผ่าน, รายการที่ 21 ต้องโดนปฏิเสธ
  for (let i = 0; i < 18; i++) await addU(t1.token, 'รายการ ' + i);
  await expectErr('รายการที่ 21 ในชั่วโมงเดียวกันถูกปฏิเสธ (rate_limited)', addU(t1.token, 'เกิน'), { msg: 'rate_limited' });
  ok('นับรวม 20 รายการต่อ token', Number((await c.query('select count(*) n from public.hub_updates where agent_token_id=$1', [t1.id])).rows[0].n) === 20);
  await addU(t2.token, 'token อื่นยังเขียนได้').then(() => ok('rate limit แยกตาม token', true));
  await c.query("update public.hub_updates set created_at = now() - interval '2 hours' where agent_token_id=$1", [t1.id]);
  await addU(t1.token, 'หลังผ่านไป 1 ชั่วโมง').then(() => ok('rate limit รีเซ็ตเมื่อพ้น 1 ชั่วโมง', true));

  const ov = (await as('authenticated', A, 'select last_update_source, last_update_agent, last_update_note from public.hub_project_overview where id=$1', [pA])).rows[0];
  ok('view overview แสดงว่าอัปเดตล่าสุดมาจาก AI', ov.last_update_source === 'agent' && ov.last_update_agent === 'Claude Code · A1');
  const proj = (await as('authenticated', A, 'select updated_at from public.hub_projects where id=$1', [pA])).rows[0];
  ok('มี updated_at ของโปรเจกต์เลื่อนตามเมื่อ AI เพิ่มอัปเดต', proj.updated_at !== null);

  // ---------- AI ไม่มีทางลบ ----------
  const names = (await c.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hub\\_agent\\_%'")).rows.map((r) => r.proname).sort();
  ok('ฟังก์ชัน AI มีแค่ 5 ตัว ไม่มีฟังก์ชันลบ/เปลี่ยนชื่อ', JSON.stringify(names) === JSON.stringify(['hub_agent_add_milestone', 'hub_agent_add_update', 'hub_agent_get_project', 'hub_agent_set_milestone', 'hub_agent_update_project']), names.join(','));

  // ---------- ยกเลิก token ----------
  await expectErr('anon ยกเลิก token ไม่ได้', as('anon', null, 'select public.hub_revoke_agent_token($1)', [t1.id]), { code: '42501' });
  await expectErr('ผู้ใช้อื่นยกเลิก token ของ A ไม่ได้', as('authenticated', B, 'select public.hub_revoke_agent_token($1)', [t1.id]), { msg: 'token_not_found' });
  await as('authenticated', A, 'select public.hub_revoke_agent_token($1)', [t1.id]);
  await expectErr('token ที่ถูกยกเลิกแล้วใช้ไม่ได้ทันที (28000)', get(t1.token), { code: '28000' });
  await expectErr('token ที่ถูกยกเลิกแล้ว: add_update ไม่ได้', addU(t1.token, 'x'), { code: '28000' });
  await expectErr('ยกเลิกซ้ำไม่ได้', as('authenticated', A, 'select public.hub_revoke_agent_token($1)', [t1.id]), { msg: 'token_not_found' });
  ok('token อื่นของโปรเจกต์อื่นยังใช้ได้', (await get(t2.token)).rows[0].r.project.id === pA2);

  // เพดาน 5 token ที่ใช้งานอยู่ต่อโปรเจกต์ (ตัวที่ยกเลิกแล้วไม่นับ)
  for (let i = 0; i < 5; i++) await create(pA, 'ตัวที่ ' + i);
  await expectErr('token ที่ใช้งานอยู่ตัวที่ 6 ของโปรเจกต์ไม่ได้', as('authenticated', A, 'select public.hub_create_agent_token($1,$2)', [pA, 'เกิน']), { msg: 'token_limit' });

  // ---------- ลบโปรเจกต์ -> token ถูกลบตาม ----------
  await c.query('delete from public.hub_projects where id=$1', [pA2]);
  ok('ลบโปรเจกต์แล้ว token ถูกลบตาม (cascade)', Number((await c.query('select count(*) n from public.hub_agent_tokens where project_id=$1', [pA2])).rows[0].n) === 0);
  await expectErr('token ของโปรเจกต์ที่ถูกลบใช้ไม่ได้', get(t2.token), { code: '28000' });

  // ---------- หลังรันซ้ำอีกรอบ สิทธิ์ต้องเหมือนเดิม ----------
  for (const [n, sql] of [['002', AGENT], ['schema', SCHEMA], ['002', AGENT]]) {
    const e = await err(c.query(sql));
    ok(`รัน ${n} ซ้ำหลังมีข้อมูล ไม่พัง`, e === null, e && e.message);
  }
  await expectErr('หลังรันซ้ำ: anon ยังเรียก hub_create_agent_token ไม่ได้', as('anon', null, 'select public.hub_create_agent_token($1,$2)', [pB, 'x']), { code: '42501' });
  await expectErr('หลังรันซ้ำ: anon ยังอ่าน hub_agent_tokens ไม่ได้', as('anon', null, 'select id from public.hub_agent_tokens'), { code: '42501' });
  const still = (await as('authenticated', A, 'select count(*) n from public.hub_project_overview')).rows[0].n;
  ok('หลังรันซ้ำ: view overview ยังอ่านได้และข้อมูลยังอยู่', Number(still) === 1, still);
} catch (e) {
  fail++;
  console.log('ERROR', e);
} finally {
  await c.end().catch(() => {});
  await ce.end().catch(() => {});
  await pgsrv.stop().catch(() => {});
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ข้าม */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
