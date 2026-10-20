import { listProjectLinks } from './db.js';
import { esc, isHttp } from './util.js';

const $ = (id) => document.getElementById(id);
const collator = new Intl.Collator('th');
let rows = null; // null = ยังไม่เคยโหลด
let q = '';
let token = 0;

const linkOf = (p) => (isHttp(p.web_url || '') ? p.web_url : null);

// ไฮไลต์คำที่ตรงด้วย <mark> (escape ทุกส่วน)
function hl(text, term) {
  if (!term) return esc(text);
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const j = lower.indexOf(t, i);
    if (j < 0) { out += esc(text.slice(i)); break; }
    out += esc(text.slice(i, j)) + '<mark>' + esc(text.slice(j, j + t.length)) + '</mark>';
    i = j + t.length;
  }
  return out;
}

function visible() {
  const term = q.trim().toLowerCase();
  return rows
    .filter((p) => !term || p.name.toLowerCase().includes(term) || (linkOf(p) || '').toLowerCase().includes(term))
    .sort((a, b) => (!!linkOf(b) - !!linkOf(a)) || collator.compare(a.name, b.name));
}

function render() {
  const list = $('llist');
  $('lclear').hidden = !q;
  if (rows === null) {
    list.innerHTML = '<li class="skel-line"></li><li class="skel-line"></li><li class="skel-line"></li>';
    return;
  }
  const term = q.trim();
  const items = visible();
  if (!items.length) {
    list.innerHTML = `<li class="empty">${rows.length ? `ไม่พบโปรเจกต์หรือลิงก์ที่ตรงกับ “${esc(term)}”` : 'ยังไม่มีโปรเจกต์'}</li>`;
    return;
  }
  let firstMarked = false;
  list.innerHTML = items.map((p) => {
    const url = linkOf(p);
    if (!url) {
      return `<li class="l-row none"><span class="l-name">${hl(p.name, term)}</span><span class="l-none">ยังไม่ได้ใส่ลิงก์</span></li>`;
    }
    const first = term && !firstMarked;
    firstMarked = firstMarked || !!first;
    return `<li><a class="l-row" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      <span class="l-name">${hl(p.name, term)}</span><span class="l-url mono">${hl(url, term)}</span>
      <span class="l-arrow" aria-hidden="true">↗</span>${first ? '<kbd class="l-enter" aria-hidden="true">Enter ↵</kbd>' : ''}</a></li>`;
  }).join('');
}

function openFirst() {
  if (rows === null) return;
  const first = visible().find(linkOf);
  if (first) window.open(linkOf(first), '_blank', 'noopener,noreferrer');
}

export function initLinks() {
  const input = $('lq');
  input.addEventListener('input', () => { q = input.value; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); openFirst(); }
  });
  $('lclear').addEventListener('click', () => {
    q = '';
    input.value = '';
    render();
    input.focus();
  });
}

export async function showLinks() {
  render();
  // บนเดสก์ท็อป focus ช่องค้นหาทันที (มือถือไม่ focus เพื่อไม่ให้คีย์บอร์ดเด้ง)
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) $('lq').focus({ preventScroll: true });
  const t = ++token;
  try {
    const data = await listProjectLinks();
    if (t !== token) return;
    rows = data;
    render();
  } catch (e) {
    if (t !== token) return;
    $('llist').innerHTML = `<li class="empty">โหลดไม่สำเร็จ: ${esc(e.message)}</li>`;
  }
}
