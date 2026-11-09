"""Scarica calendario e risultati ufficiali Volley Cup (portale Italian Volley League / US ACLI)
e genera data/season.json per il sito.

Dal JSON originale vengono tenuti SOLO i dati pubblici della partita (data, squadre,
palestra, set). Nomi di atleti, arbitri, certificati ecc. non vengono mai salvati.

Uso:  python scripts/sync.py
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "data" / "config.json").read_text(encoding="utf-8"))
OUT = ROOT / "data" / "season.json"

API = "https://ivl.usacli.it/PartiteData"


def fetch_group(girone_id: int, territorio_id: int, start: str, end: str) -> list[dict]:
    params = {
        "girone_id": girone_id,
        "territorio_id": territorio_id,
        "campionato_id": "null",
        "inizio_stagione": start,
        "fine_stagione": end,
        "societa_id": "null",
        "squadra_id": "null",
        "pubblicato": 1,
        "search": "",
        "sort": "",
        "order": "",
        "offset": 0,
        "limit": 500,
    }
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "team-site-sync/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.load(resp)
    return payload.get("rows", [])


def clean_team(name: str | None) -> str:
    if not name:
        return ""
    name = name.strip()
    suffix = " " + CONFIG["category_suffix"]
    if name.lower().endswith(suffix.lower()):
        name = name[: -len(suffix)]
    return name.strip()


def to_match(r: dict) -> dict:
    rinvio = r.get("data_orario_rinvio")
    when = rinvio or r["data_orario"]
    gym_name = (r.get("palestrarinvio_name") if rinvio and r.get("palestrarinvio_name") else r.get("palestra1_name")) or ""
    gym_addr = (r.get("palestrarinvio_indirizzo") if rinvio and r.get("palestrarinvio_indirizzo") else r.get("palestra1_indirizzo")) or ""
    gym_city = (r.get("palestrarinvio_comune") if rinvio and r.get("palestrarinvio_comune") else r.get("palestra1_comune")) or ""
    lat = r.get("palestrarinvio_latitude") if rinvio and r.get("palestrarinvio_latitude") else r.get("palestra1_latitude")
    lng = r.get("palestrarinvio_longitude") if rinvio and r.get("palestrarinvio_longitude") else r.get("palestra1_longitude")

    sets = []
    for i in range(1, 6):
        h, a = r.get(f"ris_punti{i}set_casa"), r.get(f"ris_punti{i}set_ospite")
        if h is not None and a is not None:
            sets.append([int(h), int(a)])

    played = r.get("ris_set_casa") is not None and r.get("ris_set_ospite") is not None
    return {
        "id": r["id"],
        "code": r.get("npartita_custom") or "",
        "round": int(r["giornata"]) if str(r.get("giornata", "")).isdigit() else r.get("giornata"),
        "datetime": when.replace(" ", "T"),
        "postponed": bool(rinvio),
        "home": clean_team(r.get("squadra_casa_name")),
        "away": clean_team(r.get("squadra_ospite_name")),
        "venue": {
            "name": gym_name.strip(),
            "address": gym_addr.strip(),
            "city": gym_city.strip().title(),
            "lat": lat,
            "lng": lng,
        },
        "result": [int(r["ris_set_casa"]), int(r["ris_set_ospite"])] if played else None,
        "sets": sets,
    }


def standings(matches: list[dict]) -> list[dict]:
    """Classifica calcolata dai risultati: 3-0 / 3-1 = 3 punti, 3-2 = 2 punti (1 alla perdente)."""
    table: dict[str, dict] = {}

    def row(team: str) -> dict:
        return table.setdefault(team, {
            "team": team, "played": 0, "won": 0, "lost": 0, "points": 0,
            "sets_won": 0, "sets_lost": 0, "pts_won": 0, "pts_lost": 0, "form": [],
        })

    for m in sorted(matches, key=lambda x: x["datetime"]):
        h, a = row(m["home"]), row(m["away"])
        if not m["result"]:
            continue
        sh, sa = m["result"]
        for team_row, mine, theirs, side in ((h, sh, sa, 0), (a, sa, sh, 1)):
            team_row["played"] += 1
            team_row["sets_won"] += mine
            team_row["sets_lost"] += theirs
            for s in m["sets"]:
                team_row["pts_won"] += s[side]
                team_row["pts_lost"] += s[1 - side]
            win = mine > theirs
            team_row["won" if win else "lost"] += 1
            team_row["points"] += (3 if theirs <= 1 else 2) if win else (1 if mine == 2 else 0)
            team_row["form"].append("W" if win else "L")

    def ratio(a: int, b: int) -> float:
        return a / b if b else (float("inf") if a else 0.0)

    rows = list(table.values())
    rows.sort(key=lambda r: (-r["points"], -r["won"], -ratio(r["sets_won"], r["sets_lost"]),
                             -ratio(r["pts_won"], r["pts_lost"]), r["team"]))
    for i, r in enumerate(rows, 1):
        r["pos"] = i
        r["form"] = r["form"][-5:]
    return rows


VTIMEZONE = """BEGIN:VTIMEZONE
TZID:Europe/Rome
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE"""


def ics_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold(line: str) -> str:
    """Spezza le righe oltre 75 byte come richiesto dallo standard iCalendar."""
    out, cur = [], ""
    for ch in line:
        if len((cur + ch).encode("utf-8")) > 74:
            out.append(cur)
            cur = " " + ch
        else:
            cur += ch
    out.append(cur)
    return "\r\n".join(out)


def nice(name: str) -> str:
    return " ".join(w.capitalize() for w in name.split())


def build_ics(matches: list[dict], competition: str, stamp: str, cal_name: str) -> str:
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ASD Mantegazza Rogorotto//Calendario//IT",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        f"X-WR-CALNAME:{ics_escape(cal_name)}", "X-WR-TIMEZONE:Europe/Rome",
        "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
        *VTIMEZONE.split("\n"),
    ]
    for m in matches:
        start = datetime.fromisoformat(m["datetime"])
        end = start + timedelta(hours=2)
        title = f"{nice(m['home'])} - {nice(m['away'])}"
        desc = f"{competition}, giornata {m['round']}"
        if m["result"]:
            title = f"{nice(m['home'])} {m['result'][0]}-{m['result'][1]} {nice(m['away'])}"
            desc += "\nParziali: " + ", ".join(f"{a}-{b}" for a, b in m["sets"])
        v = m["venue"]
        lines += [
            "BEGIN:VEVENT",
            f"UID:volleycup-{m['id']}@mantegazzarogorotto",
            f"DTSTAMP:{stamp}",
            f"DTSTART;TZID=Europe/Rome:{start:%Y%m%dT%H%M%S}",
            f"DTEND;TZID=Europe/Rome:{end:%Y%m%dT%H%M%S}",
            f"SUMMARY:{ics_escape(title)}",
            f"LOCATION:{ics_escape(f'{v['name']}, {v['address']}, {v['city']}')}",
            f"DESCRIPTION:{ics_escape(desc)}",
        ]
        if v.get("lat") and v.get("lng"):
            lines.append(f"GEO:{v['lat']};{v['lng']}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(l) for l in lines) + "\r\n"


def write_if_changed(path: Path, text: str) -> bool:
    if path.exists() and path.read_bytes() == text.encode("utf-8"):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    return True


def write_calendars(data: dict) -> int:
    stamp = data["updated_at"].replace("-", "").replace(":", "").replace("+0000", "Z")[:15] + "Z"
    changed = 0
    changed += write_if_changed(ROOT / "calendar.ics",
                                build_ics(data["matches"], data["competition"], stamp, "Mantegazza Rogorotto"))
    for m in data["matches"]:
        changed += write_if_changed(ROOT / "cal" / f"{m['id']}.ics",
                                    build_ics([m], data["competition"], stamp, "Mantegazza Rogorotto"))
    return changed


def main() -> int:
    c = CONFIG
    try:
        raw = fetch_group(c["girone_id"], c["territorio_id"], c["season_start"], c["season_end"])
    except Exception as exc:  # rete giù: lascia i dati vecchi
        print(f"Errore download: {exc}", file=sys.stderr)
        return 1
    if not raw:
        print("Nessuna partita ricevuta: lascio i dati esistenti.", file=sys.stderr)
        return 1

    all_matches = sorted((to_match(r) for r in raw), key=lambda m: m["datetime"])
    team = c["team_name"]
    ours = [m for m in all_matches if team in (m["home"], m["away"])]

    data = {
        "source": c["source_url"],
        "competition": c["competition"],
        "group": raw[0].get("GironeName", "").title(),
        "team": team,
        "matches": ours,
        "group_matches": all_matches,
        "standings": standings(all_matches),
    }

    old = None
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            old = None
    if old and old.get("updated_at") and {k: v for k, v in old.items() if k != "updated_at"} == data:
        data["updated_at"] = old["updated_at"]
        n = write_calendars(data)
        print("Nessuna novità." + (f" Rigenerati {n} file calendario." if n else ""))
        return 0

    data["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_calendars(data)
    print(f"Aggiornato: {len(ours)} partite nostre, {len(all_matches)} nel girone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
