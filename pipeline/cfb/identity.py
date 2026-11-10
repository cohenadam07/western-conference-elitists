"""Step 5. Identity: one person per ESPN athlete id, with everything that hangs off him.

    python -m pipeline.cfb.identity

ESPN's athlete id is the spine: it is the id on every play, box score and roster.
This module joins to it, and logs every join with how it was made:

  school history   the team he was on each season (the team he recorded stats for, else his
                   roster row), so a change of team between seasons is a transfer
  class            how many seasons since he enrolled. ESPN's "class" on an old roster is the
                   class he FINISHED with (two thirds of 2014's roster rows say "SR"), so it is
                   only trusted for the season being played; history is counted from his
                   recruiting class year, else his first roster season (rosters go back to 2004)
  recruit          CFBD's composite: stars and national rank in his class. Joined by ESPN id
                   (CFBD carries it), then by the roster file's CFBD id, then by name + school
  transfers        CFBD's portal table (2021 on) names where a transfer came from when that
                   school is not in our data (FCS and below)
  NFL              Football Savant's id (GSIS) through nflverse's players file, which lists the
                   ESPN id. ESPN keeps one athlete id from college to the NFL
  head coaches     one row per team-season (BUILD decision 7), from CFBD
  team talent      computed from the recruits on each roster (Adam, Nov 10 2026), see talent()

Hand fixes go in pipeline/cfb/manual/id_fixes.csv, one per row, each with its source; they are
applied last and win.

CFBD rows are inputs only (BUILD ground rule 5): nothing written here that leaves the Mac holds a
CFBD row. The match log stays in ~/College-Football-Savant/work; the repo gets the summary.
"""
import re
import glob
import json
import unicodedata
import numpy as np
import pandas as pd
from .paths import RAW, WORK, OUT, REPO

FIRST, LAST = 2014, 2026
MANUAL = REPO / "pipeline" / "cfb" / "manual" / "id_fixes.csv"
_SUFFIX = re.compile(r"\s+(jr|sr|ii|iii|iv|v)$")


def norm(s):
    """A name for matching: ascii, lower case, letters only, no generational suffix."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z ]", "", s.replace("-", " "))
    return _SUFFIX.sub("", re.sub(r"\s+", " ", s).strip())


def last_name(s):
    n = norm(s)
    return n.split(" ")[-1] if n else ""


# ---------------------------------------------------------------- the spine
def stat_teams():
    """(season, pid) -> the team he recorded the most games for, and how many games."""
    parts = []
    for t in ("qb", "rush", "rec", "dfn", "kick", "punt", "ret"):
        d = pd.read_parquet(WORK / f"pg_{t}_all.parquet", columns=["season", "pid", "team", "game_id"])
        parts.append(d)
    d = pd.concat(parts, ignore_index=True).drop_duplicates()
    g = d.groupby(["season", "pid", "team"]).game_id.nunique().rename("games").reset_index()
    g = g.sort_values(["season", "pid", "games"], ascending=[True, True, False])
    return g.drop_duplicates(["season", "pid"]), g


def spine():
    ro = pd.read_parquet(WORK / "pg_roster.parquet")
    first = []
    for f in sorted(glob.glob(str(RAW / "espn_cfb_rosters" / "cfb_rosters_*.parquet"))):
        y = int(re.search(r"(\d{4})\.parquet", f).group(1))
        r = pd.read_parquet(f, columns=["athlete_id"])
        first.append(pd.DataFrame({"pid": pd.to_numeric(r.athlete_id, errors="coerce"), "season": y}).dropna())
    first = pd.concat(first).astype({"pid": "int64"}).groupby("pid").season.min().rename("first_roster")
    st, st_all = stat_teams()
    fbs = pd.read_parquet(WORK / "fbs_teams.parquet")[["season", "team_id", "school", "conference"]].rename(columns={"team_id": "team"})
    # one row per player-season: the stat team where he has one (a roster file can list a player
    # under the school he left), else the roster row with the most games rostered
    ro = ro.sort_values("games_rostered", ascending=False)
    ro = ro.merge(st.rename(columns={"team": "stat_team", "games": "stat_games"}), on=["season", "pid"], how="left")
    ro["pref"] = (ro.team == ro.stat_team).astype(int)
    ps = ro.sort_values(["pref", "games_rostered"], ascending=False).drop_duplicates(["season", "pid"]).copy()
    moved = ps.stat_team.notna() & (ps.team != ps.stat_team)
    ps.loc[moved, "team"] = ps.loc[moved, "stat_team"].astype("int64")
    # players with stats but no roster row at all
    have = set(zip(ps.season, ps.pid))
    add = st[np.array([(a, b) not in have for a, b in zip(st.season, st.pid)], dtype=bool)].rename(columns={"games": "stat_games"})
    ps = pd.concat([ps, add.assign(stat_team=add.team)], ignore_index=True)
    ps = ps.merge(fbs, on=["season", "team"], how="left")
    ps["fbs"] = ps.school.notna()
    ps["stat_games"] = ps.stat_games.fillna(0).astype(int)
    ps["first_roster"] = ps.pid.map(first)
    return ps.drop(columns=["pref", "stat_team"]), int(moved.sum()), len(add)


# ---------------------------------------------------------------- recruits
def recruits():
    rows = []
    for f in sorted(glob.glob(str(RAW / "cfbd" / "recruiting_players__*.json"))):
        rows += json.load(open(f))
    r = pd.DataFrame(rows)
    r["rid"] = r["id"].astype(str)
    r["aid"] = pd.to_numeric(r.athleteId, errors="coerce")
    r["key"] = r.name.map(norm)
    r = r[r.rating.notna()].copy()
    # national rank in the class by composite rating (CFBD's own `ranking` is missing on a sixth of rows)
    r["rank"] = r.groupby("year").rating.rank(ascending=False, method="min").astype(int)
    return r[["rid", "aid", "year", "name", "key", "committedTo", "position", "stars", "rating", "rank", "city", "stateProvince"]]


def school_ids():
    """CFBD school name -> ESPN team id (the release team table carries both)."""
    out = {}
    for f in sorted(glob.glob(str(RAW / "espn_cfb_teams" / "*.parquet"))):
        t = pd.read_parquet(f, columns=["team_id", "school", "alt_name1", "alt_name2", "alt_name3", "location"])
        for r in t.itertuples(index=False):
            for n in (r.school, r.location, r.alt_name1, r.alt_name2, r.alt_name3):
                if isinstance(n, str) and n:
                    out.setdefault(n.lower(), int(r.team_id))
    return out


def join_recruits(ps, rec):
    sid = school_ids()
    rec = rec.assign(team=rec.committedTo.str.lower().map(sid))
    pl = ps.groupby("pid").agg(name=("name", "first"), first=("season", "min"), first_roster=("first_roster", "min"),
                               teams=("team", lambda s: set(s))).reset_index()
    pl["key"] = pl.name.map(norm)
    pl["start"] = pl[["first", "first_roster"]].min(axis=1)
    log = []
    # 1. CFBD's own ESPN id
    a = rec[rec.aid.notna()].assign(pid=lambda x: x.aid.astype("int64")).merge(pl, on="pid", suffixes=("", "_p"))
    a["ok"] = [last_name(x) == last_name(y) or z in t for x, y, z, t in zip(a.name, a.name_p, a.team, a.teams)]
    a["how"] = "espn id"
    log.append(a[a.ok])
    rejected = a[~a.ok]
    done = set(a[a.ok].pid)
    # 2. the roster file's CFBD recruit id
    rid = ps[ps.cfbd_recruit_ids.notna()][["pid", "cfbd_recruit_ids"]].drop_duplicates()
    rid = rid.assign(rid=rid.cfbd_recruit_ids.astype(str).str.findall(r"\d+")).explode("rid").dropna(subset=["rid"])
    b = rec.merge(rid[["pid", "rid"]].drop_duplicates(), on="rid").merge(pl, on="pid", suffixes=("", "_p"))
    b = b[~b.pid.isin(done)]
    b["ok"] = [last_name(x) == last_name(y) for x, y in zip(b.name, b.name_p)]
    b["how"] = "roster file's CFBD id"
    log.append(b[b.ok])
    done |= set(b[b.ok].pid)
    # 3. same name, committed to a school he played for, class year at most one before his first season
    c = rec[rec.team.notna()].merge(pl[~pl.pid.isin(done) & (pl.key != "")], on="key", suffixes=("", "_p"))
    c = c[np.array([t in ts for t, ts in zip(c.team, c.teams)], dtype=bool) & c.year.between(c.start - 2, c.start).to_numpy()]
    amb = c.groupby(["key", "team"]).pid.transform("nunique") > 1       # two players of one name at one school: leave both
    c = c[~amb].assign(how="name + school + class year", ok=True)
    log.append(c)
    m = pd.concat(log, ignore_index=True)
    m["gap"] = (m.year - m.start).abs()
    m = m.sort_values(["pid", "gap", "rating"], ascending=[True, True, False]).drop_duplicates("pid")
    return m[["pid", "rid", "year", "stars", "rating", "rank", "position", "committedTo", "city", "stateProvince", "how", "name", "name_p"]], rejected


# ---------------------------------------------------------------- the transfer portal
def join_portal(ps):
    sid = school_ids()
    rows = []
    for f in sorted(glob.glob(str(RAW / "cfbd" / "player_portal__*.json"))):
        rows += json.load(open(f))
    p = pd.DataFrame(rows)
    p["key"] = (p.firstName.fillna("") + " " + p.lastName.fillna("")).map(norm)
    p["dest"] = p.destination.str.lower().map(sid)
    p["orig"] = p.origin.str.lower().map(sid)
    x = ps[["season", "pid", "team", "name"]].assign(key=lambda d: d.name.map(norm))
    # he is on the destination's roster that season
    m = p[p.dest.notna()].merge(x, left_on=["season", "key", "dest"], right_on=["season", "key", "team"])
    amb = m.groupby(["season", "key", "dest"]).pid.transform("nunique") > 1
    m = m[~amb].drop_duplicates(["season", "pid"])
    return m[["season", "pid", "origin", "destination", "orig", "dest", "transferDate", "eligibility"]], len(p), int(p.dest.notna().sum())


# ---------------------------------------------------------------- class by season
def classes(ps, rec_m):
    yr = rec_m.set_index("pid").year
    ps = ps.copy()
    ps["class_year"] = ps.pid.map(yr)
    start = np.where(ps.class_year.notna() & (ps.class_year <= ps.season) & (ps.class_year >= ps.season - 6),
                     ps.class_year, ps.first_roster.fillna(ps.season))
    ps["exp"] = (ps.season - start + 1).clip(lower=1).astype(int)
    prev = ps[["season", "pid", "stat_games"]].assign(season=lambda d: d.season + 1).rename(columns={"stat_games": "prev_games"})
    ps = ps.merge(prev, on=["season", "pid"], how="left")
    # a freshman for the Freshman team: first year, or second year after a season of at most four
    # games with a stat (the redshirt rule since 2018; before it, a redshirt played none)
    # Measured on 2026 against ESPN's current labels: a first-year player with no recruit record is a
    # junior-college or lower-division transfer a quarter of the time, so history only calls a man a
    # freshman when his high-school class year is known.
    derived = (ps.exp == 1) | ((ps.exp == 2) & (ps.prev_games.fillna(0) <= np.where(ps.season >= 2019, 4, 0)))
    derived &= ps.class_year.notna() & (ps.class_year >= ps.season - 1)
    cur = ps.season == LAST
    ps["fr"] = np.where(cur & ps.cls.notna(), ps.cls == "FR", derived)
    lab = np.select([ps.exp <= 1, ps.exp == 2, ps.exp == 3], ["FR", "SO", "JR"], default="SR")
    ps["cls_y"] = np.where(cur & ps.cls.notna(), ps.cls, lab)
    agree = None
    k = ps[cur & ps.cls.notna() & (ps.class_year.notna() | ps.first_roster.notna())]
    if len(k):
        agree = {"players": int(len(k)), "freshman_flag_agrees": float(((k.cls == "FR") == derived[k.index]).mean()),
                 "label_within_one_year": float((pd.Series(lab, index=ps.index)[k.index].map({"FR": 1, "SO": 2, "JR": 3, "SR": 4})
                                                 - k.cls.map({"FR": 1, "SO": 2, "JR": 3, "SR": 4})).abs().le(1).mean())}
    return ps.drop(columns=["prev_games"]), agree


# ---------------------------------------------------------------- NFL
def join_nfl(pl):
    """Football Savant's id for players who reached the NFL: ESPN id first, then name + college + rookie year."""
    nf = pd.read_csv(RAW / "nflverse" / "players.csv", low_memory=False)
    nf = nf[nf.gsis_id.notna()]
    fs = json.load(open(REPO / "public" / "football-savant-data.json"))["data"]
    on_fs = {}
    for y, blk in fs.items():
        for p in blk["players"]:
            on_fs[p["id"]] = max(int(y), on_fs.get(p["id"], 0))
    nf = nf[nf.gsis_id.isin(on_fs)].copy()
    nf["pid"] = pd.to_numeric(nf.espn_id, errors="coerce")
    a = nf[nf.pid.notna()].astype({"pid": "int64"}).merge(pl[["pid", "name", "last"]], on="pid")
    a = a[np.array([last_name(x) == last_name(y) for x, y in zip(a.display_name, a.name)], dtype=bool)].assign(how="espn id")
    done_g, done_p = set(a.gsis_id), set(a.pid)
    b = nf[~nf.gsis_id.isin(done_g)].assign(key=lambda d: d.display_name.map(norm))
    c = pl[~pl.pid.isin(done_p)].assign(key=lambda d: d.name.map(norm))
    b = b.drop(columns=["pid"]).merge(c[["pid", "key", "name", "last", "schools"]], on="key")
    col = b.college_name.fillna("").str.lower()
    b = b[np.array([any(s.lower() in cn or cn in s.lower() for s in ss) if cn else False for cn, ss in zip(col, b.schools)], dtype=bool)
          & (b.rookie_season.fillna(0) - b["last"]).between(1, 2).to_numpy()]
    b = b[(b.groupby("key").pid.transform("nunique") == 1) & (b.groupby("pid").gsis_id.transform("nunique") == 1)].assign(how="name + college + rookie year")
    m = pd.concat([a, b], ignore_index=True).drop_duplicates("pid")
    m["nfl_season"] = m.gsis_id.map(on_fs)
    return m[["pid", "gsis_id", "display_name", "name", "how", "nfl_season", "draft_year"]], len(on_fs)


# ---------------------------------------------------------------- head coaches
def coaches():
    c = json.load(open(glob.glob(str(RAW / "cfbd" / "coaches__*.json"))[0]))
    rows = []
    for x in c:
        for s in x["seasons"]:
            if FIRST <= s["year"] <= LAST:
                rows.append(dict(season=s["year"], team=int(s["teamId"]), coach=f'{x["firstName"]} {x["lastName"]}'.strip(),
                                 games=s.get("games") or 0, wins=s.get("wins") or 0, losses=s.get("losses") or 0))
    t = pd.DataFrame(rows).sort_values(["season", "team", "games"], ascending=[True, True, False])
    t["n"] = t.groupby(["season", "team"]).coach.transform("size")
    return t


# ---------------------------------------------------------------- team talent
def talent(ps, rec_m):
    """Team talent from the recruits on each roster.

    247's Team Talent Composite is not ours to republish, and the release file's "talent" is a
    different thing (measured in prompt 1: r 0.79 with CFBD's). So this is computed: every player on
    the season's roster who was a rated recruit, each worth his composite rating above a floor.
    The floor and whether to count everyone or the best 85 were chosen by which form tracks
    CFBD's 2024 table best (the one season of it that was pulled); the table printed by main()
    shows every form that was tried.
    """
    x = ps[ps.fbs][["season", "team", "pid"]].merge(rec_m[["pid", "rating", "stars"]], on="pid", how="left")
    ref = pd.DataFrame(json.load(open(RAW / "cfbd" / "talent__year-2024.json")))
    sid = school_ids()
    ref["team"] = ref.team.str.lower().map(sid)
    ref = ref.dropna(subset=["team"]).astype({"team": "int64"}).set_index("team").talent.astype(float)
    forms, trials = {}, []
    for floor in (0.0, 0.70, 0.75, 0.80):
        for top in (None, 85):
            v = (x.rating - floor).clip(lower=0).fillna(0)
            y = x.assign(v=v)
            if top:
                y = y.sort_values("v", ascending=False).groupby(["season", "team"]).head(top)
            s = y.groupby(["season", "team"]).v.sum()
            forms[(floor, top)] = s
            k = s.xs(2024, level="season").reindex(ref.index).dropna()
            trials.append(dict(floor=floor, top=top or "all", r_2024=float(np.corrcoef(k, ref.reindex(k.index))[0, 1]),
                               spearman_2024=float(k.rank().corr(ref.reindex(k.index).rank())), teams=int(len(k))))
    tr = pd.DataFrame(trials).sort_values("spearman_2024", ascending=False)
    best = tr.iloc[0]
    s = forms[(float(best.floor), None if best.top == "all" else int(best.top))].rename("talent").reset_index()
    n = x.groupby(["season", "team"]).agg(roster=("pid", "size"), rated=("rating", "count"),
                                           blue_chips=("stars", lambda q: int((q >= 4).sum()))).reset_index()
    s = s.merge(n, on=["season", "team"])
    s["talent_rank"] = s.groupby("season").talent.rank(ascending=False, method="min").astype(int)
    return s, tr


# ---------------------------------------------------------------- manual fixes
def apply_fixes(ident):
    if not MANUAL.exists():
        return ident, 0
    fx = pd.read_csv(MANUAL, comment="#")
    n = 0
    for r in fx.itertuples(index=False):
        m = ident.pid == int(r.pid)
        if m.any() and r.field in ident.columns:
            ident.loc[m, r.field] = None if (isinstance(r.value, float) and np.isnan(r.value)) or r.value == "" else r.value
            n += 1
    return ident, n


def main():
    ps, moved, added = spine()
    rec = recruits()
    rec_m, rejected = join_recruits(ps, rec)
    ps, agree = classes(ps, rec_m)
    port, n_port, n_port_fbs = join_portal(ps)
    k = ps[ps.season.between(FIRST, LAST)]
    pl = k.sort_values("season").groupby("pid").agg(name=("name", "last"), first=("season", "min"), last=("season", "max"),
                                                    schools=("school", lambda s: [v for v in dict.fromkeys(s) if isinstance(v, str)]),
                                                    fbs=("fbs", "any"), stat_games=("stat_games", "sum")).reset_index()
    nfl, n_fs = join_nfl(pl)
    ident = pl.merge(rec_m[["pid", "year", "stars", "rank", "rating", "how"]].rename(columns={"year": "class_year", "how": "recruit_how",
                                                                                         "rank": "recruit_rank"}), on="pid", how="left")
    ident = ident.merge(nfl[["pid", "gsis_id", "nfl_season", "how"]].rename(columns={"how": "nfl_how"}), on="pid", how="left")
    ident, n_fix = apply_fixes(ident)
    ident.to_parquet(WORK / "identity.parquet", index=False)
    keep = ["season", "pid", "team", "school", "conference", "fbs", "name", "pos", "position_name", "jersey", "weight", "height",
            "cls_y", "exp", "fr", "class_year", "stat_games", "headshot_href", "birth_place_city", "birth_place_state", "first_roster"]
    ps[keep].to_parquet(WORK / "player_seasons.parquet", index=False)
    port.to_parquet(WORK / "transfers.parquet", index=False)
    co = coaches()
    co.to_parquet(WORK / "coaches.parquet", index=False)
    tal, trials = talent(ps[ps.season.between(FIRST, LAST)], rec_m)
    tal.to_parquet(WORK / "team_talent.parquet", index=False)
    # the log: every join, how it was made (stays on the Mac: it holds CFBD rows)
    log = pd.concat([rec_m.assign(kind="recruit")[["kind", "pid", "how", "name", "name_p", "year", "committedTo"]],
                     nfl.assign(kind="nfl").rename(columns={"display_name": "name_p"})[["kind", "pid", "how", "name", "name_p", "gsis_id"]],
                     port.assign(kind="portal", how="name + destination + season")[["kind", "pid", "how", "season", "origin", "destination"]]],
                    ignore_index=True)
    log.to_csv(WORK / "identity_log.csv", index=False)
    rejected[["pid", "name", "name_p", "committedTo", "year"]].to_csv(WORK / "identity_rejected.csv", index=False)

    st = ps[ps.season.between(FIRST, LAST) & ps.fbs & (ps.stat_games > 0)]
    st_ids = set(st.pid)
    cov = st.assign(has=st.pid.isin(set(rec_m.pid))).groupby("season").has.mean()
    tr = st.sort_values("season").assign(prev=lambda d: d.groupby("pid").team.shift(1), prev_s=lambda d: d.groupby("pid").season.shift(1))
    tr = tr[tr.prev.notna() & (tr.prev != tr.team)]
    lines = ["# Identity (BUILD step 5)", "",
             f"- Players on a roster or with a stat, {FIRST} to {LAST}: {ident.pid.nunique():,}; with a stat in an FBS game: {len(st_ids):,}.",
             f"- Player-seasons moved to the team they recorded stats for (the roster file had them elsewhere): {moved:,}. "
             f"Player-seasons with stats and no roster row: {added:,}.",
             f"- Recruits joined: {len(rec_m):,} of {len(rec):,} rated high-school recruits in CFBD's 2010 to 2026 classes. By method: "
             + "; ".join(f"{k} {v:,}" for k, v in rec_m.how.value_counts().items()) + ".",
             f"- ESPN-id joins refused because neither the surname nor the school agreed: {len(rejected):,} (listed in the Mac's work folder).",
             "- Share of FBS players with a stat who have a recruit record, by season: "
             + ", ".join(f"{int(y)} {v:.0%}" for y, v in cov.items()) + ".",
             f"- Transfers seen as a change of team between a player's seasons: {len(tr):,}. Portal rows (2021 on): {n_port:,}, "
             f"{n_port_fbs:,} with a destination in our team table, {len(port):,} joined to a player by name, destination and season.",
             f"- NFL: {len(nfl):,} players linked to a Football Savant id ({n_fs:,} ids on Football Savant). By method: "
             + "; ".join(f"{k} {v:,}" for k, v in nfl.how.value_counts().items()) + ".",
             f"- Head coaches: {len(co):,} coach-seasons for {co.groupby(['season', 'team']).ngroups:,} team-seasons; "
             f"{int((co.drop_duplicates(['season', 'team']).n > 1).sum())} team-seasons had more than one.",
             f"- Hand fixes applied from pipeline/cfb/manual/id_fixes.csv: {n_fix}.", ""]
    if agree:
        lines += [f"Class check on {LAST}, the one season ESPN's class label is current ({agree['players']:,} players): the derived "
                  f"freshman flag agrees with ESPN's for {agree['freshman_flag_agrees']:.1%}; the derived class is within one year "
                  f"of ESPN's for {agree['label_within_one_year']:.1%}. {LAST} uses ESPN's label; earlier seasons use the derived one.", ""]
    lines += ["## Team talent: the forms tried against CFBD's 2024 table", "",
              "| rating floor | players counted | Pearson r | rank correlation | teams |", "|---:|---|---:|---:|---:|"]
    lines += [f"| {r.floor:.2f} | {r.top} | {r.r_2024:.3f} | {r.spearman_2024:.3f} | {r.teams} |" for r in trials.itertuples()]
    lines += ["", f"Used: the first row. Top five of {LAST}: "
              + ", ".join(f"{s}" for s in tal[tal.season == LAST].sort_values("talent", ascending=False).head(5)
                          .merge(ps[ps.season == LAST][["team", "school"]].drop_duplicates(), on="team").school) + "."]
    (OUT / "identity.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
