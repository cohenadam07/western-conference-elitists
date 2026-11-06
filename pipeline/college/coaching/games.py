"""
games.py — every D1 game as College Basketball Coaching Savant reads it.

    python3 games.py 2025-26 2024-25 ...        -> <CBCS_OUT>/games/<season>.json.gz + census/<season>.json

College Basketball Savant's `rebuild.py` already decides lineups, stints, possessions, garbage time
and shot zones; this module runs it unchanged (so every count here is the one College Savant
publishes) and adds the events a coach decides, read from the same normalized play-by-play:

  timeouts     team-called only (types 579 "ShortTimeOut" and 578 "RegularTimeOut"; the team is the
               play's own team field, which every team timeout carries in every season measured,
               2006-07 to 2026-27). Media timeouts (580 "Official TV Timeout") are kept apart. A team
               timeout that lands in a media window (a TV mark at 16:00, 12:00, 8:00 or 4:00 of a half
               has passed and no TV timeout has been taken since) is flagged `media`: it stood in for
               the TV break (config.MEDIA_RULE has the rule, by season).
  challenges   2025-26 on. The outcome is the play's parenthetical, "(Overturned)" or "(Upheld)"/"(Stands)",
               and the timeout clause only where there is none. ESPN's three signals disagree on 2025-26:
               the type id (215/216) contradicts the other two on 192 challenges, the clause ("charged
               with a timeout") contradicts them on 243. The rule decided it: a second challenge is
               allowed only after a first that won, and of the 158 teams that challenged twice, 30
               first challenges read "(Overturned)" with "charged" (the parenthetical holds), none the
               other way; 11 read failed on every signal, feed noise the check reports. 2026-27's
               three signals have always agreed so far.
  fouls        personal (519) and technical (521) fouls on players, with the clock: foul trouble.
  turnovers    one type (598) in every season from 2013-14; a steal (607) by the other side at the
               same clock makes it live-ball. ESPN logs no other turnover type, so "press-like
               pressure" is live-ball turnovers forced early in possessions that began after the
               team's own made basket (rotation.py / cgame.py), never a claim about a press.
  possessions  rebuild.py's possession log, with who called the team timeout before it (own / opponent),
               which rebuild.py itself records since Nov 6 2026, so College Savant's after-timeout numbers
               and these are one count (before, this file matched timeouts to possessions by the clock).

Seasons. 2013-14 on: before that ESPN merges fouls and turnovers into one type (601) and has
play-by-play for 53-68% of games, so rebuild.py's possessions do not hold (census2, Nov 5 2026).
Lineups exist only where College Savant has them: CBBD's fives for 2023-24 and 2024-25 (join.py)
and ESPN's own substitutions from mid-February 2025; ESPN logged no substitutions before 2024-25
(measured: 0 a game, 2013-14 to 2023-24).

The output is this pipeline's own intermediate table, on the Mac (and in the cloud run's cache for
the season in progress). Nothing here is published raw.
"""
import concurrent.futures as cf
import gzip
import json
import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
COLLEGE = os.path.join(HERE, "..")
sys.path.insert(0, COLLEGE)
sys.path.insert(0, HERE)

import espn_cbb as E  # noqa: E402
import join as J  # noqa: E402
import normalize as N  # noqa: E402
import rebuild as R  # noqa: E402
import season as SN  # noqa: E402

OUT = os.environ.get("CBCS_OUT") or os.path.expanduser("~/Basketball-Savant/out/cbcs")
FIRST_SEASON = "2013-14"
MARKS = (960.0, 720.0, 480.0, 240.0)          # the TV marks of each half, in seconds left in the half
TEAM_TO = {"579": "s", "578": "f"}
MEDIA_TO = "580"
CHALLENGE = {"215", "216"}
ZONES = ("rim", "paint", "mid", "c3", "ab3")
ON = R.ON


def _r(x, d=1):
    return None if x is None else round(float(x), d)


def parse(season, ev):
    g = N.load_game(season, ev)
    J.apply(g)
    r = R.rebuild_game(g)
    home, away = g["home"], g["away"]
    gate = r["gate"]
    final_pbp = bool(r["team"]) and all(t["pbp"]["pts"] == t["pts"] for t in r["team"])
    pbp_ok, lineup_ok = SN.flags(gate, final_pbp) if r["team"] else (False, False)
    m = g["meta"]
    rec = dict(gid=g["gid"], date=g["date"], home=home, away=away, hs=g["teams"][home]["score"] if home else 0,
               as_=g["teams"][away]["score"] if away else 0, neutral=m["neutral"], conf=m["confgame"], stype=m["stype"],
               note=m["note"], venue=m["venue"], officials=m["officials"], line=g["line"], non_d1=g["non_d1"],
               ot=gate.get("ot", 0), pbp_ok=pbp_ok, lineup_ok=lineup_ok, lineups=gate.get("lineups", "none"),
               names={p["eid"]: p["name"] for p in g["players"]})
    # players: the box line and the play-by-play's seconds
    rec["players"] = [[x["eid"], x["team"], x["sec"], x["min"], int(bool(x["starter"])), x["box"]["pts"], x["box"]["fga"], x["box"]["fta"],
                       x["box"]["tov"], x["box"]["oreb"], x["box"]["dreb"], x["box"]["ast"], x["box"]["stl"], x["box"]["blk"], x["box"]["pf"],
                       x["poss"][0] + x["poss"][2]] for x in r["rows"]]
    rec["team"] = {t["team"]: dict(pts=t["pts"], opp_pts=t["opp_pts"], poss=t["poss"], opp_poss=t["opp_poss"], poss_g=t["poss_g"],
                                   box=t["box"], pbp=t["pbp"]) for t in r["team"]}
    if not pbp_ok:
        return rec, None
    plays = sorted((p for p in g["plays"] if p["period"]), key=lambda p: (p["period"], -p["clock"]))
    teams = (home, away)
    opp = {home: away, away: home}

    # ---------------------------------------------------------------- scoring, for runs and margins
    score = {home: 0, away: 0}
    last_score = {home: None, away: None}        # (order, points so far by the other side) at each side's last score
    runs_against = {home: 0, away: 0}            # unanswered points by the other side
    tos, media, chal, fouls, tovs = [], [], [], [], []
    windows = {}                                  # (period, mark) -> "open" | "taken"
    for k, p in enumerate(plays):
        tid, per, clk, tm = p["tid"], p["period"], p["clock"], p["team"]
        # media windows: a mark passed in a regulation half opens a window
        if per <= 2:
            for mk in MARKS:
                if clk < mk and (per, mk) not in windows:
                    windows[(per, mk)] = "open"
        if p.get("scoring") and tm in teams:
            v = 1 if tid == R.FT else (3 if R.is_three(p) else 2)
            score[tm] += v
            runs_against[opp[tm]] += v
            runs_against[tm] = 0
        if tid in TEAM_TO and tm in teams:
            in_window = any(v == "open" for (pp, mk), v in windows.items() if pp == per)
            if in_window:
                for key in [w for w, v in windows.items() if w[0] == per and v == "open"]:
                    windows[key] = "taken"
            tos.append([per, clk, tm, TEAM_TO[tid], score[tm] - score[opp[tm]], runs_against[tm], int(in_window)])
        elif tid == MEDIA_TO:
            media.append([per, clk])
            for key in [w for w, v in windows.items() if w[0] == per and v == "open"]:
                windows[key] = "taken"
        elif tid in CHALLENGE or "coach's challenge" in (p["text"] or "").lower():
            tx = (p["text"] or "").lower()
            ok = 1 if "(overturned)" in tx else 0 if ("(upheld)" in tx or "(stands)" in tx) else (1 if "retain" in tx else 0 if "charged with a timeout" in tx else None)
            chal.append([per, clk, tm, ok, int("charged with a timeout" in tx), score.get(tm, 0) - score.get(opp.get(tm), 0) if tm in teams else None])
        elif tid in ("519", "521") and p["ath"]:
            fouls.append([per, clk, p["ath"][0], tm, int(tid == "521")])
        elif tid == R.TOV and tm in teams:
            live = 0
            for q in plays[k + 1:k + 4]:
                if q["clock"] != clk or q["period"] != per:
                    break
                if q["tid"] == R.STEAL and q["team"] == opp[tm]:
                    live = 1
            tovs.append([per, clk, tm, p["ath"][0] if p["ath"] else None, live])
    rec.update(to=tos, media=media, ch=chal, fouls=fouls, tov=tovs)

    # ---------------------------------------------------------------- possessions with the caller
    plog = r.get("poss") or []
    out = []
    for row in plog:
        team, per, start, end, kind, ato, pts, gflag, clutch, margin, five, dfive, first, fkind, caller = row[:15]
        out.append([int(team == home), per, _r(start), _r(end), kind, ato, caller, int(pts), int(gflag), int(clutch), int(margin),
                    _r(first), fkind])
    rec["poss"] = out
    # shots by team: zones, transition and the estimated clock, garbage out; and the zones again with
    # garbage time in, which is how College Savant's shot diet (Rim / Mid / Three) counts them
    sh = {t: Counter() for t in teams}
    zall = {t: Counter() for t in teams}
    for s in r["shots"]:
        if s["team"] not in sh:
            continue
        if s.get("zone") in ZONES:
            zall[s["team"]][s["zone"] + "_a"] += 1
        if s.get("g"):
            continue
        c = sh[s["team"]]
        z = s.get("zone")
        if z in ZONES:
            c[z + "_a"] += 1
            c[z + "_m"] += int(bool(s["made"]))
        c["fga"] += 1
        c["tr_a"] += int(bool(s.get("tr")))
        c["ast_m"] += int(bool(s.get("ast")) and bool(s["made"]))
    rec["shots"] = {t: dict(v) for t, v in sh.items()}
    rec["zones"] = {t: dict(v) for t, v in zall.items()}
    if lineup_ok:
        # stints: period, start, end, home five, away five, garbage, then home and away counts (ON order)
        rec["stints"] = [[s[0], _r(s[1]), _r(s[2]), s[3], s[4], s[5]] + [_r(v, 1) for v in s[6:]] for s in r["stints"]]
    return rec, gate


def _one(a):
    season, ev = a
    try:
        rec, gate = parse(season, ev)
        return rec, None
    except Exception as e:  # noqa: one bad game must not stop a season; it is counted and listed
        return None, f"{ev.get('id')}: {type(e).__name__}: {e}"


def run(season, workers=6, log=print):
    t0 = time.time()
    seen = json.load(open(os.path.join(E.ROOT, season, "days.json")))
    fin = [e for e in E.finals(seen) if os.path.exists(E.raw_path(season, e["id"]))]
    recs, errs = [], []
    with cf.ProcessPoolExecutor(workers) as ex:
        for rec, err in ex.map(_one, [(season, e) for e in fin], chunksize=40):
            if rec:
                recs.append(rec)
            if err:
                errs.append(err)
    recs.sort(key=lambda x: (x["date"] or "", x["gid"]))
    os.makedirs(os.path.join(OUT, "games"), exist_ok=True)
    with open(os.path.join(OUT, "games", f"{season}.json.gz"), "wb") as fh:
        fh.write(gzip.compress(json.dumps(recs, separators=(",", ":")).encode(), 6, mtime=0))
    c = census(season, recs)
    c["errors"] = errs[:50]
    c["n_errors"] = len(errs)
    os.makedirs(os.path.join(OUT, "census"), exist_ok=True)
    json.dump(c, open(os.path.join(OUT, "census", f"{season}.json"), "w"), indent=1)
    log(f"{season}: {len(recs)} games, {len(errs)} errors, pbp_ok {c['pbp_ok']}, lineup_ok {c['lineup_ok']}, "
        f"team minutes ok {c['team_minutes_ok']}, team timeouts {c['team_to']} ({time.time() - t0:.0f}s)")
    return c


def census(season, recs):
    """The season's measured completeness: the gates step 2 uses before anything reads it."""
    d1 = [g for g in recs if not g["non_d1"]]
    pbp = [g for g in d1 if g["pbp_ok"]]
    lo = [g for g in d1 if g["lineup_ok"]]
    # team minutes: the stints' five-man seconds per team = 200 minutes + 25 per overtime
    ok, n = 0, 0
    for g in lo:
        want = 200 + 25 * g["ot"]
        sec = defaultdict(float)
        for s in g.get("stints") or []:
            dur = (s[1] or 0) - (s[2] or 0)
            sec["h"] += dur * len(s[3])
            sec["a"] += dur * len(s[4])
        for k in ("h", "a"):
            n += 1
            ok += abs(sec[k] / 60.0 - want) <= 1.0
    to_n = sum(len(g.get("to") or []) for g in pbp)
    to_team = sum(1 for g in pbp for t in g.get("to") or [] if t[2])
    per_team_game = Counter()
    for g in pbp:
        c = Counter(t[2] for t in g.get("to") or [])
        for t in (g["home"], g["away"]):
            per_team_game[(min(c.get(t, 0), 12), min(g["ot"], 3))] += 1
    ch = [c for g in pbp for c in g.get("ch") or []]
    return dict(season=season, games=len(recs), d1=len(d1), pbp_ok=round(len(pbp) / max(1, len(d1)), 4), lineup_ok=round(len(lo) / max(1, len(d1)), 4),
                lineup_games=len(lo), team_minutes_ok=round(ok / max(1, n), 4) if n else None, team_minutes_n=n,
                team_to=to_n, team_to_with_team=round(to_team / max(1, to_n), 4), team_to_per_team_game=round(to_n / max(1, 2 * len(pbp)), 3),
                to_dist={f"{k[0]}|ot{k[1]}": v for k, v in sorted(per_team_game.items())},
                media_to_per_game=round(sum(len(g.get("media") or []) for g in pbp) / max(1, len(pbp)), 2),
                to_in_media_window=round(sum(t[6] for g in pbp for t in g.get("to") or []) / max(1, to_n), 4),
                challenges=len(ch), challenge_success=round(sum(1 for c in ch if c[3] == 1) / max(1, len(ch)), 4) if ch else None,
                challenge_unread=sum(1 for c in ch if c[3] is None),
                live_tov_share=round(sum(t[4] for g in pbp for t in g.get("tov") or []) / max(1, sum(len(g.get("tov") or []) for g in pbp)), 4),
                lines=round(sum(1 for g in d1 if (g.get("line") or {}).get("spread") is not None) / max(1, len(d1)), 4))


def load(season):
    with gzip.open(os.path.join(OUT, "games", f"{season}.json.gz"), "rt") as fh:
        return json.load(fh)


if __name__ == "__main__":
    for s in sys.argv[1:]:
        run(s, log=lambda m: print(time.strftime("%H:%M:%S"), m, flush=True))
