// ส่วน "ผู้ช่วย AI" ในหน้ารายละเอียดโปรเจกต์: สร้าง/ยกเลิก agent token
// token จริงเก็บเฉพาะในตัวแปรหน่วยความจำนี้ (แสดงครั้งเดียว) ไม่เขียนลง storage/cache ใดๆ
import * as db from './db.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { esc, shortThaiDate, timeAgo } from './util.js';
import { toast } from './ui.js';
import { isOffline, onOfflineChange } from './net.js';
import { buildPrompt, DEFAULT_SCRIPT } from './agent-prompt.js';

const $ = (id) => document.getElementById(id);
const SCRIPT_KEY = 'hub.agent.script';
const LOCK = '#ag-form input, #ag-form button, [data-ag-revoke], [data-ag-revoke-yes]';

let proj = null;
let tokens = null; // null = กำลังโหลด | array | { error }
let reveal = null; // { token, label } เฉพาะตอนเพิ่งสร้าง
let revokeId = null;
let busy = false;
let setupMissing = false;
let loadSeq = 0;

const getScript = () => { try { return localStorage.getItem(SCRIPT_KEY) || ''; } catch (e) { return ''; } };
const saveScript = (v) => { try { localStorage.setItem(SCRIPT_KEY, v.trim()); } catch (e) { /* ไม่มี storage */ } };
const clean = (m) => String(m || '').replace(/^[a-z_]+:\s*/, '');
const isMissing = (e) => ['42P01', 'PGRST205', 'PGRST202', '42883'].includes(e && e.code) || /schema cache|does not exist/i.test((e && e.message) || '');

function envText(token) {
  return `HUB_URL=${SUPABASE_URL}\nHUB_KEY=${SUPABASE_KEY}\nHUB_TOKEN=${token}\n`;
}

// ---------- render ----------
function tokenItem(t) {
  const revoked = !!t.revoked_at;
  let act = '';
  if (revoked) act = '<span class="muted small">ยกเลิกแล้ว</span>';
  else if (revokeId === t.id) {
    act = `<span class="confirm-inline">ยกเลิก token นี้? AI ที่ใช้อยู่จะเข้าไม่ได้ทันที
      <button type="button" class="danger sm" data-ag-revoke-yes>ยืนยัน</button>
      <button type="button" class="ghost sm" data-ag-revoke-no>ไม่</button></span>`;
  } else act = `<button type="button" class="ghost sm" data-ag-revoke="${esc(t.id)}">ยกเลิก</button>`;
  const meta = revoked
    ? `สร้าง ${esc(shortThaiDate(t.created_at))} · ยกเลิกเมื่อ ${esc(shortThaiDate(t.revoked_at))}`
    : `สร้าง ${esc(shortThaiDate(t.created_at))} · ใช้ล่าสุด ${esc(timeAgo(t.last_used_at))}`;
  return `<li class="tk${revoked ? ' revoked' : ''}">
    <div class="tk-name"><b>${esc(t.label)}</b> <span class="mono muted">••••${esc(t.token_hint)}</span></div>
    <div class="tk-act">${act}</div><div class="tk-meta muted small">${meta}</div></li>`;
}

function revealHtml() {
  return `<div class="reveal" role="alert">
    <strong>⚠ token นี้จะแสดงครั้งเดียว</strong>
    <span class="small">คัดลอกเก็บไว้ตอนนี้ ปิดหน้านี้แล้วจะดูอีกไม่ได้ (ถ้าหายให้ยกเลิกแล้วสร้างใหม่)</span>
    <div class="token-box mono" id="ag-token">${esc(reveal.token)}</div>
    <div class="reveal-btns">
      <button type="button" data-ag-copy="env">คัดลอก .hub.env</button>
      <button type="button" data-ag-copy="prompt">คัดลอกคำสั่งตั้งค่าสำหรับ AI</button>
    </div>
    <button type="button" class="ghost sm" data-ag-done>เก็บแล้ว ซ่อน token</button>
  </div>`;
}

function html() {
  const script = getScript();
  let list;
  if (setupMissing) list = '<p class="muted">ยังไม่ได้เปิดใช้ในฐานข้อมูล — รัน <code>sql/002_agent_access.sql</code> ใน Supabase SQL Editor ก่อน</p>';
  else if (tokens === null) list = '<div class="skel-line"></div>';
  else if (tokens.error) list = `<p class="muted">โหลดรายการ token ไม่สำเร็จ: ${esc(tokens.error)}</p>`;
  else if (!tokens.length) list = '<p class="muted">ยังไม่มี token</p>';
  else list = `<ul class="tk-list">${tokens.map(tokenItem).join('')}</ul>`;
  return `<h3>ผู้ช่วย AI</h3>
    <p class="muted small">ให้ AI ใน repo ของโปรเจกต์นี้ (เช่น Claude Code) ดูและอัปเดตความคืบหน้าที่นี่ได้ แก้ได้เฉพาะโปรเจกต์นี้ ลบอะไรไม่ได้ และยกเลิกได้ทันที</p>
    <form id="ag-form" class="upform">
      <label>ชื่อ AI<input name="label" maxlength="60" required value="${esc('Claude Code · ' + proj.name)}" autocomplete="off"></label>
      <label>path ของ hub_agent.py ในเครื่องคุณ (ไม่บังคับ จำไว้ในเบราว์เซอร์นี้)
        <input name="script" id="ag-script" value="${esc(script)}" placeholder="${esc(DEFAULT_SCRIPT)}" autocomplete="off" spellcheck="false"></label>
      <div class="err" id="ag-err"></div>
      <button${setupMissing ? ' disabled' : ''}>สร้าง token</button>
    </form>
    ${reveal ? revealHtml() : ''}${list}`;
}

function lock() {
  if (isOffline()) document.querySelectorAll(LOCK.split(',').map((s) => '#d-agent ' + s.trim()).join(', ')).forEach((el) => { el.disabled = true; });
}

function render() {
  const box = $('d-agent');
  if (!proj) { box.innerHTML = ''; return; }
  box.innerHTML = html();
  lock();
}

// ---------- ข้อมูล ----------
async function loadTokens(quiet) {
  if (!proj || isOffline()) return;
  const id = proj.id;
  const seq = ++loadSeq;
  let data;
  try {
    data = await db.listAgentTokens(id);
  } catch (e) {
    if (seq !== loadSeq || !proj || proj.id !== id) return;
    if (isMissing(e)) setupMissing = true;
    else if (quiet) return;
    else tokens = { error: e.message };
    if (setupMissing) tokens = [];
    render();
    return;
  }
  if (seq !== loadSeq || !proj || proj.id !== id) return;
  setupMissing = false;
  if (quiet && JSON.stringify(data) === JSON.stringify(tokens)) return;
  tokens = data;
  render();
}

export function showAgent(p) {
  const same = proj && proj.id === p.id;
  proj = p;
  if (same) return;
  tokens = null; reveal = null; revokeId = null; busy = false; setupMissing = false;
  render();
  loadTokens(false);
}

export function hideAgent() {
  proj = null; tokens = null; reveal = null; revokeId = null; loadSeq++;
  const box = $('d-agent');
  if (box) box.innerHTML = '';
}

export function refreshAgent() { return loadTokens(true); }

// ---------- การกระทำ ----------
function blocked() {
  if (!isOffline()) return false;
  toast('ออฟไลน์ · แก้ไขไม่ได้');
  return true;
}

async function create(form) {
  if (blocked() || busy) return;
  const label = form.elements.label.value.trim();
  const err = $('ag-err');
  if (!label || label.length > 60) { err.textContent = 'ชื่อ AI ต้องยาว 1–60 ตัวอักษร'; form.elements.label.focus(); return; }
  err.textContent = '';
  saveScript(form.elements.script.value);
  busy = true;
  form.querySelector('button').disabled = true;
  try {
    const r = await db.createAgentToken(proj.id, label);
    reveal = { token: r.token, label: r.label };
    tokens = null;
    render();
    loadTokens(false);
    toast('สร้าง token แล้ว');
  } catch (e) {
    $('ag-err').textContent = clean(e.message);
    form.querySelector('button').disabled = false;
  } finally {
    busy = false;
  }
}

async function revoke() {
  if (blocked()) { revokeId = null; render(); return; }
  const id = revokeId;
  revokeId = null;
  try {
    await db.revokeAgentToken(id);
    toast('ยกเลิก token แล้ว');
  } catch (e) {
    toast('ยกเลิกไม่สำเร็จ: ' + clean(e.message));
  }
  await loadTokens(false);
}

async function copy(kind, btn) {
  const text = kind === 'env'
    ? envText(reveal.token)
    : buildPrompt({ name: proj.name, script: ($('ag-script') && $('ag-script').value) || getScript() });
  const orig = btn.textContent;
  let label = 'คัดลอกแล้ว ✓';
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // clipboard ใช้ไม่ได้: แสดงช่องข้อความให้เลือกคัดลอกเอง
    const ta = document.createElement('textarea');
    ta.className = 'fallback-copy';
    ta.readOnly = true;
    ta.rows = 6;
    ta.value = text;
    btn.closest('.reveal').appendChild(ta);
    ta.focus();
    ta.select();
    label = 'เลือกข้อความแล้ว กด Ctrl+C';
  }
  btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) btn.textContent = orig; }, 2000);
}

export function initAgent() {
  const box = $('d-agent');
  box.addEventListener('click', (e) => {
    const t = e.target;
    const c = t.closest('[data-ag-copy]');
    if (c && reveal) return copy(c.dataset.agCopy, c);
    if (t.closest('[data-ag-done]')) { reveal = null; return render(); }
    const r = t.closest('[data-ag-revoke]');
    if (r) { revokeId = r.dataset.agRevoke; return render(); }
    if (t.closest('[data-ag-revoke-no]')) { revokeId = null; return render(); }
    if (t.closest('[data-ag-revoke-yes]')) return revoke();
  });
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'ag-form') create(e.target);
  });
  box.addEventListener('change', (e) => {
    if (e.target.id === 'ag-script') saveScript(e.target.value);
  });
  onOfflineChange(() => { if (proj) render(); });
}
