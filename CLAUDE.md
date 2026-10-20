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
- [x] เฟส 6: ให้ AI ประจำโปรเจกต์อัปเดตข้อมูลได้ (agent token, sql/002_agent_access.sql, tools/hub_agent.py, ส่วน "ผู้ช่วย AI") — js/agent.js
- [ ] เฟส 7: (ยังไม่กำหนด)

## PWA — ต้องทำทุกครั้งที่ deploy
- แก้ไฟล์เว็บ (html/css/js/ไอคอน) แล้วต้องเพิ่มเลข `VERSION` ใน `sw.js` (v1 → v2 …) ไม่งั้นเครื่องที่ติดตั้งไว้จะค้างเวอร์ชันเก่า (cache-first)
- ถ้าเพิ่ม/ลบไฟล์ใน js/ css/ icons/ ให้แก้รายการ `SHELL` ใน `sw.js` ด้วย
- บน localhost จะไม่ลงทะเบียน SW (ไม่ให้ cache รบกวนตอนพัฒนา) ถ้าจะทดสอบ SW ให้เปิด `?sw=1`
- SW ไม่แตะ request ไป *.supabase.co เด็ดขาด ข้อมูลออฟไลน์เก็บใน localStorage (`hub.cache.*`) และถูกล้างเมื่อออกจากระบบ

## Agent access (เฟส 6)
- AI เรียกฟังก์ชัน `hub_agent_*` ผ่าน RPC ด้วย token (ฐานข้อมูลเก็บแค่ sha256) ห้ามเพิ่มฟังก์ชันลบ/เปลี่ยนชื่อให้ AI
- ฟังก์ชันใน `public` ต้อง `revoke` จาก public/anon/authenticated ก่อนแล้ว `grant` ใหม่ทุกครั้ง (Supabase ให้ anon execute อัตโนมัติ) ฟังก์ชันภายในอยู่ใน `hub_private`
- `hub_agent_tokens` ห้าม `select *` จากเว็บ (token_hash ถูก revoke) ใช้ db.js `listAgentTokens` เท่านั้น
- `schema.sql` สร้าง view `hub_project_overview` เฉพาะเมื่อยังไม่มี เพื่อไม่ทับคอลัมน์ที่ 002 เพิ่ม ถ้าจะแก้ view ให้แก้ใน 002
- แก้ SQL แล้วรัน `cd tests && node sql.test.mjs` และแก้ CLI แล้วรัน `python tests/test_hub_agent.py` ก่อน commit
- `.hub.env` ต้องอยู่ใน `.gitignore` เสมอ
