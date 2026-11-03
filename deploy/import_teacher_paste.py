#!/usr/bin/env python3
"""Plan B import: turn text a teacher copied (teacher_copy.js) into data files.

When a teacher can't reach the server, the page lets them copy their record and
send it over WeChat. Save each pasted message to a .txt file, then run:

    python3 deploy/import_teacher_paste.py paste1.txt [paste2.txt ...]
    python3 deploy/import_teacher_paste.py -          # read one paste from stdin

Writes exactly what the server would have written:
  session_data/sense-<孩子>-<condition>-<sessionId>-<stage>-pasted.json   (raw)
  session_data/teacher_form/孩子_老师_时间.{json,csv}                        (merged)
Import the form paste before the video-settings paste so they merge into one pair.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
from server import save_teacher_record  # noqa: E402


def parse(text):
    start, end = text.find('{'), text.rfind('}')
    if start == -1 or end <= start:
        raise ValueError('没有找到数据（缺少 { … }）——请确认整段都复制了')
    return json.loads(text[start:end + 1])


def beijing(ts):
    try:
        t = datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
        return t.astimezone(timezone(timedelta(hours=8))).strftime('%Y%m%d-%H%M%S')
    except Exception:
        return None


def import_one(text, session_dir):
    body = parse(text)
    cond = body.get('condition')
    stage = body.get('exportStage', 'unknown')
    if cond not in ('teacherform', 'teacher'):
        raise ValueError(f'不是老师数据（condition={cond!r}）')
    clean = lambda v: ''.join(c for c in str(v or '') if c.isalnum() or c in '-_')
    raw = os.path.join(session_dir, f"sense-{clean(body.get('participantId')) or 'NO-PID'}-{cond}-"
                                    f"{clean(body.get('sessionId'))}-{clean(stage)}-pasted.json")
    os.makedirs(session_dir, exist_ok=True)
    with open(raw, 'w', encoding='utf-8') as f:
        json.dump(body, f, indent=2, ensure_ascii=False)
    if cond == 'teacherform' or stage == 'baseline-confirmed':
        save_teacher_record(session_dir, cond, body, when=beijing(body.get('timestamp')))
    return body.get('participantId'), cond


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    session_dir = os.path.join(REPO, 'session_data')
    for a in args:
        text = sys.stdin.read() if a == '-' else open(a, encoding='utf-8').read()
        try:
            pid, cond = import_one(text, session_dir)
            print(f'OK  {a}: {pid} ({"表格" if cond == "teacherform" else "视频设置"})')
        except Exception as e:
            print(f'ERR {a}: {e}')


if __name__ == '__main__':
    main()
