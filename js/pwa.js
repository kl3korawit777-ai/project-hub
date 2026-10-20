// ลงทะเบียน service worker และแจ้งเมื่อมีเวอร์ชันใหม่
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

export function initPwa({ onUpdate }) {
  if (!('serviceWorker' in navigator)) return;
  // ตอนพัฒนาบน localhost ไม่ลงทะเบียน (cache-first จะทำให้แก้ไฟล์แล้วไม่เห็นผล) ยกเว้นใส่ ?sw
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (local && !/[?&]sw\b/.test(location.search)) return;

  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });

  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => onUpdate(() => worker.postMessage({ type: 'SKIP_WAITING' }));
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw);
      });
    });

    // ตรวจเวอร์ชันใหม่เมื่อกลับมาเปิดแอป และทุกชั่วโมง
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 3600000);

    // เก็บฟอนต์/ไลบรารีจาก CDN ที่โหลดไปแล้วไว้ใช้ออฟไลน์
    navigator.serviceWorker.ready.then((r) => setTimeout(() => {
      const urls = [...new Set(performance.getEntriesByType('resource').map((x) => x.name).filter((u) => CDN.test(u)))];
      if (r.active && urls.length) r.active.postMessage({ type: 'CACHE_URLS', urls });
    }, 3000));
  }).catch(() => { /* ลงทะเบียนไม่ได้ ก็ใช้งานแบบเว็บปกติ */ });
}
