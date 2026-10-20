#!/usr/bin/env python3
"""hub_agent.py - ให้ AI ประจำโปรเจกต์อ่าน/อัปเดตข้อมูลโปรเจกต์ของตัวเองใน Project Hub

ใช้ Python 3.8+ (stdlib เท่านั้น) เรียก Supabase REST (/rest/v1/rpc/...) ด้วย anon/publishable key
และ agent token ที่เจ้าของสร้างจากหน้าเว็บ (token หนึ่งตัวแก้ได้เฉพาะโปรเจกต์ของมัน)

ค่าตั้งต้นอ่านจาก environment (HUB_URL, HUB_KEY, HUB_TOKEN) ก่อน
ถ้าไม่มีให้หาไฟล์ .hub.env จากโฟลเดอร์ปัจจุบันขึ้นไปเรื่อยๆ (บรรทัดละ KEY=VALUE)

คำสั่ง:
  status                              ดูข้อมูลโปรเจกต์ ขั้นตอน (มีเลขลำดับ) และอัปเดตล่าสุด
  log "ข้อความ" [--version V] [--date YYYY-MM-DD]
  done <เลขลำดับ|id|คำในชื่อ>          ติ๊กขั้นตอนว่าเสร็จ
  undone <เลขลำดับ|id|คำในชื่อ>        ยกเลิกติ๊ก
  add-milestone "ชื่อ" [--due YYYY-MM-DD]
  set key=value ...                   แก้ status tagline tags start_date end_date web_url github_url folder_path
  เพิ่ม --json เพื่อดูผลลัพธ์ดิบ   exit code 0 = สำเร็จ, 1 = ผิดพลาด
"""
import argparse
import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date

ENV_NAME = ".hub.env"
SETTABLE = ("status", "tagline", "tags", "start_date", "end_date", "web_url", "github_url", "folder_path")
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIMEOUT = 25


class HubError(Exception):
    """ข้อผิดพลาดที่อธิบายเป็นภาษาไทยได้ (แสดงแล้ว exit 1)"""


def _utf8():
    # Windows: stdout/stderr ค่าเริ่มต้นไม่ใช่ UTF-8 ทำให้ภาษาไทยพัง
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def err(msg):
    print(msg, file=sys.stderr)


# ---------- ตั้งค่า ----------
def find_env_file(start=None):
    d = os.path.abspath(start or os.getcwd())
    while True:
        p = os.path.join(d, ENV_NAME)
        if os.path.isfile(p):
            return p
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def parse_env_file(path):
    out = {}
    with open(path, "r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            out[k.strip()] = v
    return out


def warn_if_not_ignored(path):
    """ถ้า .hub.env อยู่ใน git repo แต่ยังไม่ถูก ignore ให้เตือนทาง stderr"""
    d = os.path.dirname(path)
    try:
        inside = subprocess.run(["git", "-C", d, "rev-parse", "--is-inside-work-tree"],
                                capture_output=True, text=True, timeout=5)
        if inside.returncode != 0 or inside.stdout.strip() != "true":
            return
        ignored = subprocess.run(["git", "-C", d, "check-ignore", "-q", path],
                                 capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return  # ไม่มี git ก็ข้าม
    if ignored.returncode == 1:
        err("คำเตือน: %s อยู่ใน git repo แต่ยังไม่อยู่ใน .gitignore - เสี่ยงหลุด token ขึ้น GitHub! "
            "เพิ่มบรรทัด .hub.env ลงใน .gitignore ก่อน commit" % path)


def load_config():
    file_vals = {}
    path = find_env_file()
    if path:
        file_vals = parse_env_file(path)
    cfg = {}
    for k in ("HUB_URL", "HUB_KEY", "HUB_TOKEN"):
        cfg[k] = os.environ.get(k) or file_vals.get(k) or ""
    missing = [k for k, v in cfg.items() if not v]
    if missing:
        raise HubError(
            "ตั้งค่าไม่ครบ: ขาด %s\n"
            "ใส่ HUB_URL, HUB_KEY, HUB_TOKEN ในไฟล์ %s ที่ root ของ repo (หรือตั้งเป็น environment variable)\n"
            "สร้าง token ได้จากหน้ารายละเอียดโปรเจกต์ใน Project Hub ส่วน \"ผู้ช่วย AI\"" % (", ".join(missing), ENV_NAME))
    if path and any(k in file_vals for k in cfg):
        warn_if_not_ignored(path)
    url = cfg["HUB_URL"].strip().rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[:-8]
    cfg["HUB_URL"] = url
    cfg["HUB_KEY"] = cfg["HUB_KEY"].strip()
    cfg["HUB_TOKEN"] = cfg["HUB_TOKEN"].strip()
    return cfg


# ---------- เรียก Supabase ----------
def call(cfg, fn, params):
    body = dict(params)
    body["p_token"] = cfg["HUB_TOKEN"]
    headers = {"apikey": cfg["HUB_KEY"], "Content-Type": "application/json", "Accept": "application/json"}
    if cfg["HUB_KEY"].startswith("eyJ"):  # anon key แบบ JWT เดิมต้องส่ง Bearer ด้วย
        headers["Authorization"] = "Bearer " + cfg["HUB_KEY"]
    req = urllib.request.Request(cfg["HUB_URL"] + "/rest/v1/rpc/" + fn,
                                 data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise HubError(_http_message(e, fn))
    except (urllib.error.URLError, socket.timeout, ConnectionError, OSError) as e:
        reason = getattr(e, "reason", e)
        raise HubError("เชื่อมต่อ Supabase ไม่ได้ (%s)\n"
                       "เช็กอินเทอร์เน็ต และโปรเจกต์ Supabase อาจถูกพัก (free tier จะพักเมื่อไม่มีการใช้งาน) "
                       "ให้เปิดแดชบอร์ด Supabase แล้วกด Restore/Resume" % reason)
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except ValueError:
        raise HubError("คำตอบจากเซิร์ฟเวอร์ไม่ใช่ JSON (ตรวจ HUB_URL ว่าถูกต้อง)")


def _http_message(e, fn):
    try:
        data = json.loads(e.read().decode("utf-8"))
    except Exception:
        data = {}
    msg = data.get("message") if isinstance(data, dict) else None
    code = data.get("code") if isinstance(data, dict) else None
    if e.code == 404 or code == "PGRST202":
        return ("ไม่พบฟังก์ชัน %s บนฐานข้อมูล - ยังไม่ได้รัน sql/002_agent_access.sql ใน Supabase SQL Editor "
                "(หรือตรวจ HUB_URL ว่าถูกโปรเจกต์)" % fn)
    if e.code == 401:
        return "HUB_KEY ไม่ถูกต้อง (401) - ใช้ anon/publishable key ของโปรเจกต์ Supabase เดียวกับ HUB_URL"
    if msg:
        extra = data.get("hint")
        return msg + ("\n(%s)" % extra if extra else "")
    return "เซิร์ฟเวอร์ตอบ HTTP %s" % e.code


# ---------- ช่วยแสดงผล ----------
def one_line(s, n=200):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def show_status(info):
    p = info["project"]
    ms = info.get("milestones") or []
    done = sum(1 for m in ms if m.get("done"))
    pct = round(done * 100 / len(ms)) if ms else 0
    print("โปรเจกต์: %s  (%s)" % (p.get("name"), p.get("slug")))
    print("สถานะ: %s" % p.get("status"))
    if p.get("tagline"):
        print("คำอธิบาย: %s" % p["tagline"])
    if p.get("tags"):
        print("แท็ก: %s" % ", ".join(p["tags"]))
    print("วันที่: %s → %s   (วันนี้ตามเวลาไทย: %s)" % (p.get("start_date") or "-", p.get("end_date") or "-", info.get("today")))
    print("ลิงก์: เว็บ=%s | GitHub=%s | โฟลเดอร์=%s" % (p.get("web_url") or "-", p.get("github_url") or "-", p.get("folder_path") or "-"))
    print("ความคืบหน้า: %d/%d ขั้น (%d%%)" % (done, len(ms), pct))
    print("ขั้นตอน:")
    if not ms:
        print("  (ยังไม่มี)")
    for i, m in enumerate(ms, 1):
        due = "  (กำหนด %s)" % m["due_date"] if m.get("due_date") else ""
        print("  %d. [%s] %s%s" % (i, "x" if m.get("done") else " ", m.get("title"), due))
    print("อัปเดตล่าสุด:")
    ups = info.get("updates") or []
    if not ups:
        print("  (ยังไม่มี)")
    for u in ups:
        who = "  [AI · %s]" % u.get("agent_label") if u.get("source") == "agent" else ""
        ver = " " + u["version"] if u.get("version") else ""
        print("  %s%s%s  %s" % (u.get("date"), ver, who, one_line(u.get("note"))))


def resolve_milestone(ms, ref):
    ref = ref.strip()
    if not ref:
        raise HubError("ต้องระบุขั้นตอน (เลขลำดับ, id หรือคำในชื่อ)")
    if re.fullmatch(r"\d+", ref):
        i = int(ref)
        if not 1 <= i <= len(ms):
            raise HubError("ไม่มีขั้นตอนลำดับที่ %d (มี %s)" % (i, "1–%d" % len(ms) if ms else "0 ขั้น"))
        return ms[i - 1]
    if UUID_RE.match(ref):
        for m in ms:
            if m["id"].lower() == ref.lower():
                return m
        raise HubError("ไม่พบขั้นตอน id %s ในโปรเจกต์นี้" % ref)
    low = ref.lower()
    exact = [m for m in ms if m["title"].strip().lower() == low]
    if len(exact) == 1:
        return exact[0]
    hits = [(i, m) for i, m in enumerate(ms, 1) if low in m["title"].lower()]
    if not hits:
        raise HubError("ไม่พบขั้นตอนที่มีคำว่า \"%s\" (ดูรายการด้วยคำสั่ง status)" % ref)
    if len(hits) > 1:
        lines = "\n".join("  %d. %s" % (i, m["title"]) for i, m in hits)
        raise HubError("คำว่า \"%s\" ตรงกับหลายขั้นตอน เลือกด้วยเลขลำดับ:\n%s" % (ref, lines))
    return hits[0][1]


def check_date(s, what):
    if s is None:
        return None
    if not DATE_RE.match(s):
        raise HubError("%s ต้องเป็นรูปแบบ YYYY-MM-DD (ได้รับ \"%s\")" % (what, s))
    try:
        date.fromisoformat(s)
    except ValueError:
        raise HubError("%s \"%s\" ไม่มีอยู่จริงในปฏิทิน" % (what, s))
    return s


# ---------- คำสั่ง ----------
def cmd_status(cfg, a):
    info = call(cfg, "hub_agent_get_project", {})
    if a.as_json:
        print(json.dumps(info, ensure_ascii=False, indent=2))
    else:
        show_status(info)


def cmd_log(cfg, a):
    d = check_date(a.date, "--date")
    res = call(cfg, "hub_agent_add_update", {"p_note": a.note, "p_version": a.version, "p_date": d})
    if a.as_json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print("บันทึกอัปเดตแล้ว (วันที่ %s)" % res.get("date"))


def _set_done(cfg, a, done):
    info = call(cfg, "hub_agent_get_project", {})
    m = resolve_milestone(info.get("milestones") or [], a.target)
    res = call(cfg, "hub_agent_set_milestone", {"p_milestone_id": m["id"], "p_done": done})
    if a.as_json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print("%s: %s" % ("ติ๊กว่าเสร็จแล้ว" if done else "ยกเลิกการติ๊ก", m["title"]))


def cmd_done(cfg, a):
    _set_done(cfg, a, True)


def cmd_undone(cfg, a):
    _set_done(cfg, a, False)


def cmd_add_milestone(cfg, a):
    d = check_date(a.due, "--due")
    res = call(cfg, "hub_agent_add_milestone", {"p_title": a.title, "p_due_date": d})
    if a.as_json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print("เพิ่มขั้นตอนแล้ว (ลำดับที่ %s): %s" % (res.get("sort_order"), res.get("title")))


def cmd_set(cfg, a):
    changes = {}
    for pair in a.pairs:
        if "=" not in pair:
            raise HubError("รูปแบบต้องเป็น key=value (ได้รับ \"%s\") ฟิลด์ที่แก้ได้: %s" % (pair, ", ".join(SETTABLE)))
        k, v = pair.split("=", 1)
        k = k.strip()
        if not k:
            raise HubError("ชื่อฟิลด์ว่างใน \"%s\"" % pair)
        if k == "tags":
            changes[k] = [t.strip() for t in v.split(",") if t.strip()]
        else:
            changes[k] = v.strip() if v.strip() != "" else None
    res = call(cfg, "hub_agent_update_project", {"p_changes": changes})
    if a.as_json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print("แก้ข้อมูลโปรเจกต์แล้ว:")
        for k in changes:
            v = res.get(k)
            print("  %s = %s" % (k, ", ".join(v) if isinstance(v, list) else v))


# ---------- main ----------
class _Parser(argparse.ArgumentParser):
    def error(self, message):
        err("ใช้คำสั่งไม่ถูกต้อง: %s\n(ดูวิธีใช้: python hub_agent.py --help)" % message)
        sys.exit(1)


def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", dest="as_json_sub", action="store_true", help="แสดงผลลัพธ์ดิบเป็น JSON")
    p = _Parser(description="ให้ AI อัปเดตข้อมูลโปรเจกต์ใน Project Hub", epilog=__doc__,
                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json", dest="as_json_main", action="store_true", help="แสดงผลลัพธ์ดิบเป็น JSON")
    sub = p.add_subparsers(dest="cmd", parser_class=_Parser, metavar="คำสั่ง")
    sub.required = True

    s = sub.add_parser("status", parents=[common], help="ดูข้อมูลโปรเจกต์")
    s.set_defaults(fn=cmd_status)

    s = sub.add_parser("log", parents=[common], help="บันทึกประวัติอัปเดต")
    s.add_argument("note", help="สรุปสั้นๆ ว่าเปลี่ยนอะไร")
    s.add_argument("--version")
    s.add_argument("--date", help="YYYY-MM-DD (ค่าเริ่มต้นคือวันนี้ตามเวลาไทย)")
    s.set_defaults(fn=cmd_log)

    for name, fn, h in (("done", cmd_done, "ติ๊กขั้นตอนว่าเสร็จ"), ("undone", cmd_undone, "ยกเลิกติ๊ก")):
        s = sub.add_parser(name, parents=[common], help=h)
        s.add_argument("target", help="เลขลำดับ, id หรือคำในชื่อขั้นตอน")
        s.set_defaults(fn=fn)

    s = sub.add_parser("add-milestone", parents=[common], help="เพิ่มขั้นตอนใหม่")
    s.add_argument("title")
    s.add_argument("--due", help="YYYY-MM-DD")
    s.set_defaults(fn=cmd_add_milestone)

    s = sub.add_parser("set", parents=[common], help="แก้ฟิลด์โปรเจกต์ (key=value)")
    s.add_argument("pairs", nargs="+", metavar="key=value")
    s.set_defaults(fn=cmd_set)
    return p


def main(argv=None):
    _utf8()
    args = build_parser().parse_args(argv)
    args.as_json = args.as_json_main or args.as_json_sub
    try:
        cfg = load_config()
        args.fn(cfg, args)
    except HubError as e:
        err("ผิดพลาด: %s" % e)
        return 1
    except KeyboardInterrupt:
        return 1
    except (KeyError, TypeError):
        err("ผิดพลาด: คำตอบจากเซิร์ฟเวอร์ไม่ตรงรูปแบบที่คาด (ลองรัน status --json ดู)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
