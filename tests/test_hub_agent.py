"""ทดสอบ tools/hub_agent.py กับ mock server ในเครื่อง (จำลอง Supabase REST /rest/v1/rpc)
รัน: python tests/test_hub_agent.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, "..", "tools", "hub_agent.py")
TOKEN = "hub_" + "a1" * 32
KEY_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig"
KEY_PUB = "sb_publishable_TESTKEY"

STATE = {}


def reset_state():
    STATE.clear()
    STATE.update(
        requests=[],
        mode="ok",  # ok | 404 | 401 | revoked
        milestones=[
            {"id": "11111111-1111-1111-1111-111111111111", "title": "ตั้งฐานข้อมูล", "done": True, "due_date": None},
            {"id": "22222222-2222-2222-2222-222222222222", "title": "หน้ารายการโปรเจกต์", "done": False, "due_date": "2026-11-01"},
            {"id": "33333333-3333-3333-3333-333333333333", "title": "หน้ารายละเอียดโปรเจกต์", "done": False, "due_date": None},
        ],
    )


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n).decode("utf-8"))
        fn = self.path.split("/rest/v1/rpc/")[-1]
        STATE["requests"].append({"fn": fn, "body": body, "headers": {k.lower(): v for k, v in self.headers.items()}, "path": self.path})
        mode = STATE["mode"]
        if mode == "401":
            return self._send(401, {"message": "Invalid API key", "hint": "Double check your Supabase `anon` or `service_role` API key."})
        if mode == "404":
            return self._send(404, {"code": "PGRST202", "message": "Could not find the function public.%s" % fn})
        if mode == "revoked" or body.get("p_token") != TOKEN:
            return self._send(403, {"code": "28000", "message": "invalid_token: token ไม่ถูกต้องหรือถูกยกเลิกแล้ว"})
        ms = STATE["milestones"]
        if fn == "hub_agent_get_project":
            return self._send(200, {
                "today": "2026-10-20",
                "project": {"id": "p1", "slug": "lucian", "name": "Lucian", "status": "active", "tagline": "ผู้ช่วยเสียง",
                            "tags": ["ai", "voice"], "start_date": "2026-10-01", "end_date": None,
                            "web_url": "https://lucian.example.com", "github_url": None, "folder_path": "C:/lucian"},
                "milestones": ms,
                "updates": [
                    {"date": "2026-10-19", "version": "v0.2", "note": "wake word ใช้ได้บน PC แล้ว", "source": "agent", "agent_label": "Claude Code · Lucian"},
                    {"date": "2026-10-10", "version": None, "note": "เริ่มโปรเจกต์", "source": "owner", "agent_label": None},
                ],
            })
        if fn == "hub_agent_add_update":
            if body.get("p_note") == "เกินโควตา":
                return self._send(400, {"code": "P0001", "message": "rate_limited: บันทึกอัปเดตได้ไม่เกิน 20 รายการต่อชั่วโมงต่อ token"})
            return self._send(200, {"id": "u1", "date": body.get("p_date") or "2026-10-20"})
        if fn == "hub_agent_set_milestone":
            m = next((m for m in ms if m["id"] == body["p_milestone_id"]), None)
            if not m:
                return self._send(400, {"code": "P0001", "message": "milestone_not_found: ไม่พบขั้นตอนนี้ในโปรเจกต์ของ token"})
            m["done"] = body["p_done"]
            return self._send(200, {"id": m["id"], "done": m["done"]})
        if fn == "hub_agent_add_milestone":
            ms.append({"id": "44444444-4444-4444-4444-444444444444", "title": body["p_title"], "done": False, "due_date": body.get("p_due_date")})
            return self._send(200, {"id": "4444", "title": body["p_title"], "sort_order": len(ms)})
        if fn == "hub_agent_update_project":
            ch = body["p_changes"]
            bad = [k for k in ch if k not in ("status", "tagline", "tags", "start_date", "end_date", "web_url", "github_url", "folder_path")]
            if bad:
                return self._send(400, {"code": "P0001", "message": "field_not_allowed: แก้ฟิลด์ %s ไม่ได้ (แก้ได้เฉพาะ: status, tagline, ...)" % ", ".join(bad)})
            out = {"status": "active", "tagline": None, "tags": [], "start_date": None, "end_date": None, "web_url": None, "github_url": None, "folder_path": None}
            out.update(ch)
            return self._send(200, out)
        return self._send(404, {"code": "PGRST202", "message": "no such fn"})


class CliTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Mock)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = "http://127.0.0.1:%d" % cls.port

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        reset_state()
        self.tmp = tempfile.mkdtemp(prefix="hubcli-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # รัน CLI เป็น subprocess แยก (เหมือนที่ AI ใช้จริง) แล้วถอดรหัสเป็น utf-8
    def run_cli(self, *args, env=None, cwd=None, key=KEY_PUB, token=TOKEN, url=None, use_env=True):
        e = {k: v for k, v in os.environ.items() if not k.startswith("HUB_")}
        e.pop("PYTHONIOENCODING", None)
        if use_env:
            e.update(HUB_URL=url or self.url, HUB_KEY=key, HUB_TOKEN=token)
        if env:
            e.update(env)
        p = subprocess.run([sys.executable, CLI] + list(args), capture_output=True, env=e, cwd=cwd or self.tmp)
        out, errs = p.stdout.decode("utf-8"), p.stderr.decode("utf-8")
        self.assertNotIn(TOKEN, out + errs, "token ห้ามโผล่ในผลลัพธ์")
        return p.returncode, out, errs

    def last(self):
        return STATE["requests"][-1]

    # ---------- status ----------
    def test_status_text(self):
        rc, out, _ = self.run_cli("status")
        self.assertEqual(rc, 0)
        for s in ("Lucian", "active", "ai, voice", "1/3 ขั้น (33%)", "1. [x] ตั้งฐานข้อมูล", "2. [ ] หน้ารายการโปรเจกต์",
                  "(กำหนด 2026-11-01)", "[AI · Claude Code · Lucian]", "wake word ใช้ได้บน PC แล้ว", "2026-10-20"):
            self.assertIn(s, out)

    def test_status_json(self):
        rc, out, _ = self.run_cli("status", "--json")
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["project"]["slug"], "lucian")
        rc, out, _ = self.run_cli("--json", "status")
        self.assertEqual(json.loads(out)["today"], "2026-10-20")

    def test_headers(self):
        self.run_cli("status", key=KEY_PUB)
        h = self.last()["headers"]
        self.assertEqual(h["apikey"], KEY_PUB)
        self.assertNotIn("authorization", h)
        self.assertEqual(self.last()["path"], "/rest/v1/rpc/hub_agent_get_project")
        self.run_cli("status", key=KEY_JWT)
        h = self.last()["headers"]
        self.assertEqual(h["apikey"], KEY_JWT)
        self.assertEqual(h["authorization"], "Bearer " + KEY_JWT)

    # ---------- log ----------
    def test_log(self):
        rc, out, _ = self.run_cli("log", "wake word ใช้ได้แล้ว", "--version", "v1.2", "--date", "2026-10-18")
        self.assertEqual(rc, 0)
        self.assertIn("บันทึกอัปเดตแล้ว (วันที่ 2026-10-18)", out)
        self.assertEqual(self.last()["body"], {"p_note": "wake word ใช้ได้แล้ว", "p_version": "v1.2", "p_date": "2026-10-18", "p_token": TOKEN})
        rc, out, _ = self.run_cli("log", "ง่ายๆ")
        self.assertEqual(self.last()["body"]["p_version"], None)
        self.assertEqual(self.last()["body"]["p_date"], None)

    def test_log_bad_date_never_hits_network(self):
        n = len(STATE["requests"])
        rc, _, errs = self.run_cli("log", "x", "--date", "20/10/2026")
        self.assertEqual(rc, 1)
        self.assertIn("YYYY-MM-DD", errs)
        rc, _, errs = self.run_cli("log", "x", "--date", "2026-02-30")
        self.assertEqual(rc, 1)
        self.assertIn("ไม่มีอยู่จริง", errs)
        self.assertEqual(len(STATE["requests"]), n)

    def test_log_rate_limited_message(self):
        rc, _, errs = self.run_cli("log", "เกินโควตา")
        self.assertEqual(rc, 1)
        self.assertIn("rate_limited:", errs)

    # ---------- done / undone ----------
    def test_done_by_number_id_words(self):
        rc, out, _ = self.run_cli("done", "2")
        self.assertEqual(rc, 0)
        self.assertIn("หน้ารายการโปรเจกต์", out)
        self.assertEqual(self.last()["body"]["p_milestone_id"], "22222222-2222-2222-2222-222222222222")
        self.assertIs(self.last()["body"]["p_done"], True)
        self.run_cli("done", "33333333-3333-3333-3333-333333333333")
        self.assertEqual(self.last()["body"]["p_milestone_id"], "33333333-3333-3333-3333-333333333333")
        self.run_cli("undone", "ฐานข้อมูล")
        self.assertEqual(self.last()["body"]["p_milestone_id"], "11111111-1111-1111-1111-111111111111")
        self.assertIs(self.last()["body"]["p_done"], False)
        self.run_cli("done", "รายละเอียด")
        self.assertEqual(self.last()["body"]["p_milestone_id"], "33333333-3333-3333-3333-333333333333")

    def test_done_ambiguous_lists_candidates(self):
        n = len([r for r in STATE["requests"] if r["fn"] == "hub_agent_set_milestone"])
        rc, _, errs = self.run_cli("done", "หน้า")
        self.assertEqual(rc, 1)
        self.assertIn("หลายขั้นตอน", errs)
        self.assertIn("2. หน้ารายการโปรเจกต์", errs)
        self.assertIn("3. หน้ารายละเอียดโปรเจกต์", errs)
        self.assertEqual(n, len([r for r in STATE["requests"] if r["fn"] == "hub_agent_set_milestone"]))

    def test_done_not_found(self):
        rc, _, errs = self.run_cli("done", "ไม่มีจริง")
        self.assertEqual(rc, 1)
        self.assertIn("ไม่พบขั้นตอน", errs)
        rc, _, errs = self.run_cli("done", "9")
        self.assertEqual(rc, 1)
        self.assertIn("ไม่มีขั้นตอนลำดับที่ 9", errs)
        rc, _, errs = self.run_cli("done", "99999999-9999-9999-9999-999999999999")
        self.assertEqual(rc, 1)

    # ---------- add-milestone ----------
    def test_add_milestone(self):
        rc, out, _ = self.run_cli("add-milestone", "ทดสอบบน Android", "--due", "2026-12-01")
        self.assertEqual(rc, 0)
        self.assertIn("ลำดับที่ 4", out)
        self.assertEqual(self.last()["body"]["p_title"], "ทดสอบบน Android")
        self.assertEqual(self.last()["body"]["p_due_date"], "2026-12-01")
        rc, _, errs = self.run_cli("add-milestone", "x", "--due", "พรุ่งนี้")
        self.assertEqual(rc, 1)

    # ---------- set ----------
    def test_set(self):
        rc, out, _ = self.run_cli("set", "status=done", "tags=ai, voice ,pc", "web_url=https://x.dev", "github_url=", "tagline=สรุป = ดี")
        self.assertEqual(rc, 0)
        self.assertEqual(self.last()["body"]["p_changes"], {
            "status": "done", "tags": ["ai", "voice", "pc"], "web_url": "https://x.dev", "github_url": None, "tagline": "สรุป = ดี"})
        self.assertIn("status = done", out)
        self.assertIn("tags = ai, voice, pc", out)

    def test_set_empty_tags_and_bad_pair(self):
        self.run_cli("set", "tags=")
        self.assertEqual(self.last()["body"]["p_changes"], {"tags": []})
        rc, _, errs = self.run_cli("set", "statusdone")
        self.assertEqual(rc, 1)
        self.assertIn("key=value", errs)

    def test_set_not_allowed_shows_server_message(self):
        rc, _, errs = self.run_cli("set", "name=ชื่อใหม่")
        self.assertEqual(rc, 1)
        self.assertIn("field_not_allowed:", errs)

    # ---------- error ----------
    def test_errors(self):
        STATE["mode"] = "404"
        rc, _, errs = self.run_cli("status")
        self.assertEqual(rc, 1)
        self.assertIn("002_agent_access.sql", errs)
        STATE["mode"] = "401"
        rc, _, errs = self.run_cli("status")
        self.assertEqual(rc, 1)
        self.assertIn("HUB_KEY", errs)
        STATE["mode"] = "revoked"
        rc, _, errs = self.run_cli("status")
        self.assertEqual(rc, 1)
        self.assertIn("invalid_token:", errs)
        STATE["mode"] = "ok"
        rc, _, errs = self.run_cli("status", token="hub_" + "0" * 64)
        self.assertEqual(rc, 1)
        self.assertIn("invalid_token:", errs)

    def test_connection_refused(self):
        rc, _, errs = self.run_cli("status", url="http://127.0.0.1:1")
        self.assertEqual(rc, 1)
        self.assertIn("เชื่อมต่อ Supabase ไม่ได้", errs)
        self.assertIn("พัก", errs)

    def test_usage_error_exit_1(self):
        rc, _, errs = self.run_cli("nonsense")
        self.assertEqual(rc, 1)
        rc, _, errs = self.run_cli()
        self.assertEqual(rc, 1)

    # ---------- ตั้งค่า ----------
    def test_missing_config(self):
        rc, _, errs = self.run_cli("status", use_env=False)
        self.assertEqual(rc, 1)
        self.assertIn(".hub.env", errs)
        self.assertIn("HUB_TOKEN", errs)

    def test_env_file_found_upwards_and_env_overrides(self):
        with open(os.path.join(self.tmp, ".hub.env"), "w", encoding="utf-8") as f:
            f.write("# ความเห็น\nHUB_URL=%s/\nexport HUB_KEY=\"%s\"\nHUB_TOKEN=%s\n" % (self.url, KEY_PUB, TOKEN))
        sub = os.path.join(self.tmp, "a", "b")
        os.makedirs(sub)
        rc, out, _ = self.run_cli("status", use_env=False, cwd=sub)
        self.assertEqual(rc, 0)
        self.assertIn("Lucian", out)
        self.assertEqual(self.last()["headers"]["apikey"], KEY_PUB)
        # environment มีสิทธิ์เหนือไฟล์
        rc, _, errs = self.run_cli("status", use_env=False, cwd=sub, env={"HUB_TOKEN": "hub_" + "9" * 64})
        self.assertEqual(rc, 1)
        self.assertIn("invalid_token:", errs)

    def _git(self, *args):
        subprocess.run(["git", "-C", self.tmp] + list(args), capture_output=True, check=True)

    def test_warns_when_env_not_gitignored(self):
        if not shutil.which("git"):
            self.skipTest("ไม่มี git")
        self._git("init", "-q")
        with open(os.path.join(self.tmp, ".hub.env"), "w", encoding="utf-8") as f:
            f.write("HUB_URL=%s\nHUB_KEY=%s\nHUB_TOKEN=%s\n" % (self.url, KEY_PUB, TOKEN))
        rc, out, errs = self.run_cli("status", use_env=False)
        self.assertEqual(rc, 0)
        self.assertIn("คำเตือน", errs)
        self.assertIn(".gitignore", errs)
        with open(os.path.join(self.tmp, ".gitignore"), "w", encoding="utf-8") as f:
            f.write(".hub.env\n")
        rc, out, errs = self.run_cli("status", use_env=False)
        self.assertEqual(rc, 0)
        self.assertNotIn("คำเตือน", errs)

    def test_no_warning_outside_git(self):
        with open(os.path.join(self.tmp, ".hub.env"), "w", encoding="utf-8") as f:
            f.write("HUB_URL=%s\nHUB_KEY=%s\nHUB_TOKEN=%s\n" % (self.url, KEY_PUB, TOKEN))
        # tmp อยู่นอก git repo ใดๆ (ในระบบทดสอบ) ถ้าเครื่องนี้ tmp อยู่ใน repo ให้ข้าม
        chk = subprocess.run(["git", "-C", self.tmp, "rev-parse", "--is-inside-work-tree"], capture_output=True)
        if chk.returncode == 0:
            self.skipTest("tmp อยู่ใน git repo")
        rc, _, errs = self.run_cli("status", use_env=False)
        self.assertEqual(rc, 0)
        self.assertNotIn("คำเตือน", errs)


if __name__ == "__main__":
    unittest.main(verbosity=2)
