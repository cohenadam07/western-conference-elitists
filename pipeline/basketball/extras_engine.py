"""
extras_engine.py — the October 2026 card additions, as passes over one season's players.

    apply_scoring(season, players)    uast, uast3, ppaint      (NBA "Scoring" splits, 1996-97 on)
    apply_onoff_adj(season, players)  onoffadj                 (team on/off details, 1996-97 on)
    apply_playtypes(season, players)  p["pt"] play-type panel  (Synergy, 2015-16 on)
    apply_with_without(season, players)  p["ww"] panel         (game logs; latest season)

Each one is a pure pass over the list it is given, so the full rebuild (build_extras.py over
out/players.json) and the nightly refresh (refresh_current.py) run the same code. Every
metric added here has its explainer in the site repo's tools/savant-explainers/explainers.py.
"""
import math
from collections import defaultdict
import savant_engine as E
import savant_config as C

WINDOWS = C.WINDOWS


def _put(p, key, win, v, n):
    p["m"].setdefault(key, {})[win] = {"v": v, "n": n}


# ---------------------------------------------------------------- scoring splits
def apply_scoring(season, players):
    """Unassisted share of made field goals and of made threes, and share of points in the
    paint. The NBA tags each make assisted or not from the play-by-play."""
    from nba_api.stats.endpoints import leaguedashplayerstats as L
    by_id = {p["id"]: p for p in players}
    n = 0
    for win, ln in WINDOWS.items():
        try:
            df = E.call(L.LeagueDashPlayerStats, E._ln(dict(
                season=season, season_type_all_star=C.SEASON_TYPE,
                measure_type_detailed_defense="Scoring", per_mode_detailed="Totals"), ln))
            box = E.load_box(ln, season)
        except Exception as e:
            print(f"  scoring {season}/{win}: unavailable ({repr(e)[:60]})")
            continue
        for _, r in df.iterrows():
            p = by_id.get(int(r["PLAYER_ID"]))
            if p is None:
                continue
            pid = int(r["PLAYER_ID"])
            b = box.loc[pid] if pid in box.index else None
            fgm = float(b.get("fgm", 0) or 0) if b is not None else 0
            f3m = float(b.get("fg3m", 0) or 0) if b is not None else 0
            pts = float(b.get("pts", 0) or 0) if b is not None else 0
            u = r.get("PCT_UAST_FGM"); u3 = r.get("PCT_UAST_3PM"); pp = r.get("PCT_PTS_PAINT")
            if fgm > 0 and u is not None and not math.isnan(float(u)):
                _put(p, "uast", win, round(100 * float(u), 1), round(fgm))
            if f3m > 0 and u3 is not None and not math.isnan(float(u3)):
                _put(p, "uast3", win, round(100 * float(u3), 1), round(f3m))
            if pts > 0 and pp is not None and not math.isnan(float(pp)):
                _put(p, "ppaint", win, round(100 * float(pp), 1), round(pts))
            if win == "season":
                n += 1
    return n


# ---------------------------------------------------------------- luck-adjusted on/off
def _league_rates(season):
    from nba_api.stats.endpoints import leaguedashteamstats as T
    df = E.call(T.LeagueDashTeamStats, dict(season=season, season_type_all_star=C.SEASON_TYPE,
                measure_type_detailed_defense="Base", per_mode_detailed="Totals"))
    f3m, f3a, ftm, fta = (float(df[c].sum()) for c in ("FG3M", "FG3A", "FTM", "FTA"))
    return f3m / f3a, ftm / fta


def apply_onoff_adj(season, players):
    """On/off net rating with the opponents' three-point and free-throw shooting replaced by
    league average. Opponents' 3P% and FT% while one player is on the floor are almost all
    noise over a season (the defender has little control over either), and they swing raw
    on/off by several points. Own-team shooting is left alone: a shooter raising his team's
    3P% is real."""
    from nba_api.stats.endpoints import teamplayeronoffdetails as D
    from nba_api.stats.static import teams as static_teams
    by_id = {p["id"]: p for p in players}
    try:
        lg3, lgft = _league_rates(season)
    except Exception as e:
        print(f"  onoffadj {season}: league rates unavailable ({repr(e)[:60]})")
        return 0
    agg = defaultdict(lambda: [0.0, 0.0])   # pid -> [sum(adj diff * on_min), sum(on_min)]
    for team in static_teams.get_teams():
        try:
            opp = E.call_frames(D.TeamPlayerOnOffDetails, dict(team_id=team["id"], season=season,
                    season_type_all_star=C.SEASON_TYPE, measure_type_detailed_defense="Opponent",
                    per_mode_detailed="Totals"), frames=(1, 2))
            adv = E.call_frames(D.TeamPlayerOnOffDetails, dict(team_id=team["id"], season=season,
                    season_type_all_star=C.SEASON_TYPE, measure_type_detailed_defense="Advanced",
                    per_mode_detailed="Totals"), frames=(1, 2))
        except Exception:
            continue
        side = {}
        for fr, tag in ((1, "on"), (2, "off")):
            o = opp[fr].set_index("VS_PLAYER_ID")
            a = adv[fr].set_index("VS_PLAYER_ID")
            for pid in a.index:
                if pid not in o.index:
                    continue
                poss = float(a.loc[pid, "POSS"] or 0)
                if poss <= 0:
                    continue
                luck = (3 * (float(o.loc[pid, "OPP_FG3M"] or 0) - float(o.loc[pid, "OPP_FG3A"] or 0) * lg3)
                        + (float(o.loc[pid, "OPP_FTM"] or 0) - float(o.loc[pid, "OPP_FTA"] or 0) * lgft))
                net = float(a.loc[pid, "NET_RATING"] or 0) + 100 * luck / poss
                side.setdefault(int(pid), {})[tag] = (net, float(a.loc[pid, "MIN"] or 0))
        for pid, s in side.items():
            if "on" in s and "off" in s and s["on"][1] > 0:
                agg[pid][0] += (s["on"][0] - s["off"][0]) * s["on"][1]
                agg[pid][1] += s["on"][1]
    n = 0
    for pid, (wsum, wmin) in agg.items():
        p = by_id.get(pid)
        if p is None or wmin <= 0:
            continue
        v = round(wsum / wmin, 1)
        for win in WINDOWS:          # season-only, spread across windows like onoff
            _put(p, "onoffadj", win, v, round(wmin))
        n += 1
    return n


# ---------------------------------------------------------------- play types
PLAY_TYPES = ["Transition", "Isolation", "PRBallHandler", "PRRollman", "Postup", "Spotup",
              "Handoff", "Cut", "OffScreen", "OffRebound", "Misc"]

# The NBA's own floor on the player-level Synergy table: a player's play type is published
# only once he has 10 possessions of it. Nothing here drops anyone — a player under the floor
# has no row to read. Measured October 2026: in a finished season and in the season in
# progress alike, every row the endpoint returns has POSS >= 10, and the minimum is exactly
# 10 in every play type; the team-level table (teams_engine.py) has no floor at all.
PT_NBA_MIN_POSS = 10

# Our own percentile for the season in progress. The NBA's PERCENTILE is ranked inside that
# 10-possession pool, which in the first days of a season is three or four players: on
# 2026-10-23 it had Anthony Edwards 100th on 13 isolation possessions and Luka Doncic 0th on
# 10. So in season we rank his points per possession against the players with SAMPLE_FLAG+
# possessions of that play type, and publish no percentile at all unless he clears the flag
# himself and the pool holds POOL_MIN players. League-wide, not position-adjusted — the same
# basis the NBA's percentile had, so what the card means doesn't change underneath anyone.
#
# Retune here and nowhere else: refresh_current.py publishes playtype_meta() next to the
# data, and the page and the connector read the numbers out of it rather than carrying copies.
SAMPLE_FLAG = 25        # possessions: under this, no percentile and a small-sample tag
POOL_MIN = 20           # players: a pool thinner than this can't carry a percentile


def _midrank(v, pool):
    """Midrank percentile, higher-is-better, as the page's pctRaw(): below + half the ties."""
    n = len(pool)
    if n < 2:
        return None
    less = sum(1 for x in pool if x < v)
    eq = sum(1 for x in pool if x == v)
    return 100 * (less + 0.5 * eq) / n


def playtype_pools(players):
    """Per play type, how many published players have SAMPLE_FLAG+ possessions of it — the
    pool a percentile is ranked against. Counted off the written rows, so it can't disagree
    with them."""
    n = defaultdict(int)
    for p in players:
        for t, v in (p.get("pt") or {}).items():
            if v[3] >= SAMPLE_FLAG:
                n[t] += 1
    return {t: n[t] for t in PLAY_TYPES if n[t]}


def playtype_meta(players):
    """What the page and the connector need to explain a play-type panel: the two cutoffs,
    the NBA's own floor, what the percentile is ranked against, and the pool sizes."""
    return dict(sample_flag=SAMPLE_FLAG, pool_min=POOL_MIN, nba_min_poss=PT_NBA_MIN_POSS,
                basis="league", pools=playtype_pools(players))


def apply_playtypes(season, players, live=False):
    """Per play type: share of his possessions, points per possession, percentile,
    possessions. Stored as p["pt"] = {type: [freq %, ppp, percentile, poss]}.

    The percentile is the NBA's for a finished season, and ours when `live` (the season in
    progress) — see SAMPLE_FLAG above. A live percentile can be None, which the page and the
    connector show as no percentile rather than as a zero."""
    from nba_api.stats.endpoints import synergyplaytypes as S
    by_id = {p["id"]: p for p in players}
    got = defaultdict(dict)
    for t in PLAY_TYPES:
        try:
            df = E.call(S.SynergyPlayTypes, dict(season=season, season_type_all_star=C.SEASON_TYPE,
                    per_mode_simple="Totals", player_or_team_abbreviation="P", play_type_nullable=t,
                    type_grouping_nullable="offensive"))
        except Exception:
            continue
        for _, r in df.iterrows():
            pid = int(r["PLAYER_ID"])
            poss = float(r.get("POSS", 0) or 0)
            if poss <= 0:
                continue
            prev = got[pid].get(t)
            if prev:   # traded: the rows come per team; combine
                tp = prev[3] + poss
                prev[1] = round((prev[1] * prev[3] + float(r["PPP"] or 0) * poss) / tp, 3)
                prev[0] = round(prev[0] + 100 * float(r["POSS_PCT"] or 0) * poss / tp, 1)
                prev[3] = round(tp)
            else:
                got[pid][t] = [round(100 * float(r["POSS_PCT"] or 0), 1), round(float(r["PPP"] or 0), 3),
                               round(100 * float(r["PERCENTILE"] or 0)), round(poss)]
    n = 0
    for pid, types in got.items():
        p = by_id.get(pid)
        if p is not None and types:
            p["pt"] = types
            n += 1
    if live:
        pool = defaultdict(list)
        for p in players:
            for t, v in (p.get("pt") or {}).items():
                if v[3] >= SAMPLE_FLAG:
                    pool[t].append(v[1])
        for p in players:
            for t, v in (p.get("pt") or {}).items():
                vals = pool.get(t, [])
                pc = None if (v[3] < SAMPLE_FLAG or len(vals) < POOL_MIN) else _midrank(v[1], vals)
                v[2] = None if pc is None else round(pc)
    return n


def apply_syn(players):
    """Shot-making (m["syn"]) rebuilt from the play-type panel, for the season in progress.

    savant_engine.load_synergy() weights the NBA's percentile by possessions, and in season
    that percentile is ranked inside the NBA's own 10-possession pool: on 2026-10-23 it put
    Ty Jerome at 100 on 20 pick-and-roll possessions, Joel Embiid at 0 on 22 and LeBron James
    at 0 on 18. This recomputes the bar from p["pt"], which by then carries our percentiles
    and their cutoffs, over the play types that earned one — so the bar and the panel under
    it can never tell different stories, and a player with nothing above the cutoffs loses
    the bar rather than wearing a number ranked against four people.

    Runs after apply_playtypes(live=True); n is the possessions behind the types that count.
    """
    n = 0
    for p in players:
        num = den = 0.0
        for v in (p.get("pt") or {}).values():
            if v[2] is None:
                continue
            num += v[2] * v[3]
            den += v[3]
        m = p.setdefault("m", {})
        if den > 0:
            for win in WINDOWS:
                m.setdefault("syn", {})[win] = {"v": round(num / den), "n": round(den)}
            n += 1
        else:
            m.pop("syn", None)      # the engine's NBA-pool number must not outlive this pass
    return n


# ---------------------------------------------------------------- with / without
def load_game_logs(season):
    from nba_api.stats.endpoints import playergamelogs as G
    return E.call(G.PlayerGameLogs, dict(season_nullable=season, season_type_nullable=C.SEASON_TYPE))


SHRINK_GAMES = 5


def apply_with_without(season, players, top=3, min_with=5, min_without=3, min_minutes=12):
    """For each player, the teammates whose absence changes his game the most. Uses game logs:
    games the teammate played vs. games his team played without him, counting only games the
    player himself played. Per-36 points, assists, rebounds and usage (FGA + 0.44·FTA + TOV)."""
    gl = load_game_logs(season)
    by_id = {p["id"]: p for p in players}
    rows = defaultdict(dict)       # (team, game) -> {pid: row}
    for _, r in gl.iterrows():
        rows[(int(r["TEAM_ID"]), str(r["GAME_ID"]))][int(r["PLAYER_ID"])] = r
    team_games = defaultdict(set)
    for (tid, gid) in rows:
        team_games[tid].add(gid)
    by_team_player = defaultdict(lambda: defaultdict(set))   # tid -> pid -> games played
    mins = defaultdict(float)
    for (tid, gid), ps in rows.items():
        for pid, r in ps.items():
            if float(r["MIN"] or 0) > 0:
                by_team_player[tid][pid].add(gid)
                mins[(tid, pid)] += float(r["MIN"] or 0)
    n = 0
    for tid, players_on in by_team_player.items():
        core = sorted(players_on, key=lambda q: -mins[(tid, q)])[:9]     # rotation teammates
        for pid, games in players_on.items():
            p = by_id.get(pid)
            if p is None or len(games) < min_with:
                continue
            out = []
            for t in core:
                if t == pid:
                    continue
                with_g = games & players_on[t]
                wo_g = games - players_on[t]
                if len(with_g) < min_with or len(wo_g) < min_without:
                    continue
                def per36(gs):
                    m = sum(float(rows[(tid, g)][pid]["MIN"] or 0) for g in gs)
                    if m < min_minutes * len(gs) * 0.5 or m <= 0:
                        return None
                    tot = lambda c: sum(float(rows[(tid, g)][pid][c] or 0) for g in gs)
                    usg = tot("FGA") + 0.44 * tot("FTA") + tot("TOV")
                    return dict(min=round(m / len(gs), 1), pts=round(36 * tot("PTS") / m, 1),
                                ast=round(36 * tot("AST") / m, 1), reb=round(36 * tot("REB") / m, 1),
                                usg=round(36 * usg / m, 1))
                w, wo = per36(with_g), per36(wo_g)
                if not w or not wo:
                    continue
                name = str(rows[(tid, next(iter(players_on[t])))][t]["PLAYER_NAME"])
                d = wo["usg"] - w["usg"]
                out.append(dict(id=int(t), name=E._ascii(name), gw=len(with_g), gwo=len(wo_g), w=w, wo=wo,
                                d=round(d, 1), ds=round(d * len(wo_g) / (len(wo_g) + SHRINK_GAMES), 1)))
            # Rank by the change shrunk toward zero by how few games there are without him
            # (ds = d x n/(n+5)), so a 2-game sample doesn't outrank a 27-game one.
            out.sort(key=lambda x: -abs(x["ds"]))
            if out:
                p["ww"] = out[:top]
                n += 1
    return n
