"""Pull the extra NBA.com data the Spurs article needs. Runs on Adam's Mac (stats.nba.com blocks cloud IPs).
Writes one JSON per call into ~/wce-film/xfer/spurs-article-data/. Safe to re-run: skips files already there."""
import json, os, sys, time, traceback
from nba_api.stats import endpoints as E

OUT = os.path.expanduser("~/wce-film/xfer/spurs-article-data")
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, "pbp"), exist_ok=True)
SAS = 1610612759
P = {"fox": 1628368, "castle": 1642264, "harper": 1642844, "wemby": 1641705,
     "vassell": 1630170, "champagnie": 1630577, "keldon": 1629640, "barnes": 203084}
S = "2025-26"
LOG = open(os.path.join(OUT, "_log.txt"), "a")

def save(name, fn):
    path = os.path.join(OUT, name + ".json")
    if os.path.exists(path):
        return
    for attempt in range(3):
        try:
            ep = fn()
            json.dump(ep.get_dict(), open(path, "w"))
            print("ok", name, flush=True); LOG.write(f"ok {name}\n"); LOG.flush()
            time.sleep(0.8)
            return
        except Exception as e:
            print("ERR", name, attempt, repr(e)[:200], flush=True)
            LOG.write(f"ERR {name} {attempt} {repr(e)[:300]}\n"); LOG.flush()
            time.sleep(3 + 4 * attempt)

T = dict(timeout=60)
STYPES = [("rs", "Regular Season"), ("po", "Playoffs")]

# 1. Lineups: 2-, 3-, 4-, 5-man for SAS, regular season and playoffs, Advanced + Base + Four Factors
for gq in (2, 3, 4, 5):
    for tag, st in STYPES:
        for mt in ("Advanced", "Base", "Opponent"):
            save(f"lineups_{gq}_{tag}_{mt}", lambda gq=gq, st=st, mt=mt: E.LeagueDashLineups(
                team_id_nullable=SAS, group_quantity=gq, season=S, season_type_all_star=st,
                measure_type_detailed_defense=mt, per_mode_detailed="Totals", **T))

# 2. Game logs: players and team, regular season + playoffs, Base + Advanced
for tag, st in STYPES:
    for mt in ("Base", "Advanced", "Usage"):
        save(f"pgamelogs_{tag}_{mt}", lambda st=st, mt=mt: E.PlayerGameLogs(
            team_id_nullable=SAS, season_nullable=S, season_type_nullable=st,
            measure_type_player_game_logs_nullable=mt, **T))
    save(f"tgamelogs_{tag}", lambda st=st: E.TeamGameLogs(team_id_nullable=SAS, season_nullable=S, season_type_nullable=st, **T))

# 3. On/off for each guard + Wemby (regular season)
for tag, st in STYPES:
    for mt in ("Advanced", "Base", "Opponent"):
        save(f"onoff_{tag}_{mt}", lambda st=st, mt=mt: E.TeamPlayerOnOffDetails(
            team_id=SAS, season=S, season_type_all_star=st, measure_type_detailed_defense=mt,
            per_mode_detailed="Totals", **T))

# 4. Shot tracking: catch-and-shoot vs pull-up, closest defender, by player
for k in ("fox", "castle", "harper", "wemby", "vassell", "champagnie"):
    save(f"ptshots_{k}", lambda k=k: E.PlayerDashPtShots(player_id=P[k], team_id=SAS, season=S,
         season_type_all_star="Regular Season", per_mode_simple="Totals", **T))
    save(f"ptpass_{k}", lambda k=k: E.PlayerDashPtPass(player_id=P[k], team_id=SAS, season=S,
         season_type_all_star="Regular Season", per_mode_simple="Totals", **T))
    save(f"shotdash_{k}", lambda k=k: E.PlayerDashboardByShootingSplits(player_id=P[k], season=S,
         season_type_playoffs="Regular Season", per_mode_detailed="Totals", **T))

# 5. League-wide tracking (all players): catch-and-shoot and pull-up, plus closest-defender 3s
for pt in ("CatchShoot", "PullUpShot", "Drives", "Passing", "Possessions", "ElbowTouch", "PostTouch", "PaintTouch"):
    save(f"lg_track_{pt}", lambda pt=pt: E.LeagueDashPtStats(season=S, season_type_all_star="Regular Season",
         player_or_team="Player", pt_measure_type=pt, per_mode_simple="Totals", **T))
for rng in ("0-2 Feet - Very Tight", "2-4 Feet - Tight", "4-6 Feet - Open", "6+ Feet - Wide Open"):
    key = rng.split(" ")[0]
    save(f"lg_closedef_{key}", lambda rng=rng: E.LeagueDashPlayerPtShot(season=S, season_type_all_star="Regular Season",
         per_mode_simple="Totals", close_def_dist_range_nullable=rng, **T))
save("lg_ptshot_all", lambda: E.LeagueDashPlayerPtShot(season=S, season_type_all_star="Regular Season", per_mode_simple="Totals", **T))

# 6. Synergy play types: offense + defense, player level, league-wide (for percentiles)
for pt in ("Isolation", "PRBallHandler", "PRRollman", "Spotup", "Cut", "Transition", "Handoff", "OffScreen", "Postup"):
    for tg in ("offensive", "defensive"):
        save(f"syn_{pt}_{tg}", lambda pt=pt, tg=tg: E.SynergyPlayTypes(season=S, season_type_all_star="Regular Season",
             player_or_team_abbreviation="P", play_type_nullable=pt, type_grouping_nullable=tg,
             per_mode_simple="Totals", **T))
        save(f"synteam_{pt}_{tg}", lambda pt=pt, tg=tg: E.SynergyPlayTypes(season=S, season_type_all_star="Regular Season",
             player_or_team_abbreviation="T", play_type_nullable=pt, type_grouping_nullable=tg,
             per_mode_simple="Totals", **T))

# 7. Hustle + league advanced (for distributions)
save("lg_hustle", lambda: E.LeagueHustleStatsPlayer(season=S, season_type_all_star="Regular Season", per_mode_time="Totals", **T))
for mt in ("Advanced", "Base", "Usage", "Scoring", "Defense"):
    save(f"lg_players_{mt}", lambda mt=mt: E.LeagueDashPlayerStats(season=S, season_type_all_star="Regular Season",
         measure_type_detailed_defense=mt, per_mode_detailed="Totals", **T))
save("lg_teams_adv", lambda: E.LeagueDashTeamStats(season=S, season_type_all_star="Regular Season",
     measure_type_detailed_defense="Advanced", per_mode_detailed="Totals", **T))
save("lg_teams_four", lambda: E.LeagueDashTeamStats(season=S, season_type_all_star="Regular Season",
     measure_type_detailed_defense="Four Factors", per_mode_detailed="Totals", **T))

# 8. Defensive matchups for Fox/Castle/Harper (who they guarded, and who attacked them)
for k in ("fox", "castle", "harper"):
    save(f"matchups_def_{k}", lambda k=k: E.LeagueSeasonMatchups(def_player_id_nullable=P[k], season=S,
         season_type_playoffs="Regular Season", per_mode_simple="Totals", **T))

# 9. 2026-27 preseason: the three-guard start
save("pre_tgamelogs", lambda: E.TeamGameLogs(team_id_nullable=SAS, season_nullable="2026-27", season_type_nullable="Pre Season", **T))
save("pre_pgamelogs", lambda: E.PlayerGameLogs(team_id_nullable=SAS, season_nullable="2026-27", season_type_nullable="Pre Season", **T))
for gq in (3, 5):
    save(f"pre_lineups_{gq}", lambda gq=gq: E.LeagueDashLineups(team_id_nullable=SAS, group_quantity=gq, season="2026-27",
         season_type_all_star="Pre Season", measure_type_detailed_defense="Advanced", per_mode_detailed="Totals", **T))

# 10. Play-by-play for every Spurs game (regular season + playoffs + preseason), for lobs and shared-minute stints
ids = []
for f in ("tgamelogs_rs", "tgamelogs_po", "pre_tgamelogs"):
    p = os.path.join(OUT, f + ".json")
    if os.path.exists(p):
        d = json.load(open(p))["resultSets"][0]
        gi = d["headers"].index("GAME_ID")
        ids += [r[gi] for r in d["rowSet"]]
print("games", len(ids), flush=True)
for g in ids:
    save(f"pbp/{g}", lambda g=g: E.PlayByPlayV3(game_id=g, **T))
print("DONE", flush=True)
