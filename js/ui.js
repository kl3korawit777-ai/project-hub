import { esc, STATUS_LABEL, percent, shortThaiDate, daysLeft } from './util.js';

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
  if (isLink) return `<a class="ind on" href="${esc(value)}" target="_blank" rel="noopener noreferrer" title="${esc(value)}">${label}</a>`;
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
