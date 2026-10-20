import { esc, STATUS_LABEL, percent, shortThaiDate, daysLeft, isHttp, todayStr, scheduleInfo } from './util.js';

export function chipsHtml(counts, current) {
  const items = [['all', 'ทั้งหมด'], ['active', STATUS_LABEL.active], ['planning', STATUS_LABEL.planning],
    ['paused', STATUS_LABEL.paused], ['idea', STATUS_LABEL.idea], ['done', STATUS_LABEL.done]];
  return items
    .filter(([k]) => k === 'all' || counts[k] > 0)
    .map(([k, label]) => `<button type="button" class="chip" data-status="${k}" aria-pressed="${k === current}">${esc(label)} <b>${counts[k] || 0}</b></button>`)
    .join('');
}

export function dueHtml(list) {
  if (!list.length) return '';
  const rows = list.map((p) => {
    const d = daysLeft(p.end_date);
    const when = d === 0 ? 'วันนี้' : `อีก ${d} วัน`;
    return `<button type="button" class="due-item" data-open="${esc(p.id)}"><span>${esc(p.name)}</span><span class="mono">${when}</span></button>`;
  }).join('');
  return `<div class="due"><div class="due-title">⏰ ใกล้ครบกำหนดใน 3 สัปดาห์</div>${rows}</div>`;
}

export function skeletonHtml() {
  return Array.from({ length: 6 }, () => '<div class="card-p skel"><i></i><i></i><i></i><i></i></div>').join('');
}

function ind(label, value, isLink) {
  if (!value) return `<span class="ind off">${label}</span>`;
  if (isLink && isHttp(value)) return `<a class="ind on" href="${esc(value)}" target="_blank" rel="noopener noreferrer" title="${esc(value)}">${label}</a>`;
  return `<span class="ind on" title="${esc(value)}">${label}</span>`;
}

export function cardHtml(p, i) {
  const pct = percent(p);
  const range = p.start_date || p.end_date
    ? `${p.start_date ? shortThaiDate(p.start_date) : '…'} – ${p.end_date ? shortThaiDate(p.end_date) : '…'}`
    : '';
  const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `<article class="card-p" style="--i:${Math.min(i, 12)}" data-open="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}">
    <div class="card-top">
      <span class="status s-${esc(p.status)}">${p.status === 'active' ? '<i class="pulse"></i>' : ''}${esc(STATUS_LABEL[p.status] || p.status)}</span>
      <span class="muted mono">${esc(shortThaiDate(p.updated_at && new Date(p.updated_at)))}</span>
    </div>
    <h3>${esc(p.name)}</h3>
    ${p.tagline ? `<p class="desc">${esc(p.tagline)}</p>` : ''}
    ${tags ? `<div class="tags">${tags}</div>` : ''}
    <div class="bar"><i style="--w:${pct}%"></i></div>
    <div class="row muted small"><span class="mono">${pct}%</span><span>${p.milestones_done}/${p.milestones_total} ขั้นเสร็จแล้ว</span></div>
    ${p.last_update_note ? `<p class="note">${esc(p.last_update_note)}</p>` : ''}
    <div class="row small">
      <span class="muted mono">${esc(range)}</span>
      <span class="inds">${ind('WEB', p.web_url, true)}${ind('GIT', p.github_url, true)}${ind('DIR', p.folder_path, false)}</span>
    </div>
  </article>`;
}

function extraRow(l = { label: '', url: '' }, i) {
  return `<div class="extra" data-i="${i}">
    <input data-k="label" placeholder="ชื่อลิงก์" value="${esc(l.label)}" aria-label="ชื่อลิงก์">
    <input data-k="url" placeholder="https://..." value="${esc(l.url)}" aria-label="URL ลิงก์" inputmode="url">
    <button type="button" class="ghost icon" data-rm-extra aria-label="ลบแถว">✕</button>
    <div class="err" data-err="extra_${i}"></div>
  </div>`;
}

export function formHtml(p) {
  const v = p || {};
  const opts = Object.entries(STATUS_LABEL)
    .map(([k, l]) => `<option value="${k}" ${(v.status || 'idea') === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const extras = (v.extra_links || []).map((l, i) => extraRow(l, i)).join('');
  const field = (name, label, val, attrs = '') => `<label>${label}<input name="${name}" value="${esc(val ?? '')}" ${attrs}><div class="err" data-err="${name}"></div></label>`;
  return `<form id="pform" novalidate>
    <div class="modal-head"><h2>${p ? 'แก้ไขโปรเจกต์' : 'โปรเจกต์ใหม่'}</h2><button type="button" class="ghost icon" data-close aria-label="ปิด">✕</button></div>
    <div class="modal-body">
      ${field('name', 'ชื่อ *', v.name, 'required maxlength="120" autocomplete="off"')}
      ${field('tagline', 'คำอธิบาย', v.tagline, 'maxlength="300"')}
      <label>สถานะ<select name="status">${opts}</select></label>
      ${field('tags', 'แท็ก (คั่นด้วยจุลภาค)', (v.tags || []).join(', '))}
      <div class="grid2">
        ${field('start_date', 'วันเริ่ม', v.start_date, 'type="date"')}
        ${field('end_date', 'วันสิ้นสุด', v.end_date, 'type="date"')}
      </div>
      ${field('web_url', 'ลิงก์เว็บ', v.web_url, 'inputmode="url" placeholder="https://..."')}
      ${field('github_url', 'GitHub', v.github_url, 'inputmode="url" placeholder="https://github.com/..."')}
      ${field('folder_path', 'path โฟลเดอร์', v.folder_path)}
      <fieldset><legend>ลิงก์อื่นๆ</legend><div id="extras">${extras}</div>
        <button type="button" class="ghost" id="add-extra">+ เพิ่มลิงก์</button></fieldset>
    </div>
    <div class="modal-foot">
      ${p ? '<button type="button" class="danger" id="del">ลบ</button>' : '<span></span>'}
      <span class="foot-r"><button type="button" class="ghost" data-close>ยกเลิก</button><button type="submit" id="save">บันทึก</button></span>
    </div>
  </form>`;
}

export { extraRow };

// ---------- หน้ารายละเอียด ----------
export const RING_C = 2 * Math.PI * 40;

export function ringHtml(pct) {
  return `<div class="ring" role="img" aria-label="ความคืบหน้า ${pct}%"><svg viewBox="0 0 100 100" width="96" height="96" aria-hidden="true">
    <circle class="ring-bg" cx="50" cy="50" r="40"/><circle class="ring-fg" cx="50" cy="50" r="40" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>
    <span class="mono">${pct}%</span></div>`;
}

export function headHtml(p, pct) {
  const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `<div class="d-head">
    <div class="d-main">
      <span class="status s-${esc(p.status)}">${p.status === 'active' ? '<i class="pulse"></i>' : ''}${esc(STATUS_LABEL[p.status] || p.status)}</span>
      <h2>${esc(p.name)}</h2>
      ${p.tagline ? `<p class="desc">${esc(p.tagline)}</p>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      <div class="d-actions"><button type="button" data-d-edit>แก้ไข</button><button type="button" class="ghost" data-d-addupd>บันทึกอัปเดต</button></div>
    </div>${ringHtml(pct)}</div>`;
}

function linkRow(label, value, action) {
  const val = value ? `<span class="lv">${esc(value)}</span>` : '<em class="muted">ยังไม่ได้เพิ่ม</em>';
  const act = value ? action : '<button type="button" class="ghost sm" data-d-edit>+ เพิ่ม</button>';
  return `<div class="lrow"><span class="lk">${label}</span>${val}<span class="la">${act}</span></div>`;
}

const openBtn = (url) => (isHttp(url)
  ? `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">เปิด ↗</a>` : '');

export function linksHtml(p) {
  const extras = (p.extra_links || []).filter((l) => l && isHttp(l.url));
  const extraRows = extras.length
    ? extras.map((l) => `<div class="lrow"><span class="lk">ลิงก์อื่น</span><span class="lv">${esc(l.label || l.url)}</span><span class="la">${openBtn(l.url)}</span></div>`).join('')
    : linkRow('ลิงก์อื่นๆ', '', '');
  return `<h3>ลิงก์และที่เก็บไฟล์</h3>
    ${linkRow('เว็บไซต์', p.web_url, openBtn(p.web_url))}
    ${linkRow('GitHub', p.github_url, openBtn(p.github_url))}
    ${linkRow('โฟลเดอร์', p.folder_path, '<button type="button" class="ghost sm" data-d-copy>คัดลอก</button>').replace('class="lv"', 'class="lv mono" id="d-path"')}
    ${extraRows}`;
}

export function schedHtml(p) {
  const { day, left } = scheduleInfo(p);
  const cell = (k, v) => `<div><span class="muted small">${k}</span><b>${v}</b></div>`;
  return `<h3>กำหนดการ</h3><div class="sched">
    ${cell('วันเริ่ม', p.start_date ? esc(shortThaiDate(p.start_date)) : '–')}
    ${cell('วันสิ้นสุด', p.end_date ? esc(shortThaiDate(p.end_date)) : '–')}
    ${day ? cell('ตอนนี้', day) : ''}${left ? cell('สถานะเวลา', left) : ''}</div>`;
}

export function msHtml(ms) {
  if (ms === null) return '<h3>ขั้นตอน</h3><div class="skel-line"></div><div class="skel-line"></div>';
  const done = ms.filter((m) => m.done).length;
  const items = ms.map((m) => `<li class="ms${m.done ? ' done' : ''}" data-id="${esc(m.id)}">
    <button type="button" class="grip" aria-label="จัดลำดับ (ลากหรือกดลูกศรขึ้น/ลง)">⠿</button>
    <label class="chk"><input type="checkbox" class="ms-check" ${m.done ? 'checked' : ''} aria-label="เสร็จแล้ว"></label>
    <span class="m-title" tabindex="0" role="button" title="กดเพื่อแก้ชื่อ">${esc(m.title)}</span>
    <button type="button" class="ghost icon" data-ms-del aria-label="ลบขั้นตอน">✕</button></li>`).join('');
  return `<h3>ขั้นตอน <span class="muted mono small">${done}/${ms.length}</span></h3>
    ${ms.length ? `<ul class="ms-list">${items}</ul>` : '<p class="muted">ยังไม่มีขั้นตอน</p>'}
    <form id="ms-add" class="inline"><input name="title" maxlength="200" placeholder="เพิ่มขั้นตอนใหม่" aria-label="ชื่อขั้นตอนใหม่" autocomplete="off"><button>+ เพิ่ม</button></form>`;
}

export function upsHtml(ups, delId) {
  const list = ups === null ? '<div class="skel-line"></div>' : ups.length
    ? `<ol class="tl">${ups.map((u) => `<li><div class="tl-h"><span class="mono">${esc(shortThaiDate(u.date))}</span>
        ${u.version ? `<span class="tag">v${esc(u.version)}</span>` : ''}
        ${delId === u.id
    ? '<span class="confirm-inline">ลบรายการนี้? <button type="button" class="danger sm" data-up-yes>ลบ</button> <button type="button" class="ghost sm" data-up-no>ยกเลิก</button></span>'
    : `<button type="button" class="ghost icon" data-up-del="${esc(u.id)}" aria-label="ลบอัปเดต">✕</button>`}</div>
        <p>${esc(u.note)}</p></li>`).join('')}</ol>`
      : '<p class="muted">ยังไม่มีประวัติอัปเดต</p>';
  return `<h3>ประวัติอัปเดต</h3>
    <form id="up-add" class="upform">
      <div class="grid2"><label>วันที่<input type="date" name="date" value="${todayStr()}" required></label>
      <label>เวอร์ชัน<input name="version" maxlength="30" placeholder="เช่น 0.2"></label></div>
      <label>ข้อความ *<textarea name="note" rows="2" maxlength="1000" required></textarea></label>
      <div class="err" id="up-err"></div><button>บันทึกอัปเดต</button></form>${list}`;
}

export function confirmHtml(name) {
  return `<div class="modal-head"><h2>ลบโปรเจกต์?</h2></div>
    <div class="modal-body"><p>จะลบ <b>${esc(name)}</b> พร้อม milestones และบันทึกอัปเดตทั้งหมด ย้อนกลับไม่ได้</p></div>
    <div class="modal-foot"><button type="button" class="ghost" data-close>ยกเลิก</button><button type="button" class="danger" id="del-yes">ลบถาวร</button></div>`;
}

export function toast(msg) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
