import { configured, getSession, onAuthChange, signInWithEmail, signOut, listProjectOverview, createProject, updateProject, deleteProject } from './db.js';
import { STATUS_ORDER, thaiToday, daysLeft, makeSlug, validateProject } from './util.js';
import { chipsHtml, dueHtml, skeletonHtml, cardHtml, formHtml, extraRow, confirmHtml, toast } from './ui.js';
import { initDetail, showDetail, hideDetail, isOpen, refreshDetail } from './detail.js';
import { ganttHtml } from './gantt.js';
import { initLinks, showLinks } from './links.js';
import { loadProjects, saveProjects, clearCache, formatAt } from './cache.js';
import { isOffline, setOffline, onOfflineChange } from './net.js';
import { initPwa } from './pwa.js';

// ---------- ไทม์ไลน์ ----------
function ganttCollapsed() {
  try { return localStorage.getItem(GANTT_KEY) === '1'; } catch (e) { return false; }
}

function renderGantt() {
  const box = $('gantt');
  const scroller = box.querySelector('.g-scroll');
  const left = scroller ? scroller.scrollLeft : 0;
  const html = ganttHtml(state.shown, { selectedId: state.selectedId, collapsed: ganttCollapsed(), animate: state.ganttAnim });
  box.innerHTML = html;
  if (html) state.ganttAnim = false;
  const next = box.querySelector('.g-scroll');
  if (!next) return;
  const line = next.querySelector('.g-tl');
  if (left) {
    next.scrollLeft = left;
  } else if (state.ganttAnim === false && line && !box.dataset.centered) {
    // แสดงครั้งแรก: เลื่อนให้เส้น "วันนี้" อยู่กลางกล่อง
    const dx = line.getBoundingClientRect().left - next.getBoundingClientRect().left + next.scrollLeft;
    next.scrollLeft = Math.max(0, dx - next.clientWidth / 2);
    box.dataset.centered = '1';
  }
}

function markSelected(id) {
  state.selectedId = id;
  document.querySelectorAll('#gantt .g-row[data-id]').forEach((r) => r.classList.toggle('sel', r.dataset.id === id));
}

const $ = (id) => document.getElementById(id);
const state = { projects: [], status: 'all', q: '', loaded: false, shown: [], selectedId: null, ganttAnim: true };
const GANTT_KEY = 'hub.gantt.collapsed';
let lastFocus = null;

// ---------- auth / shell ----------
function showShell(session) {
  document.body.classList.toggle('authed', !!session);
  state.authed = !!session;
  $('login').hidden = !!session;
  $('app').hidden = !session;
  $('linksview').hidden = !session;
  $('logout').hidden = !session;
  $('cfg-warn').hidden = configured;
  if (!session) {
    state.projects = [];
    state.loaded = false;
    state.ganttAnim = true;
    state.view = null;
    document.body.classList.remove('view-links');
    setOffline(false);
    hideDetail();
  }
}

// ---------- ออฟไลน์ ----------
const OFFLINE_SESSION = { user: { email: 'ออฟไลน์' } };

function updateOfflineUi() {
  const off = isOffline();
  $('offline-bar').hidden = !off;
  if (off) {
    const c = loadProjects();
    $('offline-text').textContent = `ออฟไลน์ · ข้อมูลเมื่อ ${c ? formatAt(c.at) : '—'}`;
  }
  $('new').disabled = off;
  document.body.classList.toggle('offline', off);
}
onOfflineChange(updateOfflineUi);

async function retryOnline() {
  if (!configured) return;
  let s = null;
  try { s = await getSession(); } catch (e) { /* ยังออฟไลน์ */ }
  await onSession(s);
}
$('offline-retry').addEventListener('click', retryOnline);
window.addEventListener('online', retryOnline);
window.addEventListener('offline', () => { if (state.authed) setOffline(true); });

// ---------- routing (#p=<slug|id>) ----------
let navigated = false;

function route() {
  if (!state.authed) return;
  const links = location.hash === '#links';
  document.body.classList.toggle('view-links', links);
  $('nav-home').setAttribute('aria-current', links ? 'false' : 'page');
  $('nav-links').setAttribute('aria-current', links ? 'page' : 'false');
  if (links) {
    navigated = false;
    markSelected(null);
    hideDetail();
    if (state.view !== 'links') showLinks();
    state.view = 'links';
    return;
  }
  state.view = 'home';
  const m = /^#p=(.+)$/.exec(location.hash);
  if (!m) { navigated = false; markSelected(null); hideDetail(); return; }
  if (!state.loaded) return;
  let key = m[1];
  try { key = decodeURIComponent(key); } catch (e) { /* ใช้ค่าเดิม */ }
  const p = state.projects.find((x) => x.slug === key) || state.projects.find((x) => x.id === key);
  if (p) {
    markSelected(p.id);
    showDetail(p);
  } else {
    navigated = false;
    markSelected(null);
    history.replaceState(null, '', location.pathname + location.search);
    hideDetail();
  }
}

function openDetail(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  navigated = true;
  location.hash = '#p=' + encodeURIComponent(p.slug);
}

function closeDetail() {
  if (navigated) {
    navigated = false;
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    route();
  }
}

window.addEventListener('hashchange', route);

async function onSession(session) {
  // ออฟไลน์และไม่มี session ที่ใช้ได้: เปิดดูข้อมูลที่เก็บไว้ในเครื่องแบบอ่านอย่างเดียว
  if (!session && !navigator.onLine && loadProjects()) session = OFFLINE_SESSION;
  if (!session) clearCache();
  showShell(session);
  if (session) {
    route(); // เปิด #links ได้ทันทีโดยไม่ต้องรอโหลดภาพรวม
    await load();
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
$('logout').addEventListener('click', async () => {
  clearCache();
  try { await signOut(); } catch (e) { await onSession(null); }
});

// ---------- data / render ----------
async function load(quiet = false) {
  if (!quiet) $('grid').innerHTML = skeletonHtml();
  try {
    state.projects = await listProjectOverview();
    saveProjects(state.projects);
    setOffline(false);
  } catch (e) {
    const cached = loadProjects();
    if (!cached) {
      if (quiet) return;
      $('grid').innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ: ${e.message.replace(/[<>&]/g, '')}</div>`;
      return;
    }
    state.projects = cached.data; // ข้อมูลชุดล่าสุดที่เก็บไว้ (อ่านอย่างเดียว)
    setOffline(true);
  }
  state.loaded = true;
  render();
  route();
}

function matches(p, q) {
  if (!q) return true;
  const hay = [p.name, p.tagline, ...(p.tags || [])].join(' ').toLowerCase();
  return hay.includes(q);
}

function render() {
  const q = state.q.trim().toLowerCase();
  const searched = state.projects.filter((p) => matches(p, q));
  const counts = { all: searched.length };
  for (const p of searched) counts[p.status] = (counts[p.status] || 0) + 1;
  if (state.status !== 'all' && !counts[state.status]) state.status = 'all';

  const shown = searched
    .filter((p) => state.status === 'all' || p.status === state.status)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || new Date(b.updated_at) - new Date(a.updated_at));

  state.shown = shown;
  renderGantt();
  $('count').textContent = `${state.projects.length} โปรเจกต์`;
  $('chips').innerHTML = chipsHtml(counts, state.status);

  const due = state.projects
    .filter((p) => p.status !== 'done' && p.end_date)
    .filter((p) => { const d = daysLeft(p.end_date); return d >= 0 && d <= 21; })
    .sort((a, b) => daysLeft(a.end_date) - daysLeft(b.end_date));
  $('due').innerHTML = dueHtml(due);

  $('grid').innerHTML = shown.length
    ? shown.map(cardHtml).join('')
    : `<div class="empty">${state.projects.length ? 'ไม่พบโปรเจกต์ที่ตรงกับการค้นหา' : 'ยังไม่มีโปรเจกต์ กด “+ โปรเจกต์ใหม่” เพื่อเริ่ม'}</div>`;
}

$('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (b) { state.status = b.dataset.status; render(); }
});

function openFromEvent(e) {
  if (e.target.closest('a')) return;
  const el = e.target.closest('[data-open]');
  if (el) openDetail(el.dataset.open);
}
$('grid').addEventListener('click', openFromEvent);
$('due').addEventListener('click', openFromEvent);
$('gantt').addEventListener('click', (e) => {
  if (e.target.closest('[data-g-toggle]')) {
    const next = !ganttCollapsed();
    try { localStorage.setItem(GANTT_KEY, next ? '1' : '0'); } catch (err) { /* ไม่มี storage */ }
    state.ganttAnim = !next;
    renderGantt();
    return;
  }
  openFromEvent(e);
});
$('grid').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) { e.preventDefault(); openFromEvent(e); }
});
$('new').addEventListener('click', () => openForm(null));

// ---------- modal ----------
const modal = $('modal');
const sheet = $('sheet');

function openModal(html) {
  lastFocus = document.activeElement;
  sheet.innerHTML = html;
  modal.hidden = false;
  document.body.classList.add('lock');
  const first = sheet.querySelector('input,button');
  if (first) first.focus();
}
function closeModal() {
  modal.hidden = true;
  sheet.innerHTML = '';
  document.body.classList.remove('lock');
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!modal.hidden) closeModal();
  else if (isOpen()) closeDetail();
});

initDetail({
  edit: (p) => openForm(p),
  close: closeDetail,
  // อัปเดตข้อมูลการ์ดในหน้ารวมจากหน้ารายละเอียด โดยไม่โหลดใหม่
  sync: (id, patch) => {
    const p = state.projects.find((x) => x.id === id);
    if (p) { Object.assign(p, patch); render(); }
  },
});

function readForm(form) {
  const g = (n) => form.elements[n].value;
  const extra_links = [...form.querySelectorAll('.extra')].map((r) => ({
    label: r.querySelector('[data-k=label]').value,
    url: r.querySelector('[data-k=url]').value,
  }));
  return {
    name: g('name'), tagline: g('tagline'), status: g('status'), tags: g('tags'),
    start_date: g('start_date'), end_date: g('end_date'), web_url: g('web_url'),
    github_url: g('github_url'), folder_path: g('folder_path'), extra_links,
  };
}

function showErrors(form, errors) {
  form.querySelectorAll('[data-err]').forEach((el) => { el.textContent = errors[el.dataset.err] || ''; });
  const first = Object.keys(errors)[0];
  if (first) {
    const el = form.elements[first] || form.querySelector(`[data-err="${first}"]`);
    if (el && el.focus) el.focus();
  }
}

function openForm(project) {
  if (isOffline()) { toast('ออฟไลน์ · แก้ไขไม่ได้'); return; }
  openModal(formHtml(project));
  const form = $('pform');
  const extras = $('extras');

  $('add-extra').addEventListener('click', () => {
    extras.insertAdjacentHTML('beforeend', extraRow(undefined, extras.children.length));
    extras.lastElementChild.querySelector('input').focus();
  });
  extras.addEventListener('click', (e) => {
    if (e.target.closest('[data-rm-extra]')) {
      e.target.closest('.extra').remove();
      [...extras.children].forEach((r, i) => { r.dataset.i = i; r.querySelector('[data-err]').dataset.err = 'extra_' + i; });
    }
  });

  if (project) {
    $('del').addEventListener('click', () => {
      sheet.innerHTML = confirmHtml(project.name);
      $('del-yes').addEventListener('click', async () => {
        $('del-yes').disabled = true;
        try {
          await deleteProject(project.id);
          closeModal();
          toast('ลบแล้ว');
          await load();
        } catch (e) {
          $('del-yes').disabled = false;
          toast('ลบไม่สำเร็จ: ' + e.message);
        }
      });
    });
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { errors, data } = validateProject(readForm(form));
    showErrors(form, errors);
    if (Object.keys(errors).length) return;
    const btn = $('save');
    btn.disabled = true;
    try {
      if (project) {
        await updateProject(project.id, data);
      } else {
        const base = makeSlug(data.name);
        const taken = new Set(state.projects.map((p) => p.slug));
        let slug = base;
        for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
        await createProject({ ...data, slug });
      }
      closeModal();
      toast('บันทึกแล้ว');
      await load();
    } catch (e) {
      btn.disabled = false;
      toast('บันทึกไม่สำเร็จ: ' + e.message);
    }
  });
}

initLinks();

// กลับมาที่แท็บ: ดึงข้อมูลใหม่ เพื่อให้เห็นสิ่งที่ AI เพิ่งอัปเดต (ข้ามถ้ากำลังเปิดฟอร์มหรือพิมพ์อยู่)
let lastRefresh = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !state.authed || isOffline()) return;
  if (Date.now() - lastRefresh < 15000) return;
  if (!modal.hidden) return;
  lastRefresh = Date.now();
  await load(true);
  if (state.view === 'links') showLinks();
  await refreshDetail();
});

// ---------- start ----------
$('today').textContent = thaiToday();
initPwa({
  onUpdate: (apply) => {
    $('update-bar').hidden = false;
    $('update-btn').onclick = apply;
  },
});

if (configured) {
  onAuthChange(onSession);
  let session = null;
  try { session = await getSession(); } catch (e) { /* ออฟไลน์: ให้ onSession ตัดสินจากข้อมูลที่เก็บไว้ */ }
  await onSession(session);
} else {
  showShell(null);
}
