// สถานะออฟไลน์ของแอป (ใช้ร่วมกันระหว่างโมดูล)
let offline = false;
const listeners = new Set();

export const isOffline = () => offline;

export function setOffline(v) {
  if (v === offline) return;
  offline = v;
  listeners.forEach((f) => f(v));
}

export function onOfflineChange(f) {
  listeners.add(f);
}
