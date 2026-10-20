# Project Hub
HTML/CSS/JS ธรรมดา (ES modules ไม่มี build) · Supabase · GitHub Pages · UI ภาษาไทย · รองรับมือถือ Android

กฎ: ตาราง prefix `hub_` · ห้ามปิด RLS · ห้าม commit secret/service_role · เรียก Supabase ผ่าน js/db.js เท่านั้น · SQL รันซ้ำได้
ธีม: พื้น #EAF0F5 ตัวอักษร #0B1828 หลัก #0A8FB0 + dark mode · ฟอนต์ Bai Jamjuree / IBM Plex Sans Thai / IBM Plex Mono

## เฟส
- [x] เฟส 0: ฐานข้อมูล ล็อกอิน หน้าทดสอบระบบ (โค้ดพร้อม; เหลือตั้งค่า Supabase และ deploy ตามขั้นตอน)
- [x] เฟส 1: หน้ารวมโปรเจกต์ (ค้นหา/กรอง/แถบเตือน/การ์ด/ฟอร์มเพิ่ม-แก้-ลบ) — js/ui.js, js/util.js
- [x] เฟส 2: หน้ารายละเอียด (panel ขวา/เต็มจอบนมือถือ, deep link #p=slug) จัดการ milestones (ลากเรียง) และ updates — js/detail.js
- [x] เฟส 3: ไทม์ไลน์ Gantt ในหน้ารวม (กรอง/ค้นหาร่วมกับการ์ด, พับ/ขยายจำสถานะ) — js/gantt.js
- [x] เฟส 4: หน้า "ลิงก์เว็บ" (#links) ค้นหาเร็ว ไฮไลต์ Enter เปิดผลแรก — js/links.js
- [x] เฟส 5: PWA ติดตั้งบนมือถือได้ (manifest, ไอคอน, sw.js, ออฟไลน์อ่านอย่างเดียว, แถบเวอร์ชันใหม่) — sw.js, js/pwa.js, js/cache.js, js/net.js
- [ ] เฟส 6: (ยังไม่กำหนด)

## PWA — ต้องทำทุกครั้งที่ deploy
- แก้ไฟล์เว็บ (html/css/js/ไอคอน) แล้วต้องเพิ่มเลข `VERSION` ใน `sw.js` (v1 → v2 …) ไม่งั้นเครื่องที่ติดตั้งไว้จะค้างเวอร์ชันเก่า (cache-first)
- ถ้าเพิ่ม/ลบไฟล์ใน js/ css/ icons/ ให้แก้รายการ `SHELL` ใน `sw.js` ด้วย
- บน localhost จะไม่ลงทะเบียน SW (ไม่ให้ cache รบกวนตอนพัฒนา) ถ้าจะทดสอบ SW ให้เปิด `?sw=1`
- SW ไม่แตะ request ไป *.supabase.co เด็ดขาด ข้อมูลออฟไลน์เก็บใน localStorage (`hub.cache.*`) และถูกล้างเมื่อออกจากระบบ
