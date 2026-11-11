"""Step 3. ESPN live check (PROMPT-1 ground rule 4).

Pulls the FBS scoreboard for one 2025 and one 2026 Saturday, then the summary and the core
play-by-play (with participants) for the first five final FBS-vs-FBS games of each date (by
event id), and compares the participant roles and athlete ids with the sportsdataverse release
files (play_participants_{season}.parquet and play_by_play_{season}.parquet).

    python -m pipeline.cfb.espn_live

Writes research/cfb/out/espn_live_check.md. Every response is cached under
~/College-Football-Savant/raw/espn_live/ so a rerun makes no calls.
"""
import re
from collections import Counter, defaultdict

import pandas as pd

from .espn_http import get_json, pmap, log_stats, LOG
from .paths import RAW, OUT

SB = ("https://site.api.espn.com/apis/site/v2/sports/football/college-football/"
      "scoreboard?groups=80&limit=400&dates={d}")
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={e}"
PLAYS = ("https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/"
         "events/{e}/competitions/{e}/plays?limit=300&page={p}")
DATES = {2025: ["20251018"], 2026: ["20261031", "20261024"]}  # second 2026 date only if no finals
N_GAMES = 5
URLS = []  # every URL this module asks for (cached or not), for the latency report

PBP_COLS = ["game_id", "id", "type.text", "text", "passer_player_id", "rusher_player_id",
            "receiver_player_id", "sack_player_id", "sack_player_id2", "interception_player_id",
            "pass_breakup_player_id", "fumble_forced_player_id", "fumble_recovered_player_id",
            "fumble_player_id", "qb_hurry", "sack", "pass_breakup", "forced_fumble"]
# release pbp column -> the live participant role that should carry the same athlete
PBP_ROLE = {"passer_player_id": "passer", "rusher_player_id": "rusher",
            "receiver_player_id": "receiver", "sack_player_id": "sackedBy",
            "pass_breakup_player_id": "passDefender", "fumble_forced_player_id": "forcedBy",
            "fumble_recovered_player_id": "recoverer", "fumble_player_id": "fumbler"}


def fetch(url, key):
    URLS.append(url)
    return get_json(url, key)


def snake(s):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()


def ath_id(part):
    m = re.search(r"/athletes/(\d+)", (part.get("athlete") or {}).get("$ref", ""))
    return m.group(1) if m else None


def ids_of(cell):
    """Release '*_player_ids' cells are stringified numpy lists: "['123' '456']"."""
    if cell is None or (isinstance(cell, float) and pd.isna(cell)):
        return []
    return re.findall(r"\d+", str(cell))


def fbs_ids(season):
    t = pd.read_parquet(RAW / "espn_cfb_teams" / f"cfb_teams_{season}.parquet",
                        columns=["team_id", "is_fbs"])
    return set(t.loc[t.is_fbs == True, "team_id"].astype(int))  # noqa: E712


def pick_games(sb, season):
    fbs = fbs_ids(season)
    out = []
    for e in sorted(sb["events"], key=lambda e: int(e["id"])):
        c = e["competitions"][0]
        if not e["status"]["type"].get("completed"):
            continue
        tids = [int(x["team"]["id"]) for x in c["competitors"]]
        if all(t in fbs for t in tids):
            out.append(e)
    return out


def all_plays(eid):
    first = fetch(PLAYS.format(e=eid, p=1), f"plays_{eid}_p1")
    items = list(first.get("items", []))
    for p in range(2, int(first.get("pageCount", 1)) + 1):
        items += fetch(PLAYS.format(e=eid, p=p), f"plays_{eid}_p{p}").get("items", [])
    return first, items


def release_coverage():
    """No ESPN calls. Since live ids equal release ids, the release files show how often each role
    is populated across a whole season, split by the play-text format of the game."""
    L = ["### (e) How often each role is populated, whole season, from the release files (no calls)", "",
         "FBS-vs-FBS games with status final in the release schedule. A game is 'stat-crew text' when most "
         "of its play texts start with a clock in brackets, e.g. `(14:58) No Huddle-Shotgun #7 K.Jackson "
         "pass incomplete ... QB hurried by #10 D.Hopkins`; otherwise it is ESPN's older short text "
         "(`Joey Aguilar pass complete to Mike Matthews for 5 yds`), which never names a hurry. "
         "Cells: share of games with at least one play carrying the role / mean plays per game.", ""]
    roles = ["tackler", "assisted_by", "sacked_by", "pass_defender", "forced_by", "fumbler", "recoverer",
             "passer", "rusher", "receiver"]
    head = "| season | text format | games | " + " | ".join(roles) + " | release `qb_hurry` plays |"
    L += [head, "|" + "---|" * (len(roles) + 4)]
    for season in (2025, 2026):
        fbs = fbs_ids(season)
        sch = pd.read_parquet(RAW / "espn_cfb_schedules" / f"cfb_schedule_{season}.parquet",
                              columns=["game_id", "home_id", "away_id", "status"])
        sch = sch[sch.home_id.isin(fbs) & sch.away_id.isin(fbs) & sch.status.str.contains("FINAL", case=False, na=False)]
        gids = set(sch.game_id)
        pb = pd.read_parquet(RAW / "espn_cfb_pbp" / f"play_by_play_{season}.parquet",
                             columns=["game_id", "text", "qb_hurry"])
        pb = pb[pb.game_id.isin(gids)]
        pb["crew"] = pb.text.fillna("").str.match(r"^\(\d\d?:\d\d\)")
        g = pb.groupby("game_id").agg(crew=("crew", "mean"), hurry=("qb_hurry", "sum"), plays=("text", "size"))
        del pb
        g["fmt"] = (g.crew > 0.5).map({True: "stat-crew text", False: "short text"})
        pp = pd.read_parquet(RAW / "espn_cfb_play_participants" / f"play_participants_{season}.parquet",
                             columns=["game_id"] + [r + "_player_id" for r in roles])
        pp = pp[pp.game_id.isin(gids)]
        cnt = pp.groupby("game_id")[[r + "_player_id" for r in roles]].count()
        g = g.join(cnt, how="left").fillna(0)
        missing = len(gids - set(g.index))
        for fmt, d in list(g.groupby("fmt")) + [("all", g)]:
            cells = [f"{100 * (d[r + '_player_id'] > 0).mean():.0f}% / {d[r + '_player_id'].mean():.1f}"
                     for r in roles]
            L.append(f"| {season} | {fmt} | {len(d)} | " + " | ".join(cells) +
                     f" | {100 * (d.hurry > 0).mean():.0f}% / {d.hurry.mean():.1f} |")
        if missing:
            L.append(f"| {season} | (final FBS-vs-FBS games with no release pbp) | {missing} | " +
                     " | ".join([""] * (len(roles) + 1)) + " |")
        print(f"release coverage {season}: {len(g)} games with pbp, {missing} final FBS-vs-FBS games without, "
              f"{(g.fmt == 'stat-crew text').sum()} stat-crew format")
    L.append("")
    return L


CONFS = {5: "Big Ten", 4: "Big 12", 1: "ACC", 151: "American", 17: "Mountain West", 15: "MAC",
         37: "Sun Belt", 12: "Conference USA"}
PER_CONF = 2
MISSING = {2021: [401282608, 401309842, 401281943, 401282612],
           2022: [401426562, 401405084, 401415623, 401415029]}


def conference_sample(dates_used):
    """Second sample: two final FBS-vs-FBS games per date for each of eight conferences."""
    picks = []                                   # (season, conf name, event id, short name)
    for season, d in dates_used.items():
        sb = fetch(SB.format(d=d), f"scoreboard_{d}")
        tf = pd.read_parquet(RAW / "espn_cfb_teams" / f"cfb_teams_{season}.parquet",
                             columns=["team_id", "conference_id", "conference_short_name"]).set_index("team_id")
        got = Counter()
        for e in pick_games(sb, season):         # already sorted by event id, final, FBS-vs-FBS
            home = next(x for x in e["competitions"][0]["competitors"] if x["homeAway"] == "home")
            cid = int(home["team"].get("conferenceId") or -1)
            file_cid = int(tf.conference_id[int(home["team"]["id"])])
            if cid != file_cid:
                print(f"!! {e['id']}: scoreboard conferenceId {cid} vs teams file {file_cid}")
            if cid in CONFS and got[cid] < PER_CONF:
                got[cid] += 1
                picks.append((season, CONFS[cid], e["id"], e["shortName"]))
    summ = dict(zip([g[2] for g in picks],
                    pmap(lambda g: fetch(SUMMARY.format(e=g[2]), f"summary_{g[2]}"), picks)))
    pl = dict(zip([g[2] for g in picks], pmap(lambda g: all_plays(g[2]), picks)))

    rel = {}
    for season in dates_used:
        gids = [int(g[2]) for g in picks if g[0] == season]
        pp = pd.read_parquet(RAW / "espn_cfb_play_participants" / f"play_participants_{season}.parquet",
                             filters=[("game_id", "in", gids)])
        rel[season] = pp.set_index("play_id")
    rel_roles = sorted(c[:-len("_player_ids")] for c in rel[2026].columns if c.endswith("_player_ids"))

    A = defaultdict(Counter)                     # (conf, season) -> counters
    types = Counter()
    game_rows = []
    for season, conf, eid, name in picks:
        a = A[(conf, season)]
        first, items = pl[eid]
        pp = rel[season]
        pp = pp[pp.game_id == int(eid)]
        a["games"] += 1
        a["plays"] += len(items)
        g = Counter()
        crew = 0
        for p in items:
            roles = defaultdict(list)
            for part in sorted(p.get("participants", []), key=lambda x: x.get("order", 0)):
                types[part.get("type")] += 1
                if ath_id(part) is None:
                    a["no_id"] += 1
                else:
                    roles[part.get("type")].append(ath_id(part))
            tt = (p.get("type") or {}).get("text", "")
            crew += bool(re.match(r"^\(\d\d?:\d\d\)", p.get("text") or ""))
            if tt in ("Rush", "Rushing Touchdown"):
                a["rush"] += 1
                a["rush_ok"] += "rusher" in roles
            if tt in ("Pass Reception", "Passing Touchdown"):
                a["comp"] += 1
                a["comp_ok"] += "receiver" in roles
            if tt == "Sack":
                a["sack"] += 1
                a["sack_ok"] += "sackedBy" in roles
            if "Intercept" in tt:
                a["int"] += 1
                a["int_ok"] += "passDefender" in roles
                if tt == "Interception":          # no return
                    a["int_noret"] += 1
                    a["int_noret_ok"] += "passDefender" in roles
            if tt == "Sack" and "sackedBy" not in roles:
                a["sack_passer_only"] += set(roles) <= {"passer"}
            if tt in ("Rush", "Pass Reception"):
                a["tkl"] += 1
                a["tkl_ok"] += ("tackler" in roles or "assistedBy" in roles)
            pid = int(p["id"])
            if roles:
                g["live_with"] += 1
                g["live_with_in_rel"] += pid in pp.index
            if pid in pp.index:
                row = pp.loc[pid]
                for sn in rel_roles:
                    live_ids = next((v for k, v in roles.items() if snake(k) == sn), [])
                    rel_ids = ids_of(row[sn + "_player_ids"])
                    if live_ids or rel_ids:
                        g["cells"] += 1
                        g["cells_eq"] += set(live_ids) == set(rel_ids)
                        if set(live_ids) != set(rel_ids):
                            a["diff_" + ("release only" if not live_ids else "live only" if not rel_ids
                                         else "different id")] += 1
                unmapped = [k for k in roles if snake(k) not in rel_roles]
                a["unmapped"] += len(unmapped)
        a["stat_crew_games"] += crew > 0.5 * len(items)
        a["rel_rows"] += len(pp)
        a["rel_not_live"] += len(set(pp.index) - {int(p["id"]) for p in items})
        for k in ("live_with", "live_with_in_rel", "cells", "cells_eq"):
            a[k] += g[k]
        a["in_release"] += len(pp) > 0
        sm = summ[eid]
        hur_key, hur_total = False, 0.0
        for t in (sm.get("boxscore") or {}).get("players") or []:
            for c in t.get("statistics", []):
                if c["name"] == "defensive" and "hurries" in c.get("keys", []):
                    hur_key = True
                    i = c["keys"].index("hurries")
                    for at in c.get("athletes", []):
                        try:
                            hur_total += float(at["stats"][i])
                        except (ValueError, IndexError, TypeError):
                            pass
        a["hur_key"] += hur_key
        a["hur_pos"] += hur_total > 0
        a["pick"] += bool(sm.get("pickcenter"))
        game_rows.append(f"| {season} | {conf} | {eid} {name} | {len(items)} | {g['live_with']} | {len(pp)} | "
                         f"{g['live_with_in_rel']} | {pct(g['cells_eq'], g['cells'])} ({g['cells']}) | "
                         f"{'stat-crew' if crew > 0.5 * len(items) else 'short'} | {hur_total:g} |")

    live_types = sorted(t for t in types if t)
    unm = [t for t in live_types if snake(t) not in rel_roles]
    L = ["## 5. Second sample: by conference", "",
         f"Same two scoreboard dates. For each of eight conferences, the first {PER_CONF} final FBS-vs-FBS games "
         "by event id where the **home** team belongs to the conference (the home school's stat crew produces "
         "the play text). Conference is the scoreboard competitor's `team.conferenceId`, which matched "
         "`conference_id` in the release `espn_cfb_teams` file for every FBS team on both dates. "
         f"{len(picks)} games: " +
         ", ".join(f"{c} {sum(1 for g in picks if g[1] == c and g[0] == 2025)}+{sum(1 for g in picks if g[1] == c and g[0] == 2026)}"
                   for c in CONFS.values()) + " (2025+2026).", "",
         f"Participant `type` values seen across these games ({len(live_types)}): " +
         ", ".join(f"{t} {types[t]}" for t in live_types) + ". "
         f"Types with no release column: {', '.join(unm) or 'none'}. "
         f"Participants without an athlete id: {sum(a['no_id'] for a in A.values())}.", "",
         "Coverage columns: rusher on rushes (types Rush, Rushing Touchdown); receiver on completions (Pass "
         "Reception, Passing Touchdown); sackedBy on type Sack; passDefender on any type containing 'Intercept'; "
         "tackler or assistedBy on non-scoring rushes and completions (Rush, Pass Reception; out-of-bounds plays "
         "are in the denominator). Cells are share (denominator).", "",
         "| conference | season | games | plays | rusher on rushes | receiver on completions | sackedBy on sacks | "
         "passDefender on INTs | tackler/assist on rush+completion | box has `hurries` key | box hurries > 0 | "
         "pickcenter | stat-crew text games |", "|" + "---|" * 13]

    def cov_row(label, season, a):
        return (f"| {label} | {season} | {a['games']} | {a['plays']} | {pct(a['rush_ok'], a['rush'])} ({a['rush']}) | "
                f"{pct(a['comp_ok'], a['comp'])} ({a['comp']}) | {pct(a['sack_ok'], a['sack'])} ({a['sack']}) | "
                f"{pct(a['int_ok'], a['int'])} ({a['int']}) | {pct(a['tkl_ok'], a['tkl'])} ({a['tkl']}) | "
                f"{a['hur_key']}/{a['games']} | {a['hur_pos']}/{a['games']} | {a['pick']}/{a['games']} | "
                f"{a['stat_crew_games']}/{a['games']} |")

    tot = {2025: Counter(), 2026: Counter()}
    for conf in CONFS.values():
        for season in (2025, 2026):
            if (conf, season) in A:
                L.append(cov_row(conf, season, A[(conf, season)]))
                tot[season].update(A[(conf, season)])
    for season in (2025, 2026):
        L.append(cov_row("**all eight**", season, tot[season]))
    L += ["", "What is missing when a defender is missing:", ""]
    for season in (2025, 2026):
        t = tot[season]
        L.append(f"- {season}: {t['int'] - t['int_ok']} of {t['int']} interception plays lack `passDefender`; "
                 f"interceptions with no return (type `Interception`) carry it on {t['int_noret_ok']} of "
                 f"{t['int_noret']}, those with a return on {t['int_ok'] - t['int_noret_ok']} of "
                 f"{t['int'] - t['int_noret']}. {t['sack'] - t['sack_ok']} of {t['sack']} sacks lack `sackedBy`; "
                 f"{t['sack_passer_only']} of those carry only the `passer`.")
    L += ["- In the 2026 stat-crew games the missing interceptor or sacker is still named in the play text "
          "(`pass intercepted by #14 J.Sensabaugh ... End Of Play`, `sacked for loss of 6 yards ... (#53 "
          "J.Warren, Jr.)`); in the 2025 short-text games a sack with no `sackedBy` names nobody "
          "(`Kevin Jennings sacked for a loss of 5 yards`). Examples read by hand, not counted.",
          "- The eight conferences' games were short text in 2025 (0 of 14 stat-crew) and stat-crew text in 2026 "
          "(14 of 14), the same split as the SEC sample, so season and text format cannot be separated here; "
          "table (e) does that across the whole season.",
          "", "Agreement with the release participants file, same games:", "",
          "| conference | season | games in release | live plays with participants | of those in release | "
          "release rows not in live | play-role cells | identical | release only | live only | different id |",
          "|" + "---|" * 11]

    def agr_row(label, season, a):
        return (f"| {label} | {season} | {a['in_release']}/{a['games']} | {a['live_with']} | {a['live_with_in_rel']} | "
                f"{a['rel_not_live']} | {a['cells']} | {pct(a['cells_eq'], a['cells'])} | {a['diff_release only']} | "
                f"{a['diff_live only']} | {a['diff_different id']} |")
    for conf in CONFS.values():
        for season in (2025, 2026):
            if (conf, season) in A:
                L.append(agr_row(conf, season, A[(conf, season)]))
    for season in (2025, 2026):
        L.append(agr_row("**all eight**", season, tot[season]))
    L += ["", "Per game:", "",
          "| season | conference (home) | event | live plays | live plays with participants | release participant "
          "rows | live-with-participants in release | cells identical (cells) | text format | box hurries |",
          "|" + "---|" * 10] + game_rows + [""]
    for season in (2025, 2026):
        t = tot[season]
        print(f"conference sample {season}: {t['games']} games, cells identical {t['cells_eq']}/{t['cells']}, "
              f"tackler coverage {pct(t['tkl_ok'], t['tkl'])}, sackedBy {pct(t['sack_ok'], t['sack'])}, "
              f"stat-crew games {t['stat_crew_games']}")
    return L, tot, [len(pl[g[2]][1]) for g in picks]


def espn_has_missing(min_plays, n_sampled):
    """Do the FBS games with no play-by-play in the release files have plays on ESPN today?"""
    ids = [(s, e) for s, es in MISSING.items() for e in es]
    summ = pmap(lambda x: fetch(SUMMARY.format(e=x[1]), f"summary_{x[1]}"), ids)
    core = pmap(lambda x: fetch(PLAYS.format(e=x[1], p=1), f"plays_{x[1]}_p1"), ids)
    print("missing-game summary keys:", list(summ[0].keys()))
    print("missing-game core plays keys:", {k: (v if not isinstance(v, list) else f"list[{len(v)}]")
                                            for k, v in core[0].items()})
    L = ["## 6. Games missing from the release files", "",
         "Eight FBS games with no play-by-play in the release files, asked of ESPN today (summary, and the first "
         "page of the core plays endpoint with `limit=300`).", "",
         "| season | event | game | status | summary `drives` | plays inside drives | `winprobability` rows | "
         "`scoringPlays` | box player categories | core plays `count` | core items with participants |",
         "|" + "---|" * 11]
    have = 0
    for (season, eid), sm, cp in zip(ids, summ, core):
        if "_http_status" in sm:
            name, status = f"(summary HTTP {sm['_http_status']})", ""
        else:
            comp = ((sm.get("header") or {}).get("competitions") or [{}])[0]
            side = {x.get("homeAway"): x for x in comp.get("competitors", [])}
            name = (f"{side.get('away', {}).get('team', {}).get('abbreviation', '?')} "
                    f"{side.get('away', {}).get('score', '?')} at "
                    f"{side.get('home', {}).get('team', {}).get('abbreviation', '?')} "
                    f"{side.get('home', {}).get('score', '?')}, {str(comp.get('date', ''))[:10]}")
            status = ((comp.get("status") or {}).get("type") or {}).get("name", "")
        dr = (sm.get("drives") or {}).get("previous") or []
        box = (sm.get("boxscore") or {}).get("players") or []
        ncat = max((len(t.get("statistics", [])) for t in box), default=0)
        cnt = cp.get("count") if "_http_status" not in cp else f"HTTP {cp['_http_status']}"
        items = cp.get("items", [])
        have += bool(cnt) and cnt != 0 and not str(cnt).startswith("HTTP")
        L.append(f"| {season} | {eid} | {name} | {status} | {len(dr)} | {sum(len(d.get('plays', [])) for d in dr)} | "
                 f"{len(sm.get('winprobability') or [])} | {len(sm.get('scoringPlays') or [])} | {ncat} | {cnt} | "
                 f"{sum(1 for p in items if p.get('participants'))} |")
    concl = ("ESPN has plays for all eight" if have == len(ids) else
             "ESPN lacks plays for all eight too" if have == 0 else
             f"ESPN has plays for {have} of the eight and lacks the rest")
    counts = [cp.get("count") or 0 for cp in core]
    short = [str(e) for (s_, e), c in zip(ids, counts) if 0 < c < min_plays]
    no_drives = sum(1 for sm in summ if not ((sm.get("drives") or {}).get("previous")))
    concl += (f" on the core plays endpoint (`count` {min(counts)}-{max(counts)}), but the summary has no `drives` "
              f"and no win probability for {no_drives} of them")
    if short:
        concl += (f"; {len(short)} have fewer plays than any of the {n_sampled} complete games sampled above "
                  f"(minimum {min_plays}), so they may be partial: {', '.join(short)}")
    L += ["", f"**Conclusion: {concl}.**", ""]
    print("missing games:", concl)
    return L, concl


def pct(a, b):
    return "n/a" if not b else f"{100 * a / b:.1f}%"


def main():
    L = ["# ESPN live check (step 3)", "",
         "Generated by `python -m pipeline.cfb.espn_live`. ESPN only; every response cached under "
         "`~/College-Football-Savant/raw/espn_live/`; calls logged to `logs/espn_live.log`.", ""]

    # ---- 1. scoreboards -------------------------------------------------------------
    L += ["## 1. Scoreboards (FBS group 80)", "",
          "| season | date | events | final | final FBS-vs-FBS | week |", "|---|---|---|---|---|---|"]
    chosen = {}
    printed_fields = False
    for season, dates in DATES.items():
        for d in dates:
            sb = fetch(SB.format(d=d), f"scoreboard_{d}")
            ev = sb.get("events", [])
            if not printed_fields and ev:
                c = ev[0]["competitions"][0]
                print("scoreboard keys:", list(sb.keys()))
                print("event keys:", list(ev[0].keys()))
                print("competition keys:", list(c.keys()))
                print("competitor keys:", list(c["competitors"][0].keys()))
                printed_fields = True
            finals = [e for e in ev if e["status"]["type"].get("completed")]
            ff = pick_games(sb, season)
            L.append(f"| {season} | {d} | {len(ev)} | {len(finals)} | {len(ff)} | "
                     f"{(sb.get('week') or {}).get('number')} |")
            print(f"scoreboard {d}: {len(ev)} events, {len(finals)} final, {len(ff)} final FBS-vs-FBS")
            if ff:
                chosen[season] = (d, ff[:N_GAMES])
                break
    L += ["", "FBS membership is `is_fbs` in the release file `espn_cfb_teams/cfb_teams_{season}.parquet` "
          "(the scoreboard's group 80 also returns FBS-vs-FCS games).", "",
          "Games used (first five final FBS-vs-FBS by event id):", "",
          "| season | event id | game |", "|---|---|---|"]
    games = []
    for season, (d, evs) in chosen.items():
        for e in evs:
            games.append((season, e["id"], e["shortName"]))
            L.append(f"| {season} | {e['id']} | {e['shortName']} |")
    L.append("")

    # ---- 2. summaries + plays ----------------------------------------------------------
    summaries = dict(zip([g[1] for g in games],
                         pmap(lambda g: fetch(SUMMARY.format(e=g[1]), f"summary_{g[1]}"), games)))
    plays = dict(zip([g[1] for g in games], pmap(lambda g: all_plays(g[1]), games)))

    sample = next(p for p in plays[games[0][1]][1] if len(p.get("participants", [])) >= 2)
    print("\nplay fields:", list(sample.keys()))
    print("participant fields:", list(sample["participants"][0].keys()))
    L += ["## 2. Core play-by-play: fields and participant roles", "",
          f"Fields of one play (event {games[0][1]}, play {sample['id']}): `{', '.join(sample.keys())}`.", "",
          f"Fields of one participant: `{', '.join(sample['participants'][0].keys())}`. The athlete id is "
          "not a field; it is the number in `athlete.$ref` (`.../seasons/{season}/athletes/{id}`). "
          "`stats` on a participant is that player's game total at that moment, not the play's stat line.", ""]

    live = {}        # (season, eid) -> {play_id: {role: [ids in order]}}
    live_meta = {}   # eid -> {play_id: play}
    role_n = {2025: Counter(), 2026: Counter()}
    role_noid = {2025: Counter(), 2026: Counter()}
    for season, eid, _ in games:
        first, items = plays[eid]
        d, meta = {}, {}
        for p in items:
            roles = defaultdict(list)
            for part in sorted(p.get("participants", []), key=lambda x: x.get("order", 0)):
                t = part.get("type")
                role_n[season][t] += 1
                a = ath_id(part)
                if a is None:
                    role_noid[season][t] += 1
                else:
                    roles[t].append(a)
            d[int(p["id"])] = dict(roles)
            meta[int(p["id"])] = p
        live[(season, eid)] = d
        live_meta[eid] = meta
        if len(d) != int(first.get("count", -1)):
            print(f"!! {eid}: got {len(d)} plays, feed says count={first.get('count')}")

    live_roles = sorted(set(role_n[2025]) | set(role_n[2026]))
    pp_schema = pd.read_parquet(RAW / "espn_cfb_play_participants" / "play_participants_2026.parquet",
                                filters=[("game_id", "==", -1)])
    rel_roles = sorted(c[:-len("_player_ids")] for c in pp_schema.columns if c.endswith("_player_ids"))
    print("\nlive participant types:", {s: dict(role_n[s]) for s in role_n})
    print("release roles:", rel_roles)

    L += ["### Participant `type` values seen (5 games per season)", "",
          "| live `type` | 2025 count | 2026 count | missing athlete id | release column | in release schema |",
          "|---|---|---|---|---|---|"]
    for r in live_roles:
        col = snake(r) + "_player_ids"
        L.append(f"| {r} | {role_n[2025][r]} | {role_n[2026][r]} | "
                 f"{role_noid[2025][r] + role_noid[2026][r]} | `{snake(r)}_player_id(s)` | "
                 f"{'yes' if snake(r) in rel_roles else 'NO'} |")
    not_seen = [r for r in rel_roles if r not in {snake(x) for x in live_roles}]
    L += ["", f"Release roles (`*_player_ids` columns): {', '.join(rel_roles)}.", "",
          f"Release roles not seen live in these 10 games: {', '.join(not_seen) or 'none'}.", "",
          f"Live roles with no release column: "
          f"{', '.join(r for r in live_roles if snake(r) not in rel_roles) or 'none'}.", ""]

    # ---- 3. compare with release files ----------------------------------------------------
    L += ["## 3. Live feed vs release files", "", "### (b) Play counts per game", "",
          "| season | event | live plays | live plays with participants | release pbp rows | "
          "pbp ids in live | release participant rows | participant ids in live | live-with-participants ids in release |",
          "|---|---|---|---|---|---|---|---|---|"]
    agree = {s: defaultdict(lambda: Counter()) for s in (2025, 2026)}
    pbp_agree = {s: defaultdict(lambda: Counter()) for s in (2025, 2026)}
    mism = []
    int_roles, hurry, tfl = Counter(), Counter(), Counter()
    int_match = Counter()
    missing_games = []
    for season, eid, name in games:
        gid = int(eid)
        pp = pd.read_parquet(RAW / "espn_cfb_play_participants" / f"play_participants_{season}.parquet",
                             filters=[("game_id", "==", gid)])
        pb = pd.read_parquet(RAW / "espn_cfb_pbp" / f"play_by_play_{season}.parquet",
                             columns=PBP_COLS, filters=[("game_id", "==", gid)])
        lv = live[(season, eid)]
        lv_with = {k for k, v in lv.items() if v}
        if pp.empty and pb.empty:
            missing_games.append((season, eid, name))
        L.append(f"| {season} | {eid} {name} | {len(lv)} | {len(lv_with)} | {len(pb)} | "
                 f"{len(set(pb['id']) & set(lv))} | {len(pp)} | {len(set(pp.play_id) & set(lv))} | "
                 f"{len(lv_with & set(pp.play_id))} |")

        # (c) participants file, per role
        pp = pp.set_index("play_id")
        by_snake = {snake(r): r for r in live_roles}
        for pid in set(pp.index) & set(lv):
            row = pp.loc[pid]
            for sn in sorted(set(by_snake) | set(rel_roles)):
                col = sn + "_player_ids"
                rel_ids = ids_of(row[col]) if col in pp.columns else []
                live_ids = lv[pid].get(by_snake.get(sn), [])
                if not rel_ids and not live_ids:
                    continue
                a = agree[season][sn]
                a["plays"] += 1
                a["live_has"] += bool(live_ids)
                a["rel_has"] += bool(rel_ids)
                a["list_eq"] += live_ids == rel_ids
                a["set_eq"] += set(live_ids) == set(rel_ids)
                one = row.get(sn + "_player_id")
                one = None if pd.isna(one) else str(one)
                a["first_eq"] += (one == (live_ids[0] if live_ids else None))
                if set(live_ids) != set(rel_ids):
                    mism.append((season, eid, pid, sn, live_ids, rel_ids))

        # release pbp derived columns vs live roles
        for _, row in pb.iterrows():
            pid = int(row["id"])
            if pid not in lv:
                continue
            p = lv[pid]
            for col, role in PBP_ROLE.items():
                v = row[col]
                v = None if pd.isna(v) else str(int(v))
                lids = p.get(role, [])
                if v is None and not lids:
                    continue
                a = pbp_agree[season][col]
                a["plays"] += 1
                a["rel_has"] += v is not None
                a["live_has"] += bool(lids)
                a["eq"] += (v in lids) if v is not None else False
            # interception: which live role carries the intercepting defender?
            v = row["interception_player_id"]
            if not pd.isna(v):
                v = str(int(v))
                hit = [r for r, ids in p.items() if v in ids]
                int_match["release interception_player_id set"] += 1
                for r in hit or ["(no live participant has that id)"]:
                    int_match[r] += 1
            if bool(row["qb_hurry"]):
                hurry["release qb_hurry=True plays"] += 1
                txt = (live_meta[eid][pid].get("text") or "")
                hurry["... live text mentions 'hurr'"] += bool(re.search(r"hurr", txt, re.I))
                for r in p:
                    hurry[f"... live roles on those plays: {r}"] += 1

        # live-side evidence on interceptions, hurries and tackles for loss
        for pid, p in lv.items():
            m = live_meta[eid][pid]
            tt = (m.get("type") or {}).get("text", "")
            txt = m.get("text") or ""
            if re.search(r"intercept", tt, re.I):
                int_roles["interception plays (by play type)"] += 1
                for r in p:
                    int_roles[r] += 1
            if re.search(r"hurr", txt, re.I):
                hurry["live plays whose text mentions 'hurr'"] += 1
            if tt == "Rush" and (m.get("statYardage") or 0) < 0:
                tfl["live rushes with statYardage < 0"] += 1
                for r in p:
                    tfl[f"... roles: {r}"] += 1

    if missing_games:
        L += ["", "**Games missing from the release files:** " +
              ", ".join(f"{s} {e} {n}" for s, e, n in missing_games) + "."]
    L += ["", "Release pbp drops rows the live feed keeps (timeouts, end-of-period markers) and the "
          "participants file only has rows for plays that carry at least one participant, so the right "
          "test is the last column: every live play with a participant should be in the release file.", ""]

    L += ["### (c) Id agreement per role, plays matched on play id (participants file)", "",
          "Denominator: matched plays where either side has the role. `list` = same ids in the same "
          "order (duplicates kept); `set` = same set of ids; `first` = release `{role}_player_id` equals "
          "the first live id.", "",
          "| role | season | plays | live has | release has | list equal | set equal | first equal |",
          "|---|---|---|---|---|---|---|---|"]
    tot = Counter()
    for sn in sorted(set(agree[2025]) | set(agree[2026])):
        for s in (2025, 2026):
            a = agree[s][sn]
            if not a["plays"]:
                continue
            for k, v in a.items():
                tot[k] += v
            L.append(f"| {sn} | {s} | {a['plays']} | {a['live_has']} | {a['rel_has']} | "
                     f"{pct(a['list_eq'], a['plays'])} | {pct(a['set_eq'], a['plays'])} | "
                     f"{pct(a['first_eq'], a['plays'])} |")
    L += [f"| **all roles** | both | {tot['plays']} | {tot['live_has']} | {tot['rel_has']} | "
          f"{pct(tot['list_eq'], tot['plays'])} | {pct(tot['set_eq'], tot['plays'])} | "
          f"{pct(tot['first_eq'], tot['plays'])} |", ""]
    print(f"\nparticipants id agreement, all roles: {tot['set_eq']}/{tot['plays']} set-equal, "
          f"{tot['list_eq']}/{tot['plays']} list-equal")
    if mism:
        ro = pd.read_parquet(RAW / "espn_cfb_rosters" / "cfb_rosters_2026.parquet",
                             columns=["athlete_id", "display_name", "jersey", "team_abbreviation"])
        ro = ro.drop_duplicates("athlete_id").set_index("athlete_id")

        def nm(i):
            i = int(i)
            if i not in ro.index:
                return str(i)
            return f"{i} {ro.display_name[i]} #{ro.jersey[i]} {ro.team_abbreviation[i]}"

        by_game = Counter((m[0], m[1]) for m in mism)
        L += [f"{len(mism)} play-role disagreements, in " +
              ", ".join(f"{e} ({n})" for (s_, e), n in sorted(by_game.items())) + ". Each one below, with "
              "the play text and what the single-play endpoint (`.../plays/{id}`) returns today for that "
              "role (to rule out a paging artifact of the list endpoint):", "",
              "| event | play | role | live ids | release ids | single-play endpoint | play text |",
              "|---|---|---|---|---|---|---|"]
        single_url = ("https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/"
                      "events/{e}/competitions/{e}/plays/{p}")
        uniq = sorted({(m[1], m[2]) for m in mism})
        singles = dict(zip(uniq, pmap(lambda k: fetch(single_url.format(e=k[0], p=k[1]), f"play_{k[1]}"),
                                      uniq)))
        for season, eid, pid, sn, live_ids, rel_ids in sorted(mism):
            sp = singles[(eid, pid)]
            sp_ids = [ath_id(x) for x in sp.get("participants", []) if snake(x.get("type", "")) == sn]
            txt = (live_meta[eid][pid].get("text") or "").replace("|", "/")[:170]
            L.append(f"| {eid} | {pid} | {sn} | {'; '.join(nm(i) for i in live_ids) or 'none'} | "
                     f"{'; '.join(nm(i) for i in rel_ids) or 'none'} | "
                     f"{'; '.join(nm(i) for i in sp_ids) or 'none'} | {txt} |")
        L.append("")

    L += ["### (c2) Release pbp derived id columns vs live roles", "",
          "`eq` = the release pbp id is among the live ids for that role, over plays where either has one.", "",
          "| release pbp column | live role | season | plays | release has | live has | eq |",
          "|---|---|---|---|---|---|---|"]
    for col, role in PBP_ROLE.items():
        for s in (2025, 2026):
            a = pbp_agree[s][col]
            if a["plays"]:
                L.append(f"| `{col}` | {role} | {s} | {a['plays']} | {a['rel_has']} | {a['live_has']} | "
                         f"{pct(a['eq'], a['plays'])} |")
    L.append("")

    L += ["### (d) Roles one side has and the other lacks: interceptions, hurries, tackles for loss", "",
          "Interceptions, live side (participant roles present on plays whose type contains 'Intercept'):", ""]
    L += [f"- {k}: {v}" for k, v in int_roles.most_common()] + [""]
    L += ["Which live role holds the release pbp `interception_player_id`:", ""]
    L += [f"- {k}: {v}" for k, v in int_match.most_common()] + [""]
    L += ["QB hurries:", ""]
    L += [f"- {k}: {v}" for k, v in sorted(hurry.items()) if not k.startswith("...")]
    L += [f"- {k}: {v}" for k, v in sorted(hurry.items()) if k.startswith("...")] + [""]
    L += ["No participant role names the hurrying defender in either source. On the hurried plays the only "
          "defensive roles are `passDefender` (a break-up or interception on the same play) and `sackedBy`; "
          "the hurrier's name is in the play text only (`QB hurried by #10 D.Hopkins`), and only in "
          "stat-crew-format games. The box score carries `hurries` per player per game.", ""]
    L += ["Tackles for loss (no dedicated role on either side; a TFL is a tackler/assistedBy on a play "
          "with negative yardage):", ""]
    L += [f"- {k}: {v}" for k, v in sorted(tfl.items())] + [""]

    L += release_coverage()

    # ---- 4. summary contents ----------------------------------------------------------------
    s0 = summaries[games[0][1]]
    print("\nsummary keys:", list(s0.keys()))
    L += ["## 4. Summary endpoint", "", f"Top-level keys: `{', '.join(s0.keys())}`.", "",
          "| season | event | pickcenter (providers) | odds | drives | plays in drives | winprobability rows | "
          "box categories | scoringPlays |", "|---|---|---|---|---|---|---|---|---|"]
    cats, def_keys, pc_fields = Counter(), Counter(), None
    for season, eid, name in games:
        s = summaries[eid]
        pc = s.get("pickcenter") or []
        prov = ", ".join(sorted({(x.get("provider") or {}).get("name", "?") for x in pc})) or "none"
        if pc and pc_fields is None:
            pc_fields = list(pc[0].keys())
        dr = (s.get("drives") or {}).get("previous") or []
        box = (s.get("boxscore") or {}).get("players") or []
        cs = set()
        for t in box:
            for c in t.get("statistics", []):
                cs.add(c["name"])
                cats[c["name"]] += 1
                if c["name"] == "defensive":
                    for k in c.get("keys", []):
                        def_keys[k] += 1
        L.append(f"| {season} | {eid} {name} | {len(pc)} ({prov}) | {len(s.get('odds') or [])} | {len(dr)} | "
                 f"{sum(len(d.get('plays', [])) for d in dr)} | {len(s.get('winprobability') or [])} | "
                 f"{len(cs)} | {len(s.get('scoringPlays') or [])} |")
    L += ["", f"`pickcenter[0]` fields: `{', '.join(pc_fields or [])}`.", "",
          f"Box score player categories (count of team-game blocks out of {2 * len(games)}): " +
          ", ".join(f"{k} ({v})" for k, v in cats.most_common()) + ".", "",
          "Defensive stat keys: " + ", ".join(f"`{k}` ({v})" for k, v in def_keys.most_common()) + ".", ""]
    b = (s0.get("boxscore") or {}).get("players") or []
    for t in b[:1]:
        for c in t.get("statistics", []):
            L.append(f"- `{c['name']}`: {', '.join(c.get('keys', []))}")
    L.append("")
    wp = s0.get("winprobability") or []
    if wp:
        L += [f"`winprobability[0]` fields: `{', '.join(wp[0].keys())}` (keyed by play id).", ""]

    # box-score hurries vs release qb_hurry flag, as a cross-check on hurry attribution
    L += ["Box score `hurries` totals (both teams) per game, next to plays the release pbp flags "
          "`qb_hurry`:", "", "| season | event | box hurries | box TFL | box PD | release qb_hurry plays |",
          "|---|---|---|---|---|---|"]
    for season, eid, name in games:
        s = summaries[eid]
        agg = Counter()
        for t in (s.get("boxscore") or {}).get("players") or []:
            for c in t.get("statistics", []):
                if c["name"] != "defensive":
                    continue
                keys = c.get("keys", [])
                for a in c.get("athletes", []):
                    for k, v in zip(keys, a.get("stats", [])):
                        try:
                            agg[k] += float(v)
                        except (TypeError, ValueError):
                            pass
        pb = pd.read_parquet(RAW / "espn_cfb_pbp" / f"play_by_play_{season}.parquet",
                             columns=["game_id", "qb_hurry"], filters=[("game_id", "==", int(eid))])
        L.append(f"| {season} | {eid} {name} | {agg.get('hurries', 0):g} | {agg.get('tacklesForLoss', 0):g} | "
                 f"{agg.get('passesDefended', 0):g} | {int(pb.qb_hurry.sum()) if len(pb) else 'n/a'} |")
    L.append("")

    L5, conf_tot, conf_counts = conference_sample({s_: d_ for s_, (d_, _) in chosen.items()})
    L += L5
    sampled = conf_counts + [len(v) for v in live.values()]
    L6, missing_concl = espn_has_missing(min(sampled), len(sampled))
    L += L6

    # ---- calls and latency ----------------------------------------------------------------------
    mine = set(URLS)
    lat, bad = [], 0
    for line in open(LOG):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 6 and parts[5] in mine:
            lat.append(float(parts[3].rstrip("ms")))
            bad += parts[2] != "200"
    lat.sort()
    n_all, med_all, p95_all, err_all = log_stats()
    if lat:
        med = lat[len(lat) // 2]
        p95 = lat[min(len(lat) - 1, int(round(0.95 * (len(lat) - 1))))]
        L += ["## Calls and latency", "",
              f"- Step 3 documents requested: {len(mine)} distinct URLs (scoreboards, summaries, play-list pages for all three samples, and one single-play lookup per disagreeing play in the first sample); "
              f"network calls logged for them: {len(lat)} ({bad} non-200 or errors).",
              f"- Latency for those calls: median {med:.0f} ms, p95 {p95:.0f} ms, max {lat[-1]:.0f} ms.",
              f"- Whole log at the time of writing (all three modules, GET and HEAD): {n_all} calls, "
              f"median {med_all:.0f} ms, p95 {p95_all:.0f} ms, {err_all} non-200.",
              "- Never more than 6 requests in flight (one process-wide semaphore in `espn_http.py`).", ""]
        print(f"step-3 calls: {len(lat)}, median {med:.0f} ms, p95 {p95:.0f} ms; log total {n_all}")

    n_int = int_roles["interception plays (by play type)"]
    F = ["## Findings", "",
         f"- **Roles.** The live feed's {len(live_roles)} participant `type` values map one-to-one onto the "
         f"release file's {len(rel_roles)} `*_player_id(s)` column families (camelCase to snake_case). "
         f"Nothing on either side is unmapped. Every participant carried an athlete id "
         f"({sum(role_noid[2025].values()) + sum(role_noid[2026].values())} without).",
         "- **Play ids.** Same ids on both sides. Every release row matches a live play. Every live play that "
         "has a participant is in the release participants file, except one in 401856736 (play 401856736318, "
         "a rush wiped out by offsetting penalties, `NO PLAY`, absent from both release files). The live feed "
         "has 5-6 more plays per game than the release pbp.",
         "- **Betting lines.** `pickcenter` (DraftKings) is present for the five 2026 games and empty for the "
         "five 2025 games; `odds` is empty for all ten. Drives, win probability and the box score are present "
         "for all ten.",
         f"- **Athlete ids.** {tot['set_eq']} of {tot['plays']} play-role cells identical "
         f"({pct(tot['set_eq'], tot['plays'])}); 2025 games 100%. All {len(mism)} disagreements are in two "
         "2026 games: in 10 the release has a tackler/sacker the live feed no longer returns (the text names "
         "that player), and in 2 the live feed has since corrected a wrong-jersey id the release still holds. "
         "Cause not established (the release was scraped at some earlier moment; ESPN edits plays afterwards).",
         f"- **Interceptions.** The intercepting defender is `passDefender` and, when there is a return, also "
         f"`returner` (same id). {int_roles['passDefender']} of {n_int} interception plays had it; the "
         f"{n_int - int_roles['passDefender']} without were touchback interceptions with only a `passer`. "
         "`passDefender` therefore mixes break-ups and interceptions; the play type separates them.",
         "- **QB hurries.** No role in either source. Text only (stat-crew format), or the box score's "
         "per-player `hurries`.",
         "- **Tackles for loss.** No role in either source. Derive from `tackler`/`assistedBy` on plays with "
         "negative yardage, or take `tacklesForLoss` from the box score.",
         "- **Fumbles.** `forcedBy`, `fumbler`, `recoverer` appeared in the 2026 games and in none of the five "
         "2025 games, which were all in ESPN's short text format; see table (e) for the season-wide picture.",
         "- **Caveat on the sample.** The first five event ids on each date are all SEC games; section 5 "
         "repeats the comparison on two games per date for eight other conferences: "
         + "; ".join(f"{s_}: {conf_tot[s_]['games']} games, {pct(conf_tot[s_]['cells_eq'], conf_tot[s_]['cells'])} "
                     f"of {conf_tot[s_]['cells']} play-role cells identical, tackler/assist on "
                     f"{pct(conf_tot[s_]['tkl_ok'], conf_tot[s_]['tkl'])} of rushes and completions"
                     for s_ in (2025, 2026)) + ".",
         f"- **Games missing from the release files (section 6).** {missing_concl}.", ""]
    L[4:4] = F

    (OUT / "espn_live_check.md").write_text("\n".join(L) + "\n")
    print("wrote", OUT / "espn_live_check.md")


if __name__ == "__main__":
    main()
