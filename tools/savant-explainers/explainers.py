"""
The explainer behind every Basketball Savant stat: what it is, the formula, where the data
comes from, and how much sample it needs. Adam's rule (Oct 2026): every stat on the site,
old and new, opens one of these when its name is clicked.

This file is the source; `python3 tools/savant-explainers/explainers.py` writes it into
public/basketball-savant.html as `const EXPL={...};` (one JSON object per line, which is
also what scripts/lib/savant-api.mjs reads for the connector). tools/savant-api/check.mjs
fails if any metric on the page has no explainer or one is missing a field.

Fields:  what     plain English: what it measures and why it matters
         formula  exactly how the number is built
         source   where the inputs come from, and from which season
         sample   how much sample it needs before it means something
"""
import json, os, sys

# Settle points measured by ~/Basketball-Savant/settle_points.py (k with last season's prior).
K = dict(ts=422, efg=376, pps=266, tp3=133, tp2=237, ft=67, tp3r=42, ftr=150, p3pt=79, pts=631,
         ast75=596, tov75=1000, reb75=668, stl=1496, blk=841, stk75=1059, drv=447, potast=422,
         ast=501, usg=422, oreb=708, dreb=841, rim=298)

NBA = "NBA.com stats (stats.nba.com)"
BR = "Basketball Reference"
POSS = "POSS = possessions he was on the floor for (NBA tracking from 1996-97; estimated as team pace × minutes ÷ 48 before)."
PRE = f"{NBA}; {BR} before 1996-97."


def settles(key, unit):
    return (f"Settles around {K[key]:,} {unit}: at that point his own record and the prior count equally "
            "(measured on 16 seasons of our data). While a season is live, a ◆ on the bar shows where it is likely to land.")


E = {
 # ---- context
 "mpg": dict(what="Minutes per game. Playing time is the coach's vote of confidence and the context for every other number on the card.",
             formula="MPG = minutes ÷ games played", source=PRE, sample="None: a count. Percentiles rank only qualified players."),
 "minshare": dict(what="The share of his team's total minutes he was on the floor for. An era-neutral read on role: 80% means he was almost never on the bench.",
             formula="Minutes share = 100 × MP ÷ (team MP ÷ 5)",
             source=f"{PRE} Players traded mid-season are left blank (no single team to divide by).", sample="None: a share of what happened."),
 "avail": dict(what="Availability: the share of his team's games he played. Pure durability, separate from how well he played.",
             formula="Availability = 100 × GP ÷ team GP", source=PRE, sample="None. Early in a season it is a share of only a few games."),
 # ---- shooting
 "ts": dict(what="True shooting: one number for scoring efficiency that folds in twos, threes and free throws. When he tries to score, how many points does the team get?",
            formula="TS% = PTS ÷ (2 × (FGA + 0.44 × FTA)). The 0.44 × FTA turns free-throw trips into shot attempts.",
            source=PRE, sample=settles("ts", "shooting attempts (FGA + 0.44 × FTA)")),
 "efg": dict(what="Effective field goal %: shooting accuracy that counts a made three as 1.5 makes, because it is worth 1.5 times as much.",
            formula="eFG% = (FGM + 0.5 × 3PM) ÷ FGA", source=PRE, sample=settles("efg", "field-goal attempts")),
 "pps": dict(what="Points per shot: all his points divided by his field-goal attempts. Free throws and threes both raise it.",
            formula="PPS = PTS ÷ FGA", source=PRE, sample=settles("pps", "field-goal attempts")),
 "tp3": dict(what="Three-point accuracy: the share of his threes that go in.",
            formula="3P% = 100 × 3PM ÷ 3PA", source=PRE, sample=settles("tp3", "three-point attempts")),
 "tp3a": dict(what="Three-point volume: threes attempted per game. Read it next to 3P%: high volume with high accuracy is what bends a defense.",
            formula="3PA per game = 3PA ÷ GP", source=PRE, sample="None: a volume count. Hatched under 100 attempts."),
 "tp3r": dict(what="Three-point rate: the share of his shots that are threes. How much he lives behind the arc; near zero for most pre-1990s players, which is correct.",
            formula="3PA rate = 100 × 3PA ÷ FGA", source=PRE, sample=settles("tp3r", "field-goal attempts")),
 "tp2": dict(what="Two-point accuracy: finishing inside the arc, from rim attacks to floaters to mid-range.",
            formula="2P% = 100 × (FGM − 3PM) ÷ (FGA − 3PA)", source=PRE, sample=settles("tp2", "two-point attempts")),
 "ft": dict(what="Free-throw accuracy. Often the cleanest read on shooting touch, since every attempt is the same shot.",
            formula="FT% = 100 × FTM ÷ FTA", source=PRE, sample=settles("ft", "free-throw attempts")),
 "fta": dict(what="Free-throw attempts per game: how often he gets to the line. Downhill pressure and contact live here.",
            formula="FTA per game = FTA ÷ GP", source=PRE, sample="None: a volume count. Hatched under 300 possessions."),
 "ftr": dict(what="Free-throw rate: trips to the line per shot. A read on rim pressure and foul drawing that doesn't depend on minutes.",
            formula="FT rate = 100 × FTA ÷ FGA", source=PRE, sample=settles("ftr", "field-goal attempts")),
 "p3pt": dict(what="Share of his points that come from threes: perimeter versus rim reliance.",
            formula="% points from 3 = 100 × 3 × 3PM ÷ PTS", source=PRE, sample=settles("p3pt", "points")),
 # ---- creation
 "pts": dict(what="Points per 75 possessions: scoring volume with pace taken out, so a 1985 scorer and a 2025 scorer read on the same scale.",
            formula=f"Points/75 = PTS ÷ POSS × 75. {POSS}", source=PRE, sample=settles("pts", "possessions")),
 "ast": dict(what="Assist %: the share of his teammates' made baskets he assisted while he was on the floor.",
            formula="AST% = 100 × AST ÷ ((MP ÷ (team MP ÷ 5)) × team FGM − FGM)   (the NBA's AST_PCT)",
            source=f"{NBA} advanced stats; {BR} before 1996-97.", sample=settles("ast", "possessions")),
 "ast75": dict(what="Assists per 75 possessions: playmaking volume with pace taken out.",
            formula=f"Assists/75 = AST ÷ POSS × 75. {POSS}", source=PRE, sample=settles("ast75", "possessions")),
 "asttov": dict(what="Assists per turnover: creation weighed against giving the ball away.",
            formula="AST/TO = AST ÷ TOV", source=PRE, sample="Hatched under 300 assists + turnovers."),
 "potast": dict(what="Potential assists per 75: passes after which the teammate shoots (or is fouled shooting) within one dribble, made or missed. Playmaking that doesn't depend on teammates hitting.",
            formula="Potential assists/75 = POTENTIAL_AST ÷ POSS × 75. Rows the NBA publishes as impossible (more potential assists than passes made) are left blank.",
            source=f"{NBA} player tracking (Passing), 2013-14 on.", sample=settles("potast", "possessions")),
 "usg": dict(what="Usage: the share of team possessions he ends with a shot, a trip to the line or a turnover while on the floor. High usage with high efficiency is the rarest combination in basketball.",
            formula="USG% = 100 × (FGA + 0.44 × FTA + TOV) × (team MP ÷ 5) ÷ (MP × (team FGA + 0.44 × team FTA + team TOV))   (the NBA's USG_PCT)",
            source=f"{NBA} advanced stats; {BR} before 1996-97.", sample=settles("usg", "possessions")),
 "tov": dict(what="Turnover %: the share of his plays that end in a turnover. Flipped, so a long red bar means good ball security.",
            formula="TOV% = 100 × TOV ÷ (FGA + 0.44 × FTA + TOV)", source=PRE, sample="Hatched under 300 possessions."),
 "tov75": dict(what="Turnovers per 75 possessions. Flipped, so a long red bar means fewer turnovers.",
            formula=f"Turnovers/75 = TOV ÷ POSS × 75. {POSS}", source=PRE, sample=settles("tov75", "possessions")),
 "oreb": dict(what="Offensive rebound %: the share of available offensive rebounds he grabs while on the floor.",
            formula="OREB% = 100 × OREB × (team MP ÷ 5) ÷ (MP × (team OREB + opponent DREB))   (the NBA's OREB_PCT)",
            source=f"{NBA} advanced stats; {BR} before 1996-97.", sample=settles("oreb", "possessions")),
 "grav": dict(what="Off-ball gravity: how far defenders shade toward him when he doesn't have the ball. High gravity opens the floor for teammates.",
            formula="The NBA's off-ball perimeter gravity score from its tracking cameras (NBA Inside the Game, built with AWS). Their model; its inputs aren't published.",
            source=f"{NBA} Gravity leaders, 2025-26 on.", sample="Hatched under 5,000 tracked frames."),
 "drv": dict(what="Drives per 75: how often he attacks off the dribble into the paint.",
            formula="Drives/75 = DRIVES ÷ POSS × 75. A drive is a touch that starts 20+ feet from the rim and is dribbled within 10 feet of it (fast breaks excluded).",
            source=f"{NBA} player tracking (Drives), 2013-14 on. The NBA re-published 2025-26 drives after July 2026; today's table runs ~40% above the July pull.",
            sample=settles("drv", "possessions")),
 "selfcr": dict(what="Self-creation: the share of his shots taken with a defender within 4 feet. Separates players who make their own shot from players who need to be set up.",
            formula="Self-creation = 100 × (share of his FGA with the closest defender 0–2 ft + share at 2–4 ft). Shown as a word from its league percentile: low, avg, high, elite.",
            source=f"{NBA} player tracking (closest-defender shooting), 2013-14 on.", sample="Hatched under 100 tightly guarded attempts."),
 "syn": dict(what="Shot-making by play type: how efficiently he scores across the plays he actually runs (pick-and-roll, isolation, post-ups, spot-ups and the rest), weighted by how often he runs each.",
            formula="Σ over offensive play types of (his points-per-possession percentile in that type × his possessions in it) ÷ his total play-type possessions",
            source=f"{NBA} Synergy play types, 2015-16 on.", sample="Hatched under 100 play-type possessions."),
 "ddiff": dict(what="Defender difficulty: the average defensive quality of the players who guarded him. Context for his offense: strong numbers against strong defenders count for more.",
            formula="Σ (each defender's DBPM × possessions he guarded him) ÷ Σ possessions",
            source=f"{NBA} matchup tracking (who guarded whom), 2017-18 on; DBPM from {BR}.", sample="Hatched under 200 matchup possessions."),
 "onoff": dict(what="On/off net rating: how much better the team's point margin per 100 possessions is with him on the floor than on the bench. The bluntest measure of team impact; noisy in small minutes.",
            formula="On/Off = team net rating with him on − team net rating with him off. Traded players: minutes-weighted across teams.",
            source=f"{NBA} team on/off splits, 1996-97 on.", sample="Noisy below a few hundred minutes; read it next to the luck-adjusted version."),
 # ---- defense
 "reb75": dict(what="Rebounds per 75 possessions: rebounding volume with pace taken out.",
            formula=f"Rebounds/75 = REB ÷ POSS × 75. {POSS}", source=PRE, sample=settles("reb75", "possessions")),
 "dreb": dict(what="Defensive rebound %: the share of available defensive rebounds he secures while on the floor. A stop isn't over until someone grabs it.",
            formula="DREB% = 100 × DREB × (team MP ÷ 5) ÷ (MP × (team DREB + opponent OREB))   (the NBA's DREB_PCT)",
            source=f"{NBA} advanced stats; {BR} before 1996-97.", sample=settles("dreb", "possessions")),
 "stl": dict(what="Steals per 75 possessions.", formula=f"Steals/75 = STL ÷ POSS × 75. {POSS}", source=PRE, sample=settles("stl", "possessions")),
 "blk": dict(what="Blocks per 75 possessions.", formula=f"Blocks/75 = BLK ÷ POSS × 75. {POSS}", source=PRE, sample=settles("blk", "possessions")),
 "stk75": dict(what="Stocks per 75: steals plus blocks, one count of defensive disruption.",
            formula=f"Stocks/75 = (STL + BLK) ÷ POSS × 75. {POSS}", source=PRE, sample=settles("stk75", "possessions")),
 "stlpct": dict(what="Steal %: the share of opponent possessions he ends with a steal while on the floor.",
            formula="STL% = 100 × STL × (team MP ÷ 5) ÷ (MP × opponent possessions)", source=PRE, sample="Hatched under 1,000 possessions."),
 "blkpct": dict(what="Block %: the share of opponent two-point attempts he blocks while on the floor. The cleanest box-score rim-protection signal from before tracking.",
            formula="BLK% = 100 × BLK × (team MP ÷ 5) ÷ (MP × (opponent FGA − opponent 3PA))", source=PRE, sample="Hatched under 1,000 possessions."),
 "rim": dict(what="Rim protection: how opponents shoot within 6 feet when he is the closest defender, against how those same shooters normally finish there. Negative is good; the bar is flipped.",
            formula="Rim diff = opponents' FG% within 6 ft vs. him − their usual FG% within 6 ft (percentage points)",
            source=f"{NBA} player tracking (defense, less than 6 ft), 2013-14 on.", sample=settles("rim", "contested shots at the rim")),
 "mtch": dict(what="Matchup difficulty: the scoring level of the players he's assigned to guard. Context for the rest of his defense.",
            formula="Σ (each opponent's points per game × possessions he guarded him) ÷ Σ possessions",
            source=f"{NBA} matchup tracking, 2017-18 on.", sample="Hatched under 200 matchup possessions."),
 "oppfg": dict(what="Matchup defense: how the players he guards shoot against him compared with the league's matchup average. Negative is good; the bar is flipped.",
            formula="Opp FG% diff = 100 × (FGM allowed ÷ FGA allowed on his matchups − league matchup FG%)",
            source=f"{NBA} matchup tracking, 2017-18 on.", sample="Hatched under 100 shots defended."),
 "defl": dict(what="Deflections per 75: tipped passes and dribbles. The best single hustle indicator of defensive playmaking.",
            formula="Deflections/75 = DEFLECTIONS ÷ POSS × 75 (full season only; the NBA doesn't split hustle stats by recent games)",
            source=f"{NBA} hustle stats, 2015-16 on.", sample="Hatched under 300 possessions."),
 # ---- physical
 "height": dict(what="Height as listed by the league.", formula="Listed height in inches, shown as feet and inches (rounded to the nearest inch).",
            source=f"{NBA} player bio stats.", sample="None."),
 "length": dict(what="Wingspan. For contesting shots and clogging passing lanes, arms matter more than height.",
            formula="Measured wingspan at the NBA Draft Combine, rounded to the nearest inch.",
            source="NBA Draft Combine measurements, 2018 classes on. Players measured earlier, or never, show blank.", sample="None: one measurement."),
 "reach": dict(what="Standing reach: how high his hands get without leaving the floor. The base of rim protection.",
            formula="Combine standing reach, rounded to the nearest inch.", source="NBA Draft Combine measurements, 2018 classes on.", sample="None: one measurement."),
 "strength": dict(what="Weight, as a stand-in for strength: holding ground in the post and playing through contact.",
            formula="Listed weight in pounds.", source=f"{NBA} player bio stats.", sample="None."),
 "lateral": dict(what="Lane agility time: side-to-side quickness. Lower is quicker; the bar is flipped.",
            formula="Combine lane agility drill time, seconds.", source="NBA Draft Combine drills, 2018 classes on.", sample="None: one measurement."),
 "vert": dict(what="Maximum vertical leap.", formula="Combine maximum (running) vertical, inches.",
            source="NBA Draft Combine drills, 2018 classes on.", sample="None: one measurement."),
 # ---- value
 "per": dict(what="Player Efficiency Rating: a per-minute summary of box-score production, scaled so 15 is league average. A model estimate, not a measurement.",
            formula="Hollinger's PER: a weighted sum of box-score events per minute, adjusted for team pace, scaled to a league average of 15.",
            source=f"{BR} (their published PER).", sample="Unreliable below ~500 minutes."),
 "ws48": dict(what="Win Shares per 48 minutes: estimated wins produced per 48 minutes. .100 is a solid starter, .200+ is elite. A model estimate.",
            formula="(Offensive Win Shares + Defensive Win Shares) × 48 ÷ MP, built from points produced and allowed against a replacement baseline (Basketball Reference's method).",
            source=f"{BR}.", sample="Unreliable below ~500 minutes."),
 "bpm": dict(what="Box Plus/Minus: estimated points per 100 possessions he adds over a league-average player. 0 is average, +5 is All-NBA. A model estimate.",
            formula="BPM 2.0: a regression of box-score rates (with position and role) onto long-run plus-minus, adjusted so a team's players sum to its rating.",
            source=f"{BR}.", sample="Unreliable below ~500 minutes."),
 "obpm": dict(what="The offensive half of BPM.", formula="OBPM: the offensive regression of BPM 2.0.", source=f"{BR}.", sample="Unreliable below ~500 minutes."),
 "dbpm": dict(what="The defensive half of BPM: the best pre-tracking defensive signal, but still a box-score estimate.",
            formula="DBPM = BPM − OBPM", source=f"{BR}.", sample="Unreliable below ~500 minutes."),
 "vorp": dict(what="Value Over Replacement Player: total value above a replacement-level player (BPM −2.0), scaled to a full season. A counting stat: rewards quality and durability.",
            formula="VORP = (BPM + 2.0) × (share of team minutes played) × (team games ÷ 82)", source=f"{BR}.", sample="None: grows with minutes."),
 "gmsc": dict(what="Game Score per game: Hollinger's single-number game rating, averaged. About 10 is a solid night; 40+ is legendary.",
            formula="Game Score = PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA − FTM) + 0.7·OREB + 0.3·DREB + STL + 0.7·AST + 0.7·BLK − 0.4·PF − TOV, averaged per game",
            source=PRE, sample="None: an average of games."),
 # ---- October 2026 additions
 "ppaint": dict(what="Share of his points scored in the paint: how much of his scoring comes at or near the rim.",
            formula="% points in the paint = 100 × points in the paint ÷ PTS (the NBA's PCT_PTS_PAINT)",
            source=f"{NBA} scoring splits, tagged from the play-by-play, 1996-97 on.", sample="Hatched under 200 points."),
 "xefg": dict(what="Shot quality: the eFG% an average NBA shooter would post on exactly the shots he takes. High means he gets good looks (rim attempts, open corner threes); low means a hard shot diet.",
            formula="xeFG% = mean over his shots of P(make) × (1.5 for a three, 1 for a two). P(make) comes from our model of 2.7M shots, 2013-14 through 2025-26: shot location, distance, the NBA's action type (pull-up, step-back, driving layup...), 2 vs 3, period and time left. The shooter is not an input. Each season is re-centred so the league's expected eFG equals its actual eFG.",
            source=f"{NBA} shot chart (every field-goal attempt), 2013-14 on. Model: ~/Basketball-Savant/xfg_model.py, validated on a season it never saw: trained through 2024-25, it scored 2025-26 better than a shot-zone table (log loss 0.638 vs 0.658) and was calibrated within 2 points in every decile (out/xfg_report.txt).",
            sample="Hatched under 200 field-goal attempts."),
 "shotmk": dict(what="Shot-making: how much better (or worse) he shoots than an average player would on the same shots. The part of his efficiency that is his touch, not his shot selection.",
            formula="Shot-making = 100 × (his actual eFG% − his expected eFG%), in percentage points. +5 means he scores 5 eFG points above what those shots usually produce.",
            source=f"{NBA} shot chart, 2013-14 on, through the shot-quality model above.", sample="Hatched under 200 field-goal attempts; shooting luck is large, so a full season says far more than a month."),
 "uast": dict(what="Unassisted makes: the share of his made field goals that nobody assisted. High means he creates his own baskets; low means he finishes what others set up.",
            formula="Unassisted makes % = 100 × unassisted FGM ÷ FGM (the NBA's PCT_UAST_FGM)",
            source=f"{NBA} scoring splits, each make tagged assisted or not from the play-by-play, 1996-97 on.", sample="Hatched under 100 made field goals."),
 "uast3": dict(what="Unassisted threes: the share of his made threes that nobody assisted. Separates pull-up shooters from catch-and-shoot shooters.",
            formula="Unassisted 3s % = 100 × unassisted 3PM ÷ 3PM (the NBA's PCT_UAST_3PM)",
            source=f"{NBA} scoring splits, 1996-97 on.", sample="Hatched under 50 made threes."),
 "onoffadj": dict(what="On/off with the luck taken out: the same on-minus-off net rating, after replacing the opponents' three-point and free-throw shooting with league average. Opponents' 3P% and FT% while one player is on the floor are almost all noise, and they swing raw on/off by several points.",
            formula="For his on and off minutes separately: net rating + 100 × (3 × (opp 3PM − opp 3PA × league 3P%) + (opp FTM − opp FTA × league FT%)) ÷ possessions. Luck-adjusted on/off = adjusted on − adjusted off; traded players are minutes-weighted. His own team's shooting is left alone: a shooter raising his team's 3P% is real.",
            source=f"{NBA} team on/off details (opponent and advanced splits), 1996-97 on.", sample="Still noisy below ~1,000 minutes; steadier than raw on/off."),
 "pt": dict(what="Play types: how his offense is built (pick-and-roll, isolation, spot-ups and the rest) and how well each part works.",
            formula="For each play type: share = his possessions in it ÷ all his play-type possessions; points per possession = points ÷ possessions; percentile = the NBA's, among every player who ran that play type. Traded players are combined, possession-weighted.",
            source=f"{NBA} Synergy play types, 2015-16 on.", sample="Percentiles on under ~25 possessions in a play type are mostly noise."),
 "ww": dict(what="With / without: what happens to his game when a teammate sits. The three teammates whose absence changes his usage the most, ranked after allowing for how few games there are without them.",
            formula="From game logs: his per-36 usage (FGA + 0.44·FTA + TOV), points, assists, rebounds and minutes in games the teammate played vs. games the team played without him (only games he himself played). Ranking: change in usage × n ÷ (n + 5), n = games without.",
            source=f"{NBA} game logs.", sample="5+ games with and 3+ without; games without a teammate are usually few, so read the game counts."),
 # ---- Inferred Defensive Role (bigs)
 "perim": dict(what="Perimeter Assignment Rate: the share of his defensive matchups spent on guards. Role, not ability: scheme drives much of it, and assignment is least reliable during switches.",
            formula="Perimeter rate = possessions guarding guards ÷ all matchup possessions", source=f"{NBA} matchup tracking, 2017-18 on.",
            sample="Bigs with 15+ MPG and 200+ contested shots."),
 "contest": dict(what="Rim Contest Rate: of the shots he defended as the closest defender, the share taken within 6 feet. High marks a back-line, rim-anchoring role.",
            formula="Contest rate = shots defended within 6 ft ÷ all shots defended", source=f"{NBA} player tracking (defense), 2013-14 on.",
            sample="Bigs with 15+ MPG and 200+ contested shots."),
 "rimpm": dict(what="Rim FG% Allowed vs Expected: how shooters at the rim finished against him versus their normal rate. Inverted, so holding shooters down ranks higher. Ranked among bigs only.",
            formula="Rim FG% vs. expected = opponents' FG% within 6 ft vs. him − their usual FG% within 6 ft", source=f"{NBA} player tracking (defense), 2013-14 on.",
            sample="Bigs with 15+ MPG and 200+ contested shots."),
}

# the Fantasy / Teams / Lineups tabs and the projection panel (public/savant-fantasy.js, savant-teams.js)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from explainers_tabs import T as _TABS  # noqa: E402
E.update(_TABS)

FIELDS = ("what", "formula", "source", "sample")


def render():
    for k, v in E.items():
        missing = [f for f in FIELDS if not v.get(f)]
        if missing:
            sys.exit(f"{k}: missing {missing}")
    lines = [f" {k}:{json.dumps({f: E[k][f] for f in FIELDS}, ensure_ascii=False)}," for k in E]
    lines[-1] = lines[-1].rstrip(",")
    return "const EXPL={\n" + "\n".join(lines) + "\n};"


if __name__ == "__main__":
    page = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "basketball-savant.html")
    s = open(page, encoding="utf-8").read()
    i = s.index("const EXPL={")
    j = s.index("\n};", i) + 3
    s = s[:i] + render() + s[j:]
    open(page, "w", encoding="utf-8").write(s)
    print(f"wrote {len(E)} explainers into public/basketball-savant.html")
