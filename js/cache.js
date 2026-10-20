// เก็บข้อมูลชุดล่าสุดไว้ใน localStorage สำหรับดูตอนออฟไลน์ (อ่านอย่างเดียว)
const K = 'hub.cache.';

function write(key, value) {
  try { localStorage.setItem(K + key, JSON.stringify(value)); } catch (e) { /* เต็มหรือไม่มี storage */ }
}
function read(key) {
  try { return JSON.parse(localStorage.getItem(K + key) || 'null'); } catch (e) { return null; }
}

export const saveProjects = (data) => write('projects', { at: new Date().toISOString(), data });
export const loadProjects = () => read('projects'); // { at, data } | null

export const saveDetail = (id, ms, ups) => write('d.' + id, { ms, ups });
export const loadDetail = (id) => read('d.' + id);

export function clearCache() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(K)).forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ไม่มี storage */ }
}

export function formatAt(iso) {
  return new Date(iso).toLocaleString('th-TH-u-ca-buddhist', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
