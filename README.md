# Project Hub
เว็บรวมโปรเจกต์ส่วนตัว — HTML/CSS/JS (ES modules, ไม่มี build) + Supabase + GitHub Pages

- รันในเครื่อง: `python -m http.server 5500` แล้วเปิด http://localhost:5500
- SQL: `sql/schema.sql` → `sql/seed.sql` → `sql/002_agent_access.sql` (ทุกไฟล์รันซ้ำได้)
- คีย์ใส่ใน `js/config.js` (anon/publishable เท่านั้น ห้าม service_role)

## ให้ AI อัปเดตได้

ให้ AI ประจำโปรเจกต์ (เช่น Claude Code ใน repo ของโปรเจกต์นั้น) อ่านและอัปเดตข้อมูลโปรเจกต์ของตัวเองใน Hub ได้
โดยไม่ต้องให้สิทธิ์เหนือโปรเจกต์อื่น

**หลักการ**
- เจ้าของสร้าง "agent token" แยกต่อโปรเจกต์จากหน้าเว็บ (หน้ารายละเอียด → ส่วน "ผู้ช่วย AI") token หนึ่งตัวแก้ได้เฉพาะโปรเจกต์ของมัน ยกเลิกได้ทันที มีได้ไม่เกิน 5 ตัวที่ใช้งานอยู่ต่อโปรเจกต์
- ฐานข้อมูลเก็บแค่ sha256 ของ token ส่วน token จริงเห็นครั้งเดียวตอนสร้าง (ถ้าหายให้ยกเลิกแล้วสร้างใหม่)
- AI เรียกผ่าน Supabase REST `/rest/v1/rpc/...` ด้วย anon/publishable key ตัวเดียวกับเว็บ และส่ง token เป็นพารามิเตอร์
- **ทำได้:** ดูข้อมูลโปรเจกต์, บันทึกประวัติอัปเดต, เพิ่มขั้นตอน, ติ๊ก/ยกเลิกติ๊กขั้นตอน, แก้ `status` `tagline` `tags` `start_date` `end_date` `web_url` `github_url` `folder_path`
- **ทำไม่ได้:** ลบอะไรเลย, เปลี่ยนชื่อโปรเจกต์, แตะโปรเจกต์อื่น
- ข้อจำกัด: บันทึกอัปเดตได้ 20 รายการ/ชั่วโมง/token, ขั้นตอนไม่เกิน 100 ต่อโปรเจกต์, แท็กไม่เกิน 12 ตัว (ตัวละไม่เกิน 30 ตัวอักษร)

**ตั้งค่า (ทำครั้งเดียว)**
1. รัน `sql/schema.sql` (ถ้ายังไม่เคย) แล้วรัน `sql/002_agent_access.sql` ใน Supabase SQL Editor
2. เปิดโปรเจกต์ใน Hub → "ผู้ช่วย AI" → ตั้งชื่อ → "สร้าง token"
3. กด "คัดลอก .hub.env" ไปวางเป็นไฟล์ `.hub.env` ที่ root ของ repo โปรเจกต์นั้น (**ต้องอยู่ใน `.gitignore`**)
4. กด "คัดลอกคำสั่งตั้งค่าสำหรับ AI" ไปวางให้ AI ใน repo นั้นทำตาม (มันจะตั้งค่าและเพิ่มกติกาลง `CLAUDE.md` ของ repo นั้นให้เอง)

**CLI** (`tools/hub_agent.py` — Python 3.8+ ไม่ต้องลงไลบรารี ใช้ได้บน Windows)

```bash
python tools/hub_agent.py status                              # ดูข้อมูล ขั้นตอน (มีเลขลำดับ) และอัปเดตล่าสุด
python tools/hub_agent.py log "wake word ใช้ได้บน PC แล้ว" --version v0.2
python tools/hub_agent.py done 2                              # เลขลำดับ | id | คำในชื่อ
python tools/hub_agent.py undone "หน้ารายการ"
python tools/hub_agent.py add-milestone "ทดสอบบน Android" --due 2026-12-01
python tools/hub_agent.py set status=active tags=ai,voice web_url=https://example.com
python tools/hub_agent.py status --json                       # ผลลัพธ์ดิบ
```

อ่านค่า `HUB_URL`, `HUB_KEY`, `HUB_TOKEN` จาก environment ก่อน ถ้าไม่มีจะหาไฟล์ `.hub.env` จากโฟลเดอร์ปัจจุบันขึ้นไป
ถ้าผิดพลาด exit code เป็น 1 พร้อมข้อความภาษาไทย (404 = ยังไม่ได้รัน 002, 401 = key ผิด, เชื่อมต่อไม่ได้ = Supabase อาจถูกพัก)

## ทดสอบ

```bash
cd tests && npm i && node sql.test.mjs     # SQL บน Postgres จริง (embedded) ~100 ข้อ
python tests/test_hub_agent.py             # CLI กับ mock server
```

## PWA / deploy
ทุกครั้งที่แก้ไฟล์เว็บแล้ว deploy ให้เพิ่มเลข `VERSION` ใน `sw.js` (รายละเอียดใน `CLAUDE.md`)
