"""1.1.0 Tier B: the charted play text, 2025 week 9 on.

    python -m pipeline.cfb.charting 2025 2026        # writes work/chart_<season>.parquet and chart_games_<season>.parquet
    python -m pipeline.cfb.charting check            # BUILD-1.1 section 2a's checks, written to research/cfb/out/charting.md

From week 9 of 2025 ESPN's college play text is fully charted:

    No Huddle-Shotgun #1 J.Craig pass incomplete short middle to #88 K.Pimpton thrown to UNC01 QB hurried by #11 J.Harvey
    Shotgun #15 C.Harrell pass complete short right to #21 H.Rutledge caught at CLT38, for 3 yards to the CLT44 (#49 T.Butler)
    Shotgun #2 W.Jordan rush right for 9 yards gain to the USC32 (#4 D.Lee)

One row per scrimmage play (rush or pass) with:

    charted      the play is in the charted format (a pass with depth and direction, a run with a direction;
                 a sack, a spike or a kneel inherits its game's format)
    shotgun      "Shotgun" leads the text; on a charted play its absence means under center
    no_huddle    "No Huddle" leads the text
    depth, side  short / deep and left / middle / right, as the crew wrote them
    spot_ytg     where the ball was caught ("caught at") or thrown to ("thrown to"), as yards to the end zone
    air          air yards: line of scrimmage to that spot (negative behind the line)
    yac          yards after the catch: catch spot to the end spot ("to the CLT44"), completions only
    run_dir      0 left, 1 middle, 2 right
    hur1, hur2   who hurried the quarterback        pbu1   who broke the pass up
    tk1..tk3     tacklers named in the parentheses; n_tk how many (more than one is an assisted tackle)
    pen          the penalized player             injury  the text notes an injury (stored, never shown)

Names are "#jersey F.Lastname". A name resolves to an athlete id through the team's roster: its jersey
if exactly one player wears it, else the last name among those who do, else the last name on the
whole roster. The stat crew's team abbreviations ("UoI", "KSTATE", "Jax St") are mapped to a side
game by game, from end spots whose yard line the play's start and gain already fix.

A game with under 80% of its plays charted contributes nothing to Tier B for either team (`ok` in the
games table). It is listed as such, never treated as zero.
"""
import re
import sys
import json
import numpy as np
import pandas as pd
from .paths import RAW, WORK, OUT

SEASONS = [2025, 2026]
GAME_MIN = 0.80          # a game below this share of charted plays is left out of Tier B
DAY_ALARM = 0.90         # the refresh heartbeat alarms below this on any game day (build.py)
_SPOT = r"([A-Za-z][A-Za-z.&'\- ]{0,14}?) ?(\d{2})\b"
RE_CATCH = re.compile(r"caught at " + _SPOT)
RE_THROWN = re.compile(r"thrown to " + _SPOT)
RE_END = re.compile(r"\bto the " + _SPOT)
RE_DEPTH = re.compile(r"pass (?:complete|incomplete|intercepted)?\s*(short|deep)\s+(left|middle|right)", re.I)
RE_DEPTH2 = re.compile(r"\b(short|deep)\s+(left|middle|right)\b", re.I)
RE_RUN = re.compile(r"\b(?:rush|run|scramble[sd]?)\s+(left|middle|right)\b", re.I)
RE_NAME = re.compile(r"#(\d{1,2})\s+([A-Za-z][^#,;()]*?)(?=\s*(?:$|[,;()]|\band\b|#|\s(?:broken|PENALTY|QB|intercepted|for|to|caught|thrown|return|fumble)))")
RE_PAREN = re.compile(r"\(([^()]*#\d[^()]*)\)")
RE_HUR = re.compile(r"hurried by (.*?)(?=$|broken up|PENALTY|intercepted|\(|, )", re.I)
RE_PBU = re.compile(r"broken up by (.*?)(?=$|QB hurried|PENALTY|\(|, )", re.I)
RE_INJ = re.compile(r"injur", re.I)
RE_FMT = re.compile(r"#\d{1,2} [A-Z]")
SIDE = {"left": 0, "middle": 1, "right": 2}


def _names(chunk):
    return [(int(j), n.strip().rstrip(".")) for j, n in RE_NAME.findall(chunk or "")]


def _last(n):
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?$", "", str(n).strip(), flags=re.I).strip()
    n = n.split(".")[-1] if "." in n.split(" ")[0] else n.split(" ")[-1]
    return re.sub(r"[^a-z]", "", n.lower())


class Roster:
    """Jersey and last name -> athlete id, per team, for one season: the roster file, plus everyone the season's
    box score lists (a roster can miss a man; ESPN's 2026 roster endpoint returned 100 players a team until 1.1.0
    asked for more). Where ESPN has two records for one man (same jersey, same name), the one in the box wins."""

    def __init__(self, y):
        r = pd.read_parquet(RAW / "espn_cfb_rosters" / f"cfb_rosters_{y}.parquet", columns=["team_id", "athlete_id", "athlete_display_name", "jersey"])
        b = pd.read_parquet(RAW / "espn_cfb_player_box" / f"player_box_{y}.parquet", columns=["team_id", "athlete_id", "athlete_name", "jersey"])
        b = b.rename(columns={"athlete_name": "athlete_display_name"})
        r["src"], b["src"] = 1, 0
        r = pd.concat([b, r], ignore_index=True)
        for c in ("athlete_id", "team_id", "jersey"):
            r[c] = pd.to_numeric(r[c], errors="coerce")
        r = r.dropna(subset=["athlete_id", "team_id"])
        self.boxed = set(b.athlete_id.map(lambda v: pd.to_numeric(v, errors="coerce")).dropna().astype("int64"))
        r = r.sort_values("src").drop_duplicates(["team_id", "athlete_id"])
        r["last"] = r.athlete_display_name.fillna("").astype(object).map(str).map(lambda s: _last(s.split(" ", 1)[-1] if " " in s else s))
        self.by = {}
        for t, x in r.groupby("team_id"):
            self.by[int(t)] = list(zip(x.jersey, x["last"], x.athlete_id.astype("int64")))

    def _one(self, m):
        ids = sorted(set(r[2] for r in m))
        if len(ids) == 1:
            return float(ids[0])
        boxed = [i for i in ids if i in self.boxed]
        return float(boxed[0]) if len(boxed) == 1 else np.nan

    def resolve(self, team, jersey, name):
        rows = self.by.get(int(team)) if team == team else None
        if not rows:
            return np.nan
        ln = _last(name)
        same = [r for r in rows if r[0] == jersey]
        if same:
            m = [r for r in same if r[1] == ln]
            v = self._one(m) if m else (self._one(same) if len(set(r[2] for r in same)) == 1 else np.nan)
            if v == v:
                return v
        m = [r for r in rows if r[1] == ln and ln]
        return self._one(m) if m else np.nan


def side_map(d):
    """(game_id, abbreviation) -> team id, voted from end spots the play's start and gain fix."""
    votes = {}
    for gid, off, deff, ytg, yds, txt, ok in zip(d.game_id, d.off, d.deff, d.ytg, d.yards, d.text, d.vote_ok):
        if not ok:
            continue
        for a, n in RE_END.findall(txt):
            n = int(n)
            if n == 50 or n == 0:
                continue
            true = ytg - yds
            a = a.strip()
            if abs(n - true) <= 0.5:
                votes.setdefault((gid, a), {}).setdefault(deff, 0)
                votes[(gid, a)][deff] += 1
            elif abs((100 - n) - true) <= 0.5:
                votes.setdefault((gid, a), {}).setdefault(off, 0)
                votes[(gid, a)][off] += 1
    out = {}
    for k, v in votes.items():
        t, c = max(v.items(), key=lambda kv: kv[1])
        if c >= 2 and c >= 0.8 * sum(v.values()):
            out[k] = t
    return out


def spot_ytg(m, gid, off, deff, sides):
    """A text spot ("CLT38") as yards to the offence's end zone, or NaN when its side is unknown."""
    if not m:
        return np.nan
    a, n = m
    a, n = a.strip(), int(n)
    if n == 50:
        return 50.0
    t = sides.get((gid, a))
    if t is None:
        return np.nan
    return float(n) if t == deff else float(100 - n) if t == off else np.nan


def season(y):
    p = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["game_id", "play_id", "cat", "ptype", "yards", "ytg", "off", "deff", "down",
                                                              "f_sack", "f_comp", "f_att", "f_int", "f_kneel", "f_spike", "f_pen_noplay",
                                                              "period", "week", "season_type", "tk1", "tk2", "ast1", "ast2", "pdef1", "pts"])
    x = pd.read_parquet(WORK / f"xtra_{y}.parquet", columns=["play_id", "text", "pen1"])
    d = p.merge(x, on="play_id", how="left")
    d["text"] = d.text.fillna("")
    d = d[d.off.notna() & d.deff.notna()].copy()
    d["off"], d["deff"] = d.off.astype("int64"), d.deff.astype("int64")
    sc = d.cat.isin(["rush", "pass"]) & ~d.f_kneel & ~d.f_spike & (d.period <= 4)
    pen_part = d.text.str.split("PENALTY", n=1, regex=False)
    d["play_txt"] = pen_part.str[0]
    d["pen_txt"] = pen_part.str[1].fillna("")
    d["vote_ok"] = d.cat.isin(["rush", "pass"]) & ~d.f_pen_noplay & (d.pts == 0) & d.ytg.notna() & ~d.f_int & (d.f_comp | (d.cat == "rush") | d.f_sack)
    sides = side_map(d.assign(text=d.play_txt))
    ro = Roster(y)
    rows = []
    for r in d[sc].itertuples(index=False):
        t = r.play_txt
        lead = t[t.find(")") + 1:] if t.startswith("(") else t
        lead = lead.lstrip()
        shot = lead.startswith("Shotgun") or lead.startswith("No Huddle-Shotgun") or "Shotgun #" in lead[:30]
        nh = lead.startswith("No Huddle")
        dep = RE_DEPTH.search(t) or (RE_DEPTH2.search(t) if r.cat == "pass" else None)
        run = RE_RUN.search(t) if r.cat == "rush" else None
        is_pass, is_sack = r.cat == "pass", bool(r.f_sack)
        # charted format: the crew names players "#8 C.Boley". Some scoring plays carry the scoring summary instead
        # ("Edrees Farooq 45 Yd Interception Return (Max Gilbert Kick)"), with no formation, depth or hurry: such a
        # play counts in every total but in none of the charted splits (`fmt` False)
        fmt = bool(RE_FMT.search(t))
        charted = fmt and ((is_pass and not is_sack and dep is not None) or (r.cat == "rush" and run is not None))
        mc, mt = RE_CATCH.search(t), RE_THROWN.search(t)
        sp = spot_ytg(mc.groups() if mc else (mt.groups() if mt else None), r.game_id, r.off, r.deff, sides)
        air = (r.ytg - sp) if (is_pass and not is_sack and sp == sp and r.ytg == r.ytg) else np.nan
        yac = np.nan
        if r.f_comp and mc and sp == sp:
            me = list(RE_END.finditer(t))
            me = [m for m in me if m.start() > mc.end()]
            if r.pts == 7 and not me:
                yac = sp                      # caught and carried into the end zone
            elif me:
                ee = spot_ytg(me[0].groups(), r.game_id, r.off, r.deff, sides)
                yac = sp - ee if ee == ee else np.nan
        hur = []
        mh = RE_HUR.search(t)
        if mh:
            hur = _names(mh.group(1))
        pb = []
        mp = RE_PBU.search(t)
        if mp:
            pb = _names(mp.group(1))
        tk = []
        if r.cat in ("rush", "pass"):
            body = re.split(r"\b(?:TOUCHDOWN|kick attempt|two-point|2pt|TWO-POINT)", t, maxsplit=1)[0]
            pars = [q for q in RE_PAREN.findall(body) if "H:" not in q and "LS:" not in q]
            if pars:
                tk = _names(pars[-1])
        pen = _names(RE_PAREN.findall(r.pen_txt)[0]) if r.pen_txt and RE_PAREN.findall(r.pen_txt) else []
        res = lambda team, lst, i: ro.resolve(team, lst[i][0], lst[i][1]) if len(lst) > i else np.nan
        rows.append((r.game_id, r.play_id, fmt, charted, shot and fmt, nh and fmt, dep.group(1).lower() if dep else None, dep.group(2).lower() if dep else None,
                     sp, air, yac, SIDE[run.group(1).lower()] if run else np.nan,
                     res(r.deff, hur, 0), res(r.deff, hur, 1), len(hur), res(r.deff, pb, 0), len(pb),
                     res(r.deff, tk, 0), res(r.deff, tk, 1), res(r.deff, tk, 2), len(tk),
                     pen[0][0] if pen else np.nan, bool(RE_INJ.search(r.text))))
    c = pd.DataFrame(rows, columns=["game_id", "play_id", "fmt", "charted", "shotgun", "no_huddle", "depth", "side", "spot_ytg", "air", "yac", "run_dir",
                                    "hur1", "hur2", "n_hur", "pbu1", "n_pbu", "tk1", "tk2", "tk3", "n_tk", "pen_jersey", "injury"])
    # a sack, spike-free scramble or any play without its own tag inherits the game's format
    gm = c.merge(d[["play_id", "cat", "f_sack", "pts"]], on="play_id")
    own = gm[((gm.cat == "rush") | ((gm.cat == "pass") & ~gm.f_sack)) & (gm.fmt | (gm.pts == 0))]   # a scoring summary is not a lapse
    share = own.groupby("game_id").charted.mean()
    nplays = own.groupby("game_id").size()
    g = pd.DataFrame({"plays": nplays, "charted_share": share}).reset_index()
    g["ok"] = g.charted_share >= GAME_MIN
    gg = pd.read_parquet(WORK / "games.parquet", columns=["game_id", "season", "week", "season_type", "date", "home", "away", "home_team", "away_team"])
    g = g.merge(gg[gg.season == y], on="game_id", how="left")
    okset = set(g[g.ok].game_id)
    c["game_ok"] = c.game_id.isin(okset)
    c["formation_known"] = c.game_ok & c.fmt  # under center = a charted-format play with no Shotgun tag
    c.to_parquet(WORK / f"chart_{y}.parquet", index=False)
    g.to_parquet(WORK / f"chart_games_{y}.parquet", index=False)
    print(f"{y}: {len(c)} scrimmage plays, charted {c.charted.mean():.3f}; games {len(g)}, charted (>= {GAME_MIN:.0%}) {int(g.ok.sum())}; "
          f"side map for {len(sides)} (game, abbreviation) pairs", flush=True)
    return c, g


def check():
    """BUILD-1.1 2a: parsed air yards against the release files'; air + YAC = gain; defender ids resolve; share per game."""
    lines = ["# The charted layer: parser checks", "", "*`python -m pipeline.cfb.charting check`. Tier B is tracked from 2025 week 9.*", ""]
    ok_all = True
    res = {}
    for y in SEASONS:
        c = pd.read_parquet(WORK / f"chart_{y}.parquet")
        g = pd.read_parquet(WORK / f"chart_games_{y}.parquet")
        p = pd.read_parquet(WORK / f"plays_{y}.parquet", columns=["play_id", "cat", "yards", "f_comp", "f_sack", "tk1", "tk2", "ast1", "ast2", "pdef1", "pts"])
        c = c.merge(p, on="play_id", how="left")
        fbs = pd.read_parquet(WORK / "games.parquet", columns=["game_id", "fbs_game"])
        c = c[c.game_id.isin(set(fbs[fbs.fbs_game].game_id))]          # every stat is FBS-vs-FBS (FCS rosters are not all on file)
        k = c[c.game_ok]
        # 1. air yards against the release file
        rel = None
        f = RAW / "espn_cfb_pbp" / f"play_by_play_{y}.parquet"
        if f.exists():
            rel = pd.read_parquet(f, columns=["id", "air_yards", "yards_after_catch"]).rename(columns={"id": "play_id"})
            rel["play_id"] = pd.to_numeric(rel.play_id, errors="coerce")
            rel = rel.dropna(subset=["play_id"]).drop_duplicates("play_id")
        a = k[(k.cat == "pass") & ~k.f_sack & k.air.notna()]
        if rel is not None:
            m = a.merge(rel, on="play_id", how="inner").dropna(subset=["air_yards"])
            diff = (m.air - m.air_yards).abs()
            res[f"air_vs_release_{y}"] = dict(n=int(len(m)), median_abs=float(diff.median()) if len(m) else None,
                                               within1=float((diff <= 1).mean()) if len(m) else None)
        # 2. air + YAC = gain on completions
        cp = k[(k.cat == "pass") & k.f_comp & k.air.notna() & k.yac.notna()]
        gap = (cp.air + cp.yac - cp.yards).abs()
        res[f"air_plus_yac_{y}"] = dict(n=int(len(cp)), within1=float((gap <= 1).mean()) if len(cp) else None,
                                         completions_with_both=float(len(cp) / max(1, len(k[(k.cat == "pass") & k.f_comp]))))
        # 3. named defenders resolve to roster ids
        named = int(k.n_hur.clip(upper=2).sum() + k.n_pbu.clip(upper=1).sum() + k.n_tk.clip(upper=3).sum())
        got = int(k[["hur1", "hur2", "pbu1", "tk1_x" if "tk1_x" in k.columns else "tk1", "tk2_x" if "tk2_x" in k.columns else "tk2", "tk3"]].notna().sum().sum())
        res[f"resolve_{y}"] = dict(named=named, resolved=got, rate=got / named if named else None)
        # 3b. agreement with ESPN's own participants where both name a tackler
        both = k[k.tk1_x.notna() & (k.tk1_y.notna() | k.ast1.notna())] if "tk1_x" in k.columns else k.iloc[:0]
        if len(both):
            espn = [set(v for v in vs if v == v) for vs in zip(both.tk1_y, both.tk2_y, both.ast1, both.ast2)]
            agree = np.mean([t in s for t, s in zip(both.tk1_x, espn)])
            res[f"tackler_vs_participants_{y}"] = dict(n=int(len(both)), first_tackler_in_espn_set=float(agree))
        g = g[g.game_id.isin(set(fbs[fbs.fbs_game].game_id))]
        res[f"games_{y}"] = dict(games=int(len(g)), charted=int(g.ok.sum()), under=int((~g.ok).sum()))
        lines += [f"## {y}", "",
                  f"- FBS-vs-FBS games: {len(g)}; charted at {GAME_MIN:.0%} or more: {int(g.ok.sum())}; under: {int((~g.ok).sum())} (they contribute nothing to Tier B)."]
        if y == 2025:
            wk = g.assign(late=(g.season_type == 3) | (g.week >= 9)).groupby("late").agg(games=("ok", "size"), charted=("ok", "sum"), share=("charted_share", "mean"))
            lines.append(f"- Weeks 1-8: {int(wk.loc[False, 'charted'])} of {int(wk.loc[False, 'games'])} games charted; week 9 on: "
                         f"{int(wk.loc[True, 'charted'])} of {int(wk.loc[True, 'games'])} (mean charted share {wk.loc[True, 'share']:.1%}).")
        if f"air_vs_release_{y}" in res:
            r = res[f"air_vs_release_{y}"]
            lines.append(f"- Air yards against the release file: {r['n']:,} throws in both; median absolute difference {r['median_abs']:.2f} yards; "
                         f"within 1 yard on {r['within1']:.1%} (bar: median <= 1 on >= 95%).")
            ok_all &= r["n"] > 0 and r["median_abs"] <= 1 and r["within1"] >= 0.95
        r = res[f"air_plus_yac_{y}"]
        lines.append(f"- Air yards + YAC = gain within 1 yard on {r['within1']:.1%} of {r['n']:,} completions (bar 98%); both spots parsed on "
                     f"{r['completions_with_both']:.1%} of completions.")
        ok_all &= r["within1"] >= 0.98
        r = res[f"resolve_{y}"]
        lines.append(f"- Named defenders resolved to a roster id: {r['resolved']:,} of {r['named']:,} = {r['rate']:.1%} (bar 95%).")
        ok_all &= r["rate"] >= 0.95
        if f"tackler_vs_participants_{y}" in res:
            r = res[f"tackler_vs_participants_{y}"]
            lines.append(f"- The text's first tackler is among ESPN's own tacklers on {r['first_tackler_in_espn_set']:.1%} of {r['n']:,} plays that name both.")
        under = g[~g.ok & ((g.season_type == 3) | (g.week >= 9) | (y > 2025))].sort_values("charted_share")
        if len(under):
            lines += ["", f"Games under {GAME_MIN:.0%} charted (week 9 of 2025 on):", "", "| game | week | charted share | plays |", "|---|---:|---:|---:|"]
            for r in under.itertuples():
                lines.append(f"| {r.away_team} at {r.home_team} | {r.week} | {r.charted_share:.1%} | {r.plays} |")
        lines.append("")
    lines += ["", f"**All checks pass: {'yes' if ok_all else 'NO'}**", ""]
    (OUT / "charting.md").write_text("\n".join(lines))
    (OUT / "charting.json").write_text(json.dumps(res, indent=1, sort_keys=True))
    print("\n".join(lines))
    return ok_all


def day_shares(y):
    """Charted share by game day (the refresh heartbeat)."""
    g = pd.read_parquet(WORK / f"chart_games_{y}.parquet")
    g["day"] = pd.to_datetime(g.date, utc=True).dt.tz_convert("America/New_York").dt.date.astype(str)
    s = g.groupby("day").apply(lambda x: float((x.charted_share * x.plays).sum() / x.plays.sum()), include_groups=False)
    return {k: round(v, 4) for k, v in s.items()}


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "check":
        raise SystemExit(0 if check() else 1)
    for y in [int(v) for v in a] or SEASONS:
        season(y)
