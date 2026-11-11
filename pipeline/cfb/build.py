"""College Football Savant: the build.

    python -m pipeline.cfb.build history      # the Mac: 2014-2025 site files, careers, search, honours, preseason extras
    python -m pipeline.cfb.build refresh      # the season being played, from ESPN (what the cloud runs every day)
    python -m pipeline.cfb.build site         # the season being played, from tables already on disk (no fetching)
    python -m pipeline.cfb.build all          # history, then refresh

`history` needs the Mac: it reads every past season's tables and the identity table (recruits,
transfers, NFL ids), none of which leave ~/College-Football-Savant. What the current season
needs from all that is written to pipeline/cfb/state/ (state.py, and extras.json here), which
is committed. `refresh` reads only that and ESPN, so the cloud can run it, and a refresh gives
the same bytes as the Mac's build of the current season (`python -m pipeline.cfb.refresh_check`).
"""
import sys
import json
import numpy as np
import pandas as pd
from .paths import WORK, REPO
from . import config as C
from . import numbers as N
from . import site
from .state import load_state, DIR

EXTRAS = DIR / "extras.json"


def extras():
    return json.loads(EXTRAS.read_text()) if EXTRAS.exists() else {}


def volumes(D):
    """Each player's share of what his team did last season, for returning production."""
    F, slot = D["frames"]["_all"], dict(zip(D["players"].pid, D["players"].slot))
    parts = []
    for tab, col, kind in (("qb", "tot_plays", "off"), ("rush", "rush", "off"), ("rec", "tgt_eff", "off"), ("dfn", "e_tkl", "def")):
        d = F[tab]
        d = d[d.pid.map(slot).map(N.SLOT_TABLE) == tab]
        parts.append(d.groupby(["pid", "team"])[col].sum().rename("v").reset_index().assign(kind=kind))
    return pd.concat(parts, ignore_index=True)


def returning(vol_prev, ppl):
    """Share of last season's offensive touches (dropbacks, rushes, targets) and tackles that is back on the roster."""
    here = set(zip(ppl.pid, ppl.team))
    v = vol_prev.assign(back=[(p, t) in here for p, t in zip(vol_prev.pid, vol_prev.team)])
    tot = v.groupby(["team", "kind"]).v.sum()
    bk = v[v.back].groupby(["team", "kind"]).v.sum()
    r = (bk / tot).unstack("kind")
    return {str(int(t)): [site.rnd(x.get("off"), 4), site.rnd(x.get("def"), 4)] for t, x in r.iterrows()}


def career_rows(X):
    """One row per player for the careers file: totals over his slot's game-log columns."""
    D, pl = X.D, X.pl
    F = D["frames"]["_all"]
    v = D["value"].set_index("pid")
    rk = D["value"][D["value"].qualified].assign(r=lambda d: d.groupby("slot").value.rank(ascending=False, method="min")).set_index("pid").r
    nq = D["value"][D["value"].qualified].groupby("slot").size()
    tots = {}
    for tab, cols in site.LOGCOLS.items():
        d = F[tab]
        d = d[d.pid.isin(set(pl.pid))]
        s = d.groupby("pid")[cols].sum()
        if tab == "kick":
            s["long"] = d.groupby("pid").long.max()
        tots[tab] = s
    out = {}
    for r in pl.itertuples():
        tab = N.SLOT_TABLE[r.slot]
        if r.pid not in tots[tab].index:
            continue
        p = int(r.pid)
        out[p] = [X.y, int(r.team), r.slot, r.cls_y if isinstance(r.cls_y, str) else None, int(r.gp), int(bool(r.qual)),
                  site.rnd(v.value.get(p), 2), None if p not in rk.index else int(rk[p]), int(nq.get(r.slot, 0)),
                  [site.rnd(x, 2) or 0 for x in tots[tab].loc[r.pid]]]
    return out


def write_static(careers, honours):
    """registry, search, honours and the career shards (through last season) with every player's bio."""
    sz = {}
    sz["registry"] = site.jdump(site.PUB / "registry.json", site.registry_doc())
    ident = pd.read_parquet(WORK / "identity.parquet").set_index("pid")
    ps = pd.read_parquet(WORK / "player_seasons.parquet")
    tr = pd.read_parquet(WORK / "transfers.parquet")
    fbs = pd.read_parquet(WORK / "fbs_teams.parquet")
    school = {(int(a), int(b)): c for a, b, c in zip(fbs.season, fbs.team_id, fbs.school)}
    cur = ps[(ps.season == C.CURRENT) & ps.fbs]
    keep = set(careers) | set(cur.pid.astype(int))
    ps = ps[ps.pid.isin(keep) & ps.season.between(C.FIRST_SEASON, C.CURRENT)].sort_values(["pid", "season"])
    origin = {(int(a), int(b)): c for a, b, c in zip(tr.pid, tr.season, tr.origin) if isinstance(c, str)}
    last = ps.drop_duplicates("pid", keep="last").set_index("pid")
    names = ps[ps.name.map(lambda v: isinstance(v, str))].drop_duplicates("pid", keep="last").set_index("pid").name
    hist = {}
    for p, x in ps.groupby("pid"):
        h, prev = [], None
        for r in x.itertuples():
            if not r.fbs and r.stat_games == 0:
                continue
            name = school.get((int(r.season), int(r.team)))
            if name is None:
                continue
            moved = prev is not None and prev != int(r.team)
            frm = origin.get((int(p), int(r.season))) if (moved or prev is None) else None
            h.append([int(r.season), int(r.team), 1 if moved else 0] + ([frm] if frm and frm != name else []))
            prev = int(r.team)
        hist[int(p)] = h
    shards = {i: {} for i in range(100)}
    for p in sorted(keep):
        i = ident.loc[p] if p in ident.index else None
        l = last.loc[p] if p in last.index else None
        bio = {"name": names.get(p)}
        if l is not None:
            for k, c in (("city", "birth_place_city"), ("state", "birth_place_state")):
                if isinstance(l[c], str):
                    bio[k] = l[c]
        if i is not None:
            if not pd.isna(i.stars):
                bio["recruit"] = [int(i.stars), None if pd.isna(i.recruit_rank) else int(i.recruit_rank), int(i.class_year)]
            if isinstance(i.gsis_id, str):
                bio["nfl"] = [i.gsis_id, None if pd.isna(i.nfl_season) else int(i.nfl_season)]
        if hist.get(p):
            bio["schools"] = hist[p]
        doc = {"bio": bio, "seasons": careers.get(p, [])}
        if p in honours:
            doc["honours"] = honours[p]
        shards[p % 100][str(p)] = doc
    tot = 0
    for k, d in shards.items():
        tot += site.jdump(site.PUB / "p" / f"{k:02d}.json", d)
    sz["p/*"] = tot
    players = []
    for p in sorted(careers):
        rows = careers[p]
        nm = names.get(p)
        if not isinstance(nm, str):
            continue
        players.append([p, nm, rows[-1][2], rows[-1][1], rows[0][0], rows[-1][0]])
    teams = {}
    for r in fbs[fbs.season >= C.FIRST_SEASON].sort_values("season").itertuples():
        teams[int(r.team_id)] = [int(r.team_id), r.school, r.abbreviation, r.conference, int(r.season)]
    meta = load_state()["team_meta"]
    for t in teams:
        teams[t].append((meta.get(str(t)) or {}).get("nick"))
    sz["search"] = site.jdump(site.PUB / "search.json", {"cols": ["id", "name", "slot", "team", "first", "last"], "players": players,
                                                         "team_cols": ["id", "school", "abbr", "conf", "last", "nick"],
                                                         "teams": [teams[k] for k in sorted(teams)], "through": C.CURRENT - 1})
    sz["honours"] = site.jdump(site.PUB / "honours.json", {str(p): v for p, v in sorted(honours.items())})
    return sz


def history():
    state = load_state()
    ex = {"talent": {}, "coaches": {}, "returning": {}}
    tal = pd.read_parquet(WORK / "team_talent.parquet")
    for r in tal.itertuples():
        ex["talent"].setdefault(str(int(r.season)), {})[str(int(r.team))] = [round(float(r.talent), 2), int(r.talent_rank), int(r.blue_chips)]
    co = pd.read_parquet(WORK / "coaches.parquet").sort_values(["season", "team", "games"], ascending=[True, True, False])
    for (y, t), x in co.groupby(["season", "team"]):
        ex["coaches"].setdefault(str(int(y)), {})[str(int(t))] = list(dict.fromkeys(x.coach))
    EXTRAS.write_text(json.dumps(ex, sort_keys=True))
    careers, honours, entries, vol_prev, sizes = {}, {}, [], None, {}
    for y in [x for x in C.SEASONS if x < C.CURRENT]:
        if vol_prev is not None and y - 1 not in C.SEASONS:
            vol_prev = None              # returning production needs the season just before
        if vol_prev is not None:
            ex["returning"][str(y)] = returning(vol_prev, N.people(y))
            EXTRAS.write_text(json.dumps(ex, sort_keys=True))
        X, sz, hon = site.write_season(y, state, ex)
        sizes.update(sz)
        entries.append(site.index_entry(X))
        for p, row in career_rows(X).items():
            careers.setdefault(p, []).append(row)
        for p, yy, key, label in hon:
            honours.setdefault(int(p), []).append([yy, key, label])
        vol_prev = volumes(X.D)
        print(y, "players", len(X.pl), "qualified", int(X.pl.qual.sum()), "bytes", sum(sz.values()), flush=True)
    ex["returning"][str(C.CURRENT)] = returning(vol_prev, N.people(C.CURRENT))
    EXTRAS.write_text(json.dumps(ex, sort_keys=True))
    sizes.update(write_static(careers, honours))
    site.write_index(entries)
    from . import feat
    feat.write_state()
    print({k: v for k, v in sizes.items() if "/" not in k or k.startswith("p/")})


def current_site():
    """The current season's files from the tables on disk and the frozen state."""
    from . import rating
    state = load_state()
    preds, weekly = rating.current(state["rating"])
    weekly.to_parquet(WORK / "ratings_current.parquet", index=False)
    X, sz, _ = site.write_season(C.CURRENT, state, extras(), weekly=weekly, preds=preds)
    site.write_index([site.index_entry(X)])
    return X, sz


BEAT = REPO / "data" / "cfb-refresh.json"


def active(today=None):
    """The refresh runs from late August to the national title game (about Jan 20); quiet otherwise."""
    t = (today or pd.Timestamp.now(tz="America/New_York")).date()
    return (t.month, t.day) >= (8, 20) or (t.month, t.day) <= (1, 25)


def refresh(fetch=True):
    """ESPN -> tables -> site files, for the season being played. Writes the heartbeat."""
    import os
    from . import espn_feed, ep, teamgame, playergame, heads
    y = C.CURRENT
    beat = json.loads(BEAT.read_text()) if BEAT.exists() else {}
    beat["last_try"] = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
    src = {}
    if fetch:
        out = espn_feed.build_season(y)
        src = out["sources"]
        print(f"{y}: {len(src)} finals fetched or read from the cache; plays for {sum(1 for v in src.values() if v['plays'] >= 80)}", flush=True)
    ep.score([y])
    from . import charting, fourth, feat
    charting.season(y)                   # 1.1.0: the charted layer, then fourth-down decisions, before the tables
    fourth.score(y)
    teamgame.build([y])
    playergame.main("cfbd", [y])
    playergame.main("all", [y])
    if os.environ.get("CFB_OFFLINE") != "1":
        heads.check(heads.wanted())          # new names this week: ask ESPN once whether a headshot exists
    X, sz = current_site()
    sz.update(feat.write_site([y]) or {})   # the season's comps, pedigree and portal haul (state/: the Mac's recruits and transfers)
    if os.environ.get("CFB_PUB"):            # refresh_check's clean room: no heartbeat
        return X
    days = charting.day_shares(y)
    low = sorted(k for k, v in days.items() if v < charting.DAY_ALARM)
    recent = sorted(days)[-3:]
    beat["charting"] = {"last_days": {k: days[k] for k in recent}, "low_days": low, "alarm": any(k in low for k in recent),
                        "rule": f"alarm when a game day's charted share is under {charting.DAY_ALARM:.0%} (ESPN could switch formats back)"}
    beat.update(last_ok=beat["last_try"], season=y, through=X.through, week=X.week, finals=int(X.g.final.sum()),
                fbs_vs_fbs_finals=int((X.g.final & X.g.fbs_game).sum()), players=int(len(X.pl)), qualified=int(X.pl.qual.sum()),
                games_with_plays=sum(1 for v in src.values() if v["plays"] >= 80) if src else beat.get("games_with_plays"),
                sources={"espn": len(src)} if src else beat.get("sources"),
                source_note="Every final of the season being played comes from ESPN's summary and core play feeds (no other source is read live).")
    BEAT.parent.mkdir(parents=True, exist_ok=True)
    BEAT.write_text(json.dumps(beat, indent=1, sort_keys=True) + "\n")
    print(f"{y}: through {X.through}, week {X.week}; players {len(X.pl)}, qualified {int(X.pl.qual.sum())}; bytes {sum(sz.values())}")
    return X


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd in ("history", "all"):
        history()
    if cmd in ("refresh", "all"):
        refresh()
    if cmd == "active":
        raise SystemExit(0 if active() else 10)
    if cmd == "site":
        X, sz = current_site()
        print(sz)
