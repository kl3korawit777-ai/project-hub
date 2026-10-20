import { configured, getSession, onAuthChange, signInWithEmail, signOut, listProjectOverview, createProject, updateProject, deleteProject } from './db.js';
import { STATUS_ORDER, thaiToday, daysLeft, makeSlug, validateProject } from './util.js';
import { chipsHtml, dueHtml, skeletonHtml, cardHtml, formHtml, extraRow, confirmHtml, toast } from './ui.js';

const $ = (id) => document.getElementById(id);
const state = { projects: [], status: 'all', q: '', loaded: false };
let lastFocus = null;

// ---------- auth / shell ----------
function showShell(session) {
  document.body.classList.toggle('authed', !!session);
  $('login').hidden = !!session;
  $('app').hidden = !session;
  $('logout').hidden = !session;
  $('cfg-warn').hidden = configured;
}

async function onSession(session) {
  showShell(session);
  if (session) await load();
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

// ---------- data / render ----------
async function load() {
  $('grid').innerHTML = skeletonHtml();
  try {
    state.projects = await listProjectOverview();
    state.loaded = true;
    render();
  } catch (e) {
    $('grid').innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ: ${e.message.replace(/[<>&]/g, '')}</div>`;
  }
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
  if (el) openForm(state.projects.find((p) => p.id === el.dataset.open));
}
$('grid').addEventListener('click', openFromEvent);
$('due').addEventListener('click', openFromEvent);
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

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

// ---------- start ----------
$('today').textContent = thaiToday();
if (configured) {
  onAuthChange(onSession);
  await onSession(await getSession());
} else {
  showShell(null);
}
