export const STATUS_LABEL = {
  active: 'กำลังพัฒนา',
  planning: 'วางแผน',
  paused: 'พักไว้',
  idea: 'ไอเดีย',
  done: 'เสร็จแล้ว',
};
export const STATUS_ORDER = ['active', 'planning', 'paused', 'idea', 'done'];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function thaiToday() {
  return new Date().toLocaleDateString('th-TH-u-ca-buddhist', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// 'YYYY-MM-DD' -> Date เวลาท้องถิ่น
export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shortThaiDate(s) {
  const d = s instanceof Date ? s : parseDate(s);
  if (!d || isNaN(d)) return '';
  return d.toLocaleDateString('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function daysLeft(endDate) {
  const end = parseDate(endDate);
  if (!end) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end - today) / 86400000);
}

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dayDiff = (a, b) => Math.round((b - a) / 86400000);

// ข้อความกำหนดการ: { day, left }
export function scheduleInfo(p) {
  const start = parseDate(p.start_date);
  const end = parseDate(p.end_date);
  const today = parseDate(todayStr());
  let day = null;
  let left = null;
  if (p.status === 'done') {
    if (start) {
      const e = end || parseDate(todayStr(new Date(p.updated_at)));
      left = `ใช้เวลา ${Math.max(1, dayDiff(start, e) + 1)} วัน`;
    }
    return { day, left };
  }
  if (start && today >= start) day = `วันที่ ${dayDiff(start, today) + 1}`;
  if (end) {
    const d = dayDiff(today, end);
    left = d >= 0 ? `เหลือ ${d} วัน` : `เลย ${-d} วัน`;
  }
  return { day, left };
}

export const percent =(p) => (p.milestones_total ? Math.round((p.milestones_done / p.milestones_total) * 100) : 0);

export const isHttp = (s) => /^https?:\/\/\S+$/i.test(s);

export function makeSlug(name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'p-' + Math.random().toString(36).slice(2, 8);
}

// คืน { errors: {field: msg}, data }
export function validateProject(f) {
  const errors = {};
  const data = {
    name: f.name.trim(),
    tagline: f.tagline.trim() || null,
    status: f.status,
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    start_date: f.start_date || null,
    end_date: f.end_date || null,
    web_url: f.web_url.trim() || null,
    github_url: f.github_url.trim() || null,
    folder_path: f.folder_path.trim() || null,
    extra_links: [],
  };
  if (!data.name) errors.name = 'กรุณากรอกชื่อโปรเจกต์';
  if (data.start_date && data.end_date && data.end_date < data.start_date) errors.end_date = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
  if (data.web_url && !isHttp(data.web_url)) errors.web_url = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://';
  if (data.github_url && !isHttp(data.github_url)) errors.github_url = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://';
  f.extra_links.forEach((l, i) => {
    const label = l.label.trim();
    const url = l.url.trim();
    if (!label && !url) return;
    if (!url || !isHttp(url)) errors['extra_' + i] = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://';
    else data.extra_links.push({ label: label || url, url });
  });
  return { errors, data };
}
