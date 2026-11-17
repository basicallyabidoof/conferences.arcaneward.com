#!/usr/bin/env python3
"""Convert the Submissions spreadsheet into data/submissions.json for the dashboard.

Usage:
    python3 -m venv .venv && .venv/bin/pip install openpyxl
    .venv/bin/python scripts/build_submissions.py ~/Downloads/Submissions.xlsx

Columns expected (row 1 headers): Conference Name, Talk, Talk Length,
Submission Date, Response, Location, Conference Date, Expected Reply.
Free-text dates ("June 27-28 2025", "Mid APR 2025", "February") are parsed
best-effort; the original text is kept alongside in *_raw.
"""
import datetime as dt
import json
import pathlib
import re
import sys

import openpyxl

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

# Talk titles drift between submissions; fold the obvious variants together.
TALK_ALIASES = [
    (r"^risky business\b|risk illiteracy", "The Risky Business of Risk Illiteracy"),
    (r"ai illiteracy", "The Risky Business of AI Illiteracy"),
    (r"^iam is the perimeter", "IAM is the Perimeter"),
    (r"^4 steps", "4 Steps, Repeat: Threat Modeling"),
    (r"^bridging the gap", "Bridging the Gap: Delivering Offensive Insights to the Blue Team"),
    (r"^rebuilding your iam", "Rebuilding your IAM Program"),
    (r"^open source poi", "Open Source Poison"),
    (r"^when iac goes wrong|^preventing iac", "When IaC Goes Wrong: Preventing Tech Debt"),
    (r"^hacking other teams", "Hacking Other Teams, Using Social Skills"),
    (r"^going beyond box checking", "Going Beyond Box Checking with Annual Pentests"),
]

STATUS = {"accepted": "Accepted", "denied": "Denied", "no response": "No Response",
          "retracted": "Retracted", "submitted": "Submitted"}


def clean(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def canon_talk(t):
    low = t.lower()
    # "AI illiteracy" must win over the generic "risky business" rule.
    if "ai illiteracy" in low:
        return "The Risky Business of AI Illiteracy"
    for pat, name in TALK_ALIASES:
        if re.search(pat, low):
            return name
    return t or "(untitled)"


def parse_loose_date(v, fallback_year=None):
    """Return ISO yyyy-mm-dd for a cell that may be a datetime or messy text."""
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    s = clean(v).lower()
    if not s:
        return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    year = re.search(r"\b(20\d{2})\b", s)
    year = int(year.group(1)) if year else fallback_year
    month = next((n for k, n in MONTHS.items() if re.search(rf"\b{k}", s)), None)
    if not (year and month):
        return None
    day = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\b", re.sub(r"20\d{2}", "", s))
    day = int(day.group(1)) if day else (15 if "mid" in s else 1)
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return dt.date(year, month, 1).isoformat()


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = [clean(h).lower() for h in rows[0]]
    idx = {name: header.index(name) for name in header if name}

    def col(r, name):
        i = idx.get(name)
        return r[i] if i is not None and i < len(r) else None

    out = []
    for r in rows[1:]:
        if not any(c is not None and clean(c) for c in r[:8]):
            continue
        talk_raw = clean(col(r, "talk"))
        submitted = parse_loose_date(col(r, "submission date"))
        conf_date = parse_loose_date(col(r, "conference date"))
        if not conf_date and submitted:
            # "6-7 Sept" with no year: assume the next occurrence after submitting.
            guess = parse_loose_date(col(r, "conference date"), int(submitted[:4]))
            if guess and guess < submitted:
                guess = parse_loose_date(col(r, "conference date"), int(submitted[:4]) + 1)
            conf_date = guess
        conf_year = int(conf_date[:4]) if conf_date else None
        length = clean(col(r, "talk length"))
        out.append({
            "conference": clean(col(r, "conference name")) or "(unnamed)",
            "talk": canon_talk(talk_raw),
            "talk_raw": talk_raw,
            "length": re.sub(r"\.0$", "", length),
            "submitted": submitted,
            "status": STATUS.get(clean(col(r, "response")).lower(), clean(col(r, "response")) or "Unknown"),
            "location": clean(col(r, "location")),
            "con_date": conf_date,
            "con_date_raw": clean(col(r, "conference date")) if not isinstance(col(r, "conference date"), dt.datetime) else "",
            "expected_reply": parse_loose_date(col(r, "expected reply"), conf_year),
        })

    dest = pathlib.Path(__file__).resolve().parent.parent / "data" / "submissions.json"
    payload = {"generated": dt.date.today().isoformat(), "submissions": out}
    dest.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {len(out)} submissions -> {dest}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
