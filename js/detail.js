import * as db from './db.js';
import { percent } from './util.js';
import { headHtml, linksHtml, schedHtml, msHtml, upsHtml, toast, RING_C } from './ui.js';
import { isOffline, onOfflineChange } from './net.js';
import { saveDetail, loadDetail } from './cache.js';
import { initAgent, showAgent, hideAgent, refreshAgent } from './agent.js';

// ออฟไลน์ = อ่านอย่างเดียว: ปิดปุ่ม/ช่องแก้ไขทั้งหมดในหน้านี้
const LOCK = '[data-d-edit],[data-d-addupd],.ms-check,.grip,[data-ms-del],[data-up-del],#ms-add input,#ms-add button,#up-add input,#up-add textarea,#up-add button';
const lock = () => {
  if (isOffline()) document.querySelectorAll('#detail ' + LOCK.split(',').join(', #detail ')).forEach((el) => { el.disabled = true; });
};
function blocked() {
  if (!isOffline()) return false;
  toast('ออฟไลน์ · แก้ไขไม่ได้');
  return true;
}

const $ = (id) => document.getElementById(id);
let ctx = null;
let cur = null;
let ms = null; // null = กำลังโหลด
let ups = null;
let delUp = null;
let token = 0;
let returnFocus = null;
let closeTimer = null;

const loaded = () => ms !== null;
const curPct = () => (loaded()
  ? (ms.length ? Math.round((ms.filter((m) => m.done).length / ms.length) * 100) : 0)
  : percent(cur));

// ---------- render ----------
function setRing(animate = true) {
  const ring = document.querySelector('#d-head .ring');
  if (!ring) return;
  const pct = curPct();
  ring.querySelector('span').textContent = pct + '%';
  ring.setAttribute('aria-label', `ความคืบหน้า ${pct}%`);
  const set = () => { ring.querySelector('.ring-fg').style.strokeDashoffset = RING_C * (1 - pct / 100); };
  if (animate) { ring.getBoundingClientRect(); setTimeout(set, 30); } else set();
}
function renderHead(animate = true) { $('d-head').innerHTML = headHtml(cur, curPct()); setRing(animate); lock(); }
function renderLinks() { $('d-links').innerHTML = linksHtml(cur); lock(); }
function renderSched() { $('d-sched').innerHTML = schedHtml(cur); }
function renderMs() { $('d-ms').innerHTML = msHtml(ms); lock(); }
function renderUps() { $('d-ups').innerHTML = upsHtml(ups, delUp); lock(); }
function renderAll() { renderHead(); renderLinks(); renderSched(); renderMs(); renderUps(); }

onOfflineChange(() => { if (cur) renderAll(); });

function sync() {
  if (!cur || !loaded()) return;
  saveDetail(cur.id, ms, ups || []);
  const last = ups && ups[0];
  ctx.sync(cur.id, {
    milestones_total: ms.length,
    milestones_done: ms.filter((m) => m.done).length,
    last_update_date: last ? last.date : null,
    last_update_note: last ? last.note : null,
    last_update_source: last ? last.source || 'owner' : null,
    last_update_agent: last ? last.agent_label || null : null,
    updated_at: new Date().toISOString(),
  });
}

// ---------- เปิด/ปิด ----------
export function isOpen() { return !!cur; }

export async function showDetail(p) {
  const same = cur && cur.id === p.id;
  cur = p;
  const panel = $('detail');
  if (same) { renderHead(false); renderLinks(); renderSched(); showAgent(p); return; }

  clearTimeout(closeTimer);
  ms = null; ups = null; delUp = null;
  const t = ++token;
  if (panel.hidden) returnFocus = document.activeElement;
  renderAll();
  showAgent(p);
  panel.hidden = false;
  panel.scrollTop = 0;
  document.body.classList.add('has-detail');
  panel.getBoundingClientRect(); // บังคับ reflow ให้ transition เริ่มจากตำแหน่งซ่อน
  panel.classList.add('open');
  $('d-back').focus({ preventScroll: true });

  try {
    const [a, b] = await Promise.all([db.listMilestones(p.id), db.listUpdates(p.id)]);
    if (t !== token) return;
    ms = a; ups = b;
    saveDetail(p.id, ms, ups);
    renderMs(); renderUps(); setRing();
  } catch (e) {
    if (t !== token) return;
    const cached = loadDetail(p.id); // ออฟไลน์: ใช้ข้อมูลที่เก็บไว้ตอนเปิดดูครั้งก่อน
    ms = cached ? cached.ms : [];
    ups = cached ? cached.ups : [];
    renderMs(); renderUps(); setRing();
    if (!cached) toast('ยังไม่มีข้อมูลรายละเอียดที่เก็บไว้ในเครื่อง');
  }
}

export function hideDetail() {
  if (!cur && $('detail').hidden) return;
  cur = null; ms = null; ups = null; token++;
  hideAgent(); // ล้าง token ที่เพิ่งสร้างออกจากหน้าจอและหน่วยความจำ
  const panel = $('detail');
  panel.classList.remove('open');
  document.body.classList.remove('has-detail');
  closeTimer = setTimeout(() => { panel.hidden = true; }, 280);
  if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
}

// กำลังพิมพ์/ลากอยู่ในหน้านี้หรือไม่ (ห้ามรีเฟรชทับ)
function busyEditing() {
  const el = document.activeElement;
  const typing = el && $('detail').contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox';
  return !!typing || !!document.querySelector('#detail .ms.dragging');
}

// ดึงขั้นตอน/ประวัติอัปเดต/token ใหม่แบบเงียบๆ (เรียกตอนกลับมาที่แท็บ เพื่อเห็นสิ่งที่ AI เพิ่งแก้)
export async function refreshDetail() {
  if (!cur || !loaded() || isOffline()) return;
  const id = cur.id;
  const t = token;
  try {
    const [a, b] = await Promise.all([db.listMilestones(id), db.listUpdates(id)]);
    if (t !== token || !cur || cur.id !== id || busyEditing()) return;
    if (JSON.stringify(a) !== JSON.stringify(ms) || JSON.stringify(b) !== JSON.stringify(ups)) {
      ms = a; ups = b;
      saveDetail(id, ms, ups);
      renderMs(); renderUps(); setRing(false);
    }
    refreshAgent();
  } catch (e) { /* เงียบ: ลองใหม่ครั้งหน้า */ }
}

// ---------- milestones ----------
async function toggle(id) {
  const m = ms.find((x) => x.id === id);
  if (!m) return;
  if (blocked()) { renderMs(); return; }
  m.done = !m.done;
  renderMs(); setRing(); sync();
  try {
    await db.updateMilestone(id, { done: m.done });
  } catch (e) {
    m.done = !m.done;
    renderMs(); setRing(); sync();
    toast('บันทึกไม่สำเร็จ ย้อนกลับแล้ว');
  }
}

function editTitle(span) {
  if (blocked()) return;
  const m =ms.find((x) => x.id === span.closest('.ms').dataset.id);
  const inp = document.createElement('input');
  inp.className = 'm-edit';
  inp.value = m.title;
  inp.maxLength = 200;
  inp.setAttribute('aria-label', 'แก้ชื่อขั้นตอน');
  span.replaceWith(inp);
  inp.focus();
  inp.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const v = inp.value.trim();
    if (!save || !v || v === m.title) { renderMs(); return; }
    const old = m.title;
    m.title = v;
    renderMs();
    try {
      await db.updateMilestone(m.id, { title: v });
      sync();
    } catch (e) {
      m.title = old;
      renderMs();
      toast('บันทึกไม่สำเร็จ ย้อนกลับแล้ว');
    }
  };
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
}

async function removeMilestone(id) {
  if (blocked()) return;
  const idx = ms.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const [m] = ms.splice(idx, 1);
  renderMs(); setRing(); sync();
  try {
    await db.deleteMilestone(id);
  } catch (e) {
    ms.splice(idx, 0, m);
    renderMs(); setRing(); sync();
    toast('ลบไม่สำเร็จ ย้อนกลับแล้ว');
  }
}

async function addMilestone(form) {
  if (blocked()) return;
  const title = form.elements.title.value.trim();
  if (!title) { form.elements.title.focus(); return; }
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const order = ms.reduce((mx, m) => Math.max(mx, m.sort_order || 0), 0) + 1;
    const row = await db.addMilestone({ project_id: cur.id, title, sort_order: order });
    ms.push(row);
    renderMs(); setRing(); sync();
    $('ms-add').elements.title.focus();
  } catch (e) {
    btn.disabled = false;
    toast('เพิ่มไม่สำเร็จ: ' + e.message);
  }
}

async function applyOrder(ids, focusId) {
  if (blocked()) return;
  const before = ms.map((m) => ({ id: m.id, sort_order: m.sort_order }));
  const byId = new Map(ms.map((m) => [m.id, m]));
  ms = ids.map((id) => byId.get(id));
  ms.forEach((m, i) => { m.sort_order = i + 1; });
  renderMs();
  if (focusId) document.querySelector(`.ms[data-id="${CSS.escape(focusId)}"] .grip`)?.focus();
  const changed = ms.filter((m, i) => before.find((b) => b.id === m.id).sort_order !== i + 1)
    .map((m) => ({ id: m.id, sort_order: m.sort_order }));
  if (!changed.length) return;
  try {
    await db.saveMilestoneOrder(changed);
    sync();
  } catch (e) {
    const prev = new Map(before.map((b) => [b.id, b.sort_order]));
    ms.forEach((m) => { m.sort_order = prev.get(m.id); });
    ms.sort((a, b) => a.sort_order - b.sort_order);
    renderMs();
    toast('บันทึกลำดับไม่สำเร็จ ย้อนกลับแล้ว');
  }
}

function startDrag(ev, grip) {
  if (ev.button > 0) return;
  ev.preventDefault();
  const li = grip.closest('.ms');
  const list = li.parentElement;
  grip.setPointerCapture(ev.pointerId);
  li.classList.add('dragging');
  const move = (e) => {
    let before = null;
    for (const s of list.children) {
      if (s === li) continue;
      const r = s.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { before = s; break; }
    }
    if (before !== li.nextElementSibling) list.insertBefore(li, before);
  };
  const end = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    li.classList.remove('dragging');
    applyOrder([...list.children].map((x) => x.dataset.id), li.dataset.id);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// ---------- updates ----------
async function addUpdate(form) {
  if (blocked()) return;
  const note = form.elements.note.value.trim();
  const date = form.elements.date.value;
  const err = $('up-err');
  if (!note) { err.textContent = 'กรุณากรอกข้อความ'; form.elements.note.focus(); return; }
  if (!date) { err.textContent = 'กรุณาเลือกวันที่'; return; }
  err.textContent = '';
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const row = await db.addUpdate({ project_id: cur.id, date, version: form.elements.version.value.trim() || null, note });
    ups.unshift(row);
    ups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    renderUps(); sync();
    toast('เพิ่มอัปเดตแล้ว');
  } catch (e) {
    btn.disabled = false;
    toast('เพิ่มไม่สำเร็จ: ' + e.message);
  }
}

async function removeUpdate() {
  if (blocked()) { delUp = null; renderUps(); return; }
  const id = delUp;
  delUp = null;
  try {
    await db.deleteUpdate(id);
    ups = ups.filter((u) => u.id !== id);
    renderUps(); sync();
    toast('ลบแล้ว');
  } catch (e) {
    renderUps();
    toast('ลบไม่สำเร็จ: ' + e.message);
  }
}

// ---------- คัดลอก path ----------
async function copyPath(btn) {
  const el = $('d-path');
  const text = cur.folder_path || '';
  let label = 'คัดลอกแล้ว ✓';
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    label = 'เลือกข้อความแล้ว';
  }
  btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) btn.textContent = 'คัดลอก'; }, 2000);
}

// ---------- events ----------
export function initDetail(c) {
  ctx = c;
  initAgent();
  const panel = $('detail');

  panel.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#d-back')) return ctx.close();
    if (t.closest('[data-d-edit]')) return ctx.edit(cur);
    if (t.closest('[data-d-addupd]')) {
      const f = $('up-add');
      if (f) { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); f.elements.note.focus({ preventScroll: true }); }
      return;
    }
    if (t.closest('[data-d-copy]')) return copyPath(t.closest('[data-d-copy]'));
    if (t.closest('[data-ms-del]')) return removeMilestone(t.closest('.ms').dataset.id);
    const title = t.closest('.m-title');
    if (title) return editTitle(title);
    const del = t.closest('[data-up-del]');
    if (del) { delUp = del.dataset.upDel; return renderUps(); }
    if (t.closest('[data-up-no]')) { delUp = null; return renderUps(); }
    if (t.closest('[data-up-yes]')) return removeUpdate();
  });

  panel.addEventListener('change', (e) => {
    if (e.target.matches('.ms-check')) toggle(e.target.closest('.ms').dataset.id);
  });

  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'ms-add') addMilestone(e.target);
    if (e.target.id === 'up-add') addUpdate(e.target);
  });

  panel.addEventListener('keydown', (e) => {
    if (e.target.matches('.m-title') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editTitle(e.target); }
    if (e.target.matches('.grip') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const ids = ms.map((m) => m.id);
      const id = e.target.closest('.ms').dataset.id;
      const i = ids.indexOf(id);
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      applyOrder(ids, id);
    }
  });

  panel.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.grip');
    if (grip) startDrag(e, grip);
  });
}
