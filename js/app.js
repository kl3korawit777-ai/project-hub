import { configured, getSession, onAuthChange, signInWithEmail, signOut, listProjectOverview } from './db.js';

const $ = (id) => document.getElementById(id);
const STATUS = { idea: 'ไอเดีย', planning: 'วางแผน', active: 'กำลังทำ', paused: 'พัก', done: 'เสร็จ' };
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function setCheck(id, ok, text) {
  const el = $(id);
  el.className = 'check ' + (ok ? 'ok' : 'bad');
  el.textContent = (ok ? '✓ ' : '✗ ') + text;
}

async function render(session) {
  $('login').hidden = !!session;
  $('logout').hidden = !session;
  setCheck('c1', configured, configured ? 'เชื่อมต่อ Supabase ได้ (ตั้งค่า config แล้ว)' : 'ยังไม่ได้ตั้งค่า js/config.js');
  setCheck('c2', !!session, session ? 'ล็อกอินแล้ว: ' + session.user.email : 'ยังไม่ได้ล็อกอิน');
  const list = $('list');
  list.innerHTML = '';
  if (!session) {
    setCheck('c3', false, 'อ่านตารางไม่ได้ (ต้องล็อกอินก่อน)');
    return;
  }
  try {
    const rows = await listProjectOverview();
    setCheck('c3', true, `อ่านตารางได้ (${rows.length} โปรเจกต์)`);
    list.innerHTML = rows.map((p) => {
      const pct = p.milestones_total ? Math.round((p.milestones_done / p.milestones_total) * 100) : 0;
      const note = p.last_update_note ? ' · ' + esc(p.last_update_note) : '';
      return `<div class="proj">
        <div class="row"><strong>${esc(p.name)}</strong><span class="tag">${esc(STATUS[p.status] || p.status)}</span></div>
        <div class="muted">${esc(p.tagline)}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="muted mono">${pct}% · ${p.milestones_done}/${p.milestones_total}${note}</div>
      </div>`;
    }).join('') || '<p class="muted">ยังไม่มีโปรเจกต์ (รัน sql/seed.sql)</p>';
  } catch (e) {
    setCheck('c3', false, 'อ่านตารางไม่ได้: ' + e.message);
  }
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('msg');
  try {
    await signInWithEmail($('email').value.trim());
    msg.textContent = 'ส่งลิงก์ล็อกอินไปที่อีเมลแล้ว เปิดลิงก์บนเครื่องนี้';
  } catch (e) {
    msg.textContent = 'ผิดพลาด: ' + e.message;
  }
});
$('logout').addEventListener('click', () => signOut());

if (configured) {
  onAuthChange(render);
  render(await getSession());
} else {
  render(null);
}
