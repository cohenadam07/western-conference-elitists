"""The Football Savant metric table.

One row per bar the tool can draw. Read the fields as:

  key    stable id, used by the page and by shareable URLs
  exp    what it is / why it matters / the formula, in plain language (see explain.py).
         Every metric must have one — M() raises if a key is missing from EXPLAIN.
  label  what a reader sees
  grp    which panel it lands in
  sub    subheading inside the panel
  layer  ingredient | output | expected | context  (same taxonomy as Basketball Savant)
  unit   how to format the number
  lower  true when a smaller number is better; the page flips the percentile
  tier   era gate: the metric is hidden in seasons that never tracked it
  den    which denominator governs its sample size (see DENOMS)
  thr    how much of that denominator before the number stops wobbling
  pos    which positional cohorts the row applies to

TIERS. Football's data history has five hard edges, and pretending otherwise is how a
1999 season ends up compared against numbers nobody was recording:
  1  1999  play-by-play: box score, EPA, success rate, run gaps
  2  2006  air yards: aDOT, CPOE, throw maps, deep-shot rate
  3  2012  targets: the gamebooks start naming the receiver on incompletions too, so
           target share, catch rate and every per-target rate begin here
  4  2013  snap counts
  5  2016  Next Gen Stats tracking
  6  2018  Pro-Football-Reference charting (pressure, broken tackles, coverage)
  7  2022  FTN charting (blitzers, play-action, RPO, catchable balls, drops, box counts)

PFR publishes a season at a time, months after it ends, so every tier-6 row goes blank
each September and stays blank until spring. FTN posts weekly, in season, which is why
the rows it can carry were moved onto it.
"""

from explain import EXPLAIN

TIER_SINCE = {1: 1999, 2: 2006, 3: 2012, 4: 2013, 5: 2016, 6: 2018, 7: 2022}

# Sample-size denominators. A metric's stabilization threshold is expressed in whichever
# of these it actually accumulates, so the page can hatch a bar honestly rather than
# guessing from games played.
DENOMS = {
    'db': 'dropbacks', 'att': 'pass attempts', 'car': 'carries', 'tgt': 'targets',
    'rec': 'receptions', 'snap': 'snaps', 'dsnap': 'defensive snaps',
    'pblk': 'pass-blocking snaps', 'rblk': 'run-blocking snaps',
    'ctgt': 'targets defended', 'fga': 'field goal attempts', 'punt': 'punts',
    'g': 'games',
    # the denominators the October 2026 rows are built on
    'prs': 'pressures', 'des': 'designed runs', 'scrn': 'scrambles', 'sneak': 'sneaks',
    'drv': 'drives', 'ngdb': 'dropbacks in competitive time',
    'attsh': 'short attempts', 'attmd': 'intermediate attempts', 'attdp': 'deep attempts',
    'carl': 'carries into a light box', 'cars': 'carries into a stacked box',
    'cargap': 'carries with a charted gap', 'carin': 'inside carries',
    'carout': 'outside carries', 'car5': 'carries inside the 5',
    'sy': 'short-yardage carries', 'tgt3': 'third- and fourth-down targets',
    'tgtsh': 'short targets', 'tgtmd': 'intermediate targets', 'tgtdp': 'deep targets',
    'psnap': 'pass-play snaps', 'gaprun': 'runs behind him', 'gmiss': 'games he missed',
    'rtkl': 'run tackles', 'dpass': 'pass-play snaps', 'drun': 'run-play snaps',
    'sk': 'sacks', 'ptk': 'tackles after a catch', 'ko': 'kickoffs',
    'fgaout': 'outdoor field goal attempts', 'kr': 'kick returns', 'pr': 'punt returns',
}

SKILL = ['QB', 'RB', 'WR', 'TE']
PASSC = ['WR', 'TE', 'RB']
DEF = ['ED', 'DI', 'LB', 'CB', 'S']
FRONT = ['ED', 'DI', 'LB']
COV = ['CB', 'S', 'LB']
# A lineman's cohort is his spot on the line where the depth charts say so (2001 on) and
# the undifferentiated OL where they don't, so every blocking row applies to all four.
OLINE = ['OL', 'OT', 'OG', 'OC']
ALL = ['QB', 'RB', 'WR', 'TE', 'OL', 'OT', 'OG', 'OC',
       'ED', 'DI', 'LB', 'CB', 'S', 'K', 'P']
# who returns kicks and covers them
STPOS = ['RB', 'WR', 'TE', 'LB', 'CB', 'S']


# A running back's season is 40 targets and a tight end's 50. A sample line written for a
# receiver's 150 is one a back can never reach - no back since 2012 has - so every one of
# his receiving bars would be drawn as "still settling" for his whole career. The line a
# bar is drawn against is therefore capped at what his position can actually accumulate.
# `thr` itself stays what it was: it is the stabilization point the regressed estimate
# leans on, and that is a fact about the stat, not about who is catching the ball.
POS_LINE = {'tgt': {'RB': 40, 'TE': 60}, 'rec': {'RB': 30, 'TE': 40},
            'snap': {'RB': 150}, 'psnap': {'RB': 120, 'TE': 180}}


def M(key, label, grp, sub, layer, unit, pos, tier=1, den='g', thr=0, lower=False):
    # `exp` (explain.py) is the single source of truth for a metric's prose: what it is,
    # why it matters, and the formula. There is deliberately no second caveat field —
    # anything worth saying belongs in the explanation a reader actually opens.
    out = dict(key=key, label=label, grp=grp, sub=sub, layer=layer, unit=unit,
               pos=list(pos), tier=tier, den=den, thr=thr, lower=lower,
               since=TIER_SINCE[tier], exp=EXPLAIN[key])
    caps = {p: c for p, c in POS_LINE.get(den, {}).items() if p in pos and thr > c}
    if grp == 'rec' and caps:
        out['thrp'] = caps
    return out


METRICS = [
    # ---------------------------------------------------------------- context
    M('g',        'Games played',        'ctx', '', 'context', 'num0', ALL),
    M('avail',    'Availability',        'ctx', '', 'context', 'pct1', ALL),
    M('snaps',    'Snaps / game',        'ctx', '', 'context', 'num1', ALL, tier=4),
    M('snapshr',  'Snap share',          'ctx', '', 'context', 'pct1', ALL, tier=4),
    M('pen',      'Penalties / game',    'ctx', '', 'output',  'num2', ALL, lower=True, den='g', thr=8),
    M('passshr',  'Pass-play share of snaps', 'ctx', '', 'context', 'pct1', DEF, tier=5, den='dsnap', thr=150),

    # ---------------------------------------------------------------- passing
    M('epadb',    'EPA / dropback',      'pass', 'Efficiency', 'output',   'num3', ['QB'], den='db', thr=200),
    M('cpoe',     'CPOE',                'pass', 'Efficiency', 'expected', 'sgn1', ['QB'], tier=2, den='att', thr=200),
    M('comp',     'EPA + CPOE composite', 'pass', 'Efficiency', 'expected', 'num2', ['QB'], tier=2, den='db', thr=200),
    M('anya',     'ANY/A',               'pass', 'Efficiency', 'output',   'num2', ['QB'], den='att', thr=200),
    M('srdb',     'Success rate',        'pass', 'Efficiency', 'output',   'pct1', ['QB'], den='db', thr=200),
    M('cmppct',   'Completion %',        'pass', 'Efficiency', 'output',   'pct1', ['QB'], den='att', thr=150),
    M('ypa',      'Yards / attempt',     'pass', 'Efficiency', 'output',   'num2', ['QB'], den='att', thr=150),
    M('rate',     'Passer rating',       'pass', 'Efficiency', 'output',   'num1', ['QB'], den='att', thr=150),
    M('qbr',      'Total QBR',           'pass', 'Efficiency', 'output',   'num1', ['QB'], tier=2, den='db', thr=200),
    M('tdpct',    'TD %',                'pass', 'Efficiency', 'output',   'pct1', ['QB'], den='att', thr=250),
    M('intpct',   'INT %',               'pass', 'Efficiency', 'output',   'pct1', ['QB'], den='att', thr=400, lower=True),
    M('twrate',   'Turnover-worthy rate', 'pass', 'Efficiency', 'output',  'pct1', ['QB'], den='db', thr=300, lower=True),
    M('sackpct',  'Sack rate',           'pass', 'Pocket',     'output',   'pct1', ['QB'], den='db', thr=200, lower=True),
    M('ttt',      'Time to throw',       'pass', 'Pocket',     'ingredient', 'sec', ['QB'], tier=5, den='att', thr=150),
    M('pocket',   'Pocket time',         'pass', 'Pocket',     'ingredient', 'sec', ['QB'], tier=6, den='att', thr=150),
    M('prsspct',  'Pressure rate faced', 'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200, lower=True),
    M('p2s',      'Sacks per pressure',  'pass', 'Pocket',     'output',   'pct1', ['QB'], tier=6, den='prs', thr=60, lower=True),
    M('hitpct',   'Hit rate',            'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200, lower=True),
    M('hurrypct', 'Hurry rate',          'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200, lower=True),
    M('blitzpct', 'Blitz rate faced',    'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200),
    M('rushfaceq','Pass rushers faced',  'pass', 'Pocket',     'context',  'num2', ['QB'], tier=7, den='db', thr=200),
    M('oop',      'Out-of-pocket rate',  'pass', 'Pocket',     'ingredient', 'pct1', ['QB'], tier=7, den='db', thr=200),
    M('faultsack','Sacks that were his fault', 'pass', 'Pocket', 'output',  'pct1', ['QB'], tier=7, den='db', thr=250, lower=True),
    M('scrrate',  'Scramble rate',       'pass', 'Pocket',     'ingredient', 'pct1', ['QB'], den='db', thr=150),
    M('adot',     'Average depth of target', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=2, den='att', thr=150),
    M('aysticks', 'Air yards to sticks', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=5, den='att', thr=150),
    M('aggr',     'Aggressiveness',      'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=5, den='att', thr=150),
    M('deeprate', 'Deep attempt rate',   'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=2, den='att', thr=150),
    M('parate',   'Play-action rate',    'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=6, den='db', thr=150),
    M('rporate',  'RPO rate',            'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=6, den='db', thr=150),
    M('screen',   'Screen rate',         'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('motion',   'Pre-snap motion rate', 'pass', 'Shot selection', 'context', 'pct1', ['QB'], tier=7, den='db', thr=150),
    M('nohuddle', 'No-huddle rate',      'pass', 'Shot selection', 'context', 'pct1', ['QB'], tier=7, den='db', thr=150),
    M('ucrate',   'Under-center rate',   'pass', 'Shot selection', 'context', 'pct1', ['QB'], tier=7, den='db', thr=150),
    M('yacshr',   'After-catch share of yards', 'pass', 'Shot selection', 'context', 'pct1', ['QB'], tier=2, den='att', thr=150),
    M('airdist',  'Average air distance', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=5, den='att', thr=150),
    M('maxair',   'Longest air distance', 'pass', 'Shot selection', 'context', 'num1', ['QB'], tier=5),
    M('firstread', 'First-read throw rate', 'pass', 'Reads', 'ingredient', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('checkdown', 'Checkdown rate',     'pass', 'Reads', 'ingredient', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('xcomp',    'Expected completion %', 'pass', 'Accuracy', 'expected', 'pct1', ['QB'], tier=5, den='att', thr=150),
    M('ontgt',    'On-target %',         'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=6, den='att', thr=150),
    M('badthrow', 'Bad throw %',         'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=6, den='att', thr=150, lower=True),
    M('droppct',  'Drop % (his throws)', 'pass', 'Accuracy', 'context', 'pct1', ['QB'], tier=6, den='att', thr=200, lower=True),
    M('catchable', 'Catchable ball %',   'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('throwaway', 'Throwaway rate',     'pass', 'Accuracy', 'ingredient', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('iwrate',   'Interception-worthy rate', 'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=7, den='att', thr=200, lower=True),
    M('ngscpoe',  'CPOE (tracking)',     'pass', 'Accuracy', 'expected', 'sgn1', ['QB'], tier=5, den='att', thr=200),
    M('intluck',  'Interception luck',   'pass', 'Accuracy', 'context', 'sgn1', ['QB'], tier=7, den='att', thr=300),
    M('cmpsh',    'Completion %, short', 'pass', 'By depth', 'output', 'pct1', ['QB'], tier=2, den='attsh', thr=120),
    M('cmpmd',    'Completion %, intermediate', 'pass', 'By depth', 'output', 'pct1', ['QB'], tier=2, den='attmd', thr=60),
    M('cmpdp',    'Completion %, deep',  'pass', 'By depth', 'output', 'pct1', ['QB'], tier=2, den='attdp', thr=40),
    M('ypadp',    'Yards / attempt, deep', 'pass', 'By depth', 'output', 'num2', ['QB'], tier=2, den='attdp', thr=40),
    M('fddb',     'First-down rate',     'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=200),
    M('td3conv',  'Third/fourth-down conversion', 'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=80),
    M('rztd',     'Red-zone TD rate',    'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=60),
    M('epang',    'EPA / dropback, competitive time', 'pass', 'Situational', 'output', 'num3', ['QB'], den='ngdb', thr=150),
    M('wpadb',    'Wins added / 100 dropbacks', 'pass', 'Situational', 'output', 'sgn3', ['QB'], den='db', thr=200),
    M('ppd',      'Points per drive',    'pass', 'Drives', 'output', 'num2', ['QB'], den='drv', thr=60),
    M('scorepct', 'Scoring-drive rate',  'pass', 'Drives', 'output', 'pct1', ['QB'], den='drv', thr=60),
    M('toopct',   'Three-and-out rate',  'pass', 'Drives', 'output', 'pct1', ['QB'], den='drv', thr=60, lower=True),

    # ---------------------------------------------------------------- rushing
    M('car',      'Carries / game',      'rush', 'Volume', 'context', 'num1', ['RB', 'QB', 'WR', 'TE']),
    M('rushy',    'Rushing yards / game', 'rush', 'Volume', 'output', 'num1', ['RB', 'QB', 'WR'], den='g', thr=8),
    M('carshr',   'Share of team carries', 'rush', 'Volume', 'context', 'pct1', ['RB'], den='g', thr=6),
    M('desg',     'Designed runs / game', 'rush', 'Volume', 'context', 'num1', ['QB']),
    M('scrg',     'Scrambles / game',    'rush', 'Volume', 'context', 'num1', ['QB']),
    M('epacar',   'EPA / carry',         'rush', 'Efficiency', 'output', 'num3', ['RB', 'QB', 'WR'], den='car', thr=120),
    M('srcar',    'Rush success rate',   'rush', 'Efficiency', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=100),
    M('ypc',      'Yards / carry',       'rush', 'Efficiency', 'output', 'num2', ['RB', 'QB', 'WR'], den='car', thr=120),
    M('ryoe',     'Rush yards over expected / att', 'rush', 'Efficiency', 'expected', 'num2', ['RB', 'QB'], tier=5, den='car', thr=100),
    M('roepct',   'Runs over expected %', 'rush', 'Efficiency', 'expected', 'pct1', ['RB'], tier=5, den='car', thr=100),
    M('ngseff',   'Ground covered per yard gained', 'rush', 'Efficiency', 'ingredient', 'num2', ['RB'], tier=5, den='car', thr=100, lower=True),
    M('epades',   'EPA / designed run',  'rush', 'Efficiency', 'output', 'num3', ['QB'], den='des', thr=50),
    M('epascr',   'EPA / scramble',      'rush', 'Efficiency', 'output', 'num3', ['QB'], den='scrn', thr=25),
    M('ypscr',    'Yards / scramble',    'rush', 'Efficiency', 'output', 'num2', ['QB'], den='scrn', thr=25),
    M('ybc',      'Yards before contact / att', 'rush', 'Contact', 'context', 'num2', ['RB'], tier=6, den='car', thr=100),
    M('yacr',     'Yards after contact / att', 'rush', 'Contact', 'output', 'num2', ['RB'], tier=6, den='car', thr=100),
    M('brkrate',  'Broken tackle rate',  'rush', 'Contact', 'output', 'pct1', ['RB'], tier=6, den='car', thr=100),
    M('stuff',    'Stuffed rate',        'rush', 'Contact', 'output', 'pct1', ['RB', 'QB'], den='car', thr=100, lower=True),
    M('ex10',     '10+ yard run rate',   'rush', 'Explosiveness', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=100),
    M('ex20',     '20+ yard run rate',   'rush', 'Explosiveness', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=150),
    M('box8',     '8+ in the box',       'rush', 'Context', 'context', 'pct1', ['RB'], tier=5, den='car', thr=80),
    M('boxcar',   'Defenders in the box', 'rush', 'Context', 'context', 'num2', ['RB'], tier=7, den='car', thr=80),
    M('tlos',     'Time behind the line', 'rush', 'Context', 'ingredient', 'sec', ['RB'], tier=5, den='car', thr=80, lower=True),
    M('ypclight', 'Yards / carry into a light box', 'rush', 'Context', 'output', 'num2', ['RB'], tier=7, den='carl', thr=50),
    M('ypcstack', 'Yards / carry into a stacked box', 'rush', 'Context', 'output', 'num2', ['RB'], tier=7, den='cars', thr=30),
    M('insidepct','Inside-run share',    'rush', 'Context', 'ingredient', 'pct1', ['RB'], den='cargap', thr=80),
    M('ypcin',    'Yards / carry, inside', 'rush', 'Context', 'output', 'num2', ['RB'], den='carin', thr=60),
    M('ypcout',   'Yards / carry, outside', 'rush', 'Context', 'output', 'num2', ['RB'], den='carout', thr=60),
    M('fdcar',    'First-down rate',     'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car', thr=100),
    M('rztdcar',  'Red-zone TD rate',    'rush', 'Situational', 'output', 'pct1', ['RB'], den='car', thr=30),
    M('i10shr',   'Share of team carries inside the 10', 'rush', 'Situational', 'context', 'pct1', ['RB'], den='g', thr=8),
    M('i5shr',    'Share of team carries inside the 5', 'rush', 'Situational', 'context', 'pct1', ['RB'], den='g', thr=8),
    M('gltd',     'Goal-line TD rate',   'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car5', thr=15),
    M('syconv',   'Short-yardage conversion rate', 'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='sy', thr=15),
    M('sneakconv','Sneak conversion rate', 'rush', 'Situational', 'output', 'pct1', ['QB'], tier=7, den='sneak', thr=10),
    M('fumrate',  'Fumble rate',         'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car', thr=250, lower=True),

    # ---------------------------------------------------------------- receiving
    M('tgt',      'Targets / game',      'rec', 'Opportunity', 'context', 'num1', PASSC, tier=3),
    M('recg',     'Receptions / game',   'rec', 'Opportunity', 'context', 'num1', PASSC),
    M('tgtshr',   'Target share',        'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=3, den='g', thr=6),
    # Not for backs: a running back's air yards are a handful either side of zero, so his
    # share of the team's is a small number divided by a big one and says nothing.
    M('ayshr',    'Air yards share',     'rec', 'Opportunity', 'context', 'pct1', ['WR', 'TE'], tier=3, den='g', thr=6),
    M('wopr',     'WOPR',                'rec', 'Opportunity', 'context', 'num2', PASSC, tier=3, den='g', thr=6),
    M('tprs',     'Targets / snap',      'rec', 'Opportunity', 'ingredient', 'pct1', PASSC, tier=4, den='snap', thr=200),
    M('ypsnap',   'Yards / snap',        'rec', 'Opportunity', 'output', 'num2', PASSC, tier=4, den='snap', thr=200),
    M('tpps',     'Targets / pass-play snap', 'rec', 'Opportunity', 'ingredient', 'pct1', PASSC, tier=5, den='psnap', thr=250),
    M('ypps',     'Yards / pass-play snap', 'rec', 'Opportunity', 'output', 'num2', PASSC, tier=5, den='psnap', thr=250),
    M('frshr',    'First-read target share', 'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=7, den='g', thr=6),
    M('recyshr',  'Share of team receiving yards', 'rec', 'Opportunity', 'context', 'pct1', PASSC, den='g', thr=6),
    M('rectdshr', 'Share of team receiving TDs', 'rec', 'Opportunity', 'context', 'pct1', PASSC, den='g', thr=8),
    M('recfdshr', 'Share of team receiving first downs', 'rec', 'Opportunity', 'context', 'pct1', PASSC, den='g', thr=6),
    M('recy',     'Receiving yards / game', 'rec', 'Efficiency', 'output', 'num1', PASSC, den='g', thr=8),
    M('ypt',      'Yards / target',      'rec', 'Efficiency', 'output', 'num2', PASSC, tier=3, den='tgt', thr=150),
    M('yprec',    'Yards / reception',   'rec', 'Efficiency', 'output', 'num2', PASSC, den='rec', thr=50),
    M('epatgt',   'EPA / target',        'rec', 'Efficiency', 'output', 'num3', PASSC, tier=3, den='tgt', thr=120),
    M('srtgt',    'Target success rate', 'rec', 'Efficiency', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('catch',    'Catch rate',          'rec', 'Efficiency', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('racr',     'RACR',                'rec', 'Efficiency', 'output', 'num2', PASSC, tier=3, den='tgt', thr=120),
    M('rattgt',   'Passer rating when targeted', 'rec', 'Efficiency', 'output', 'num1', PASSC, tier=3, den='tgt', thr=100),
    M('croe',     'Catch rate over expected', 'rec', 'Efficiency', 'expected', 'sgn1', PASSC, tier=3, den='tgt', thr=100),
    M('adotr',    'Average depth of target', 'rec', 'Route profile', 'ingredient', 'num1', PASSC, tier=3, den='tgt', thr=80),
    M('deeptgt',  'Deep target rate',    'rec', 'Route profile', 'ingredient', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('sep',      'Average separation',  'rec', 'Route profile', 'output', 'num2', PASSC, tier=5, den='tgt', thr=80),
    M('cush',     'Average cushion',     'rec', 'Route profile', 'context', 'num2', PASSC, tier=5, den='tgt', thr=80, lower=True),
    M('frpct',    'First-read share of his targets', 'rec', 'Target mix', 'ingredient', 'pct1', PASSC, tier=7, den='tgt', thr=60),
    M('despct',   'Designed share of his targets', 'rec', 'Target mix', 'ingredient', 'pct1', PASSC, tier=7, den='tgt', thr=60),
    M('chkpct',   'Checkdown share of his targets', 'rec', 'Target mix', 'ingredient', 'pct1', PASSC, tier=7, den='tgt', thr=60),
    M('scrnpct',  'Screen share of his targets', 'rec', 'Target mix', 'ingredient', 'pct1', PASSC, tier=7, den='tgt', thr=60),
    M('crsh',     'Catch rate, short',   'rec', 'By depth', 'output', 'pct1', PASSC, tier=3, den='tgtsh', thr=60),
    M('crmd',     'Catch rate, intermediate', 'rec', 'By depth', 'output', 'pct1', PASSC, tier=3, den='tgtmd', thr=40),
    M('crdp',     'Catch rate, deep',    'rec', 'By depth', 'output', 'pct1', PASSC, tier=3, den='tgtdp', thr=30),
    M('yptdp',    'Yards / target, deep', 'rec', 'By depth', 'output', 'num2', PASSC, tier=3, den='tgtdp', thr=30),
    M('yacrec',   'YAC / reception',     'rec', 'After the catch', 'output', 'num2', PASSC, tier=2, den='rec', thr=60),
    M('yacoe',    'YAC over expected / rec', 'rec', 'After the catch', 'expected', 'num2', PASSC, tier=5, den='rec', thr=60),
    M('yacoex',   'YAC over expected / rec (play-by-play)', 'rec', 'After the catch', 'expected', 'num2', PASSC, tier=2, den='rec', thr=60),
    M('ybcr',     'Yards before catch / rec', 'rec', 'After the catch', 'ingredient', 'num2', PASSC, tier=2, den='rec', thr=60),
    M('brkrec',   'Broken tackle rate',  'rec', 'After the catch', 'output', 'pct1', PASSC, tier=6, den='rec', thr=60),
    M('created',  'Created reception rate', 'rec', 'After the catch', 'output', 'pct1', PASSC, tier=7, den='tgt', thr=100),
    M('dropr',    'Drop %',              'rec', 'Hands', 'output', 'pct1', PASSC, tier=6, den='tgt', thr=120, lower=True),
    M('ctchtgt',  'Catchable target %',  'rec', 'Hands', 'context', 'pct1', PASSC, tier=7, den='tgt', thr=100),
    M('ctchhand', 'Catch rate on catchable balls', 'rec', 'Hands', 'output', 'pct1', PASSC, tier=7, den='tgt', thr=100),
    M('contest',  'Contested target rate', 'rec', 'Hands', 'context', 'pct1', PASSC, tier=7, den='tgt', thr=100),
    M('contestw', 'Contested catch rate', 'rec', 'Hands', 'output', 'pct1', PASSC, tier=7, den='tgt', thr=150),
    M('fdtgt',    'First-down rate',     'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('ex20rec',  '20+ yard catch rate', 'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('tdtgt',    'TD rate / target',    'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=250),
    M('rztgtr',   'Red-zone target rate', 'rec', 'Situational', 'context', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('eztgt',    'End-zone targets / game', 'rec', 'Situational', 'context', 'num2', PASSC, tier=3, den='g', thr=8),
    M('ezshr',    'End-zone target share', 'rec', 'Situational', 'context', 'pct1', PASSC, tier=3, den='g', thr=8),
    M('c3conv',   'Third/fourth-down conversion rate', 'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt3', thr=30),
    M('dpiyds',   'Interference yards drawn / game', 'rec', 'Situational', 'output', 'num1', PASSC, den='g', thr=8),


    # ---------------------------------------------------------------- blocking
    # An offensive lineman has no box score. What open data can say about him splits three
    # ways, and the page keeps them apart because they are not equally his:
    #   Workload and Discipline  — unambiguously his
    #   Protection / Run game    — the unit's, on his snaps
    #   On / off                 — the unit's, differenced against his bench time
    M('pblkg',    'Pass-block snaps / game', 'block', 'Workload', 'context', 'num1', OLINE + ['TE'], tier=5),
    M('rblkg',    'Run-block snaps / game',  'block', 'Workload', 'context', 'num1', OLINE + ['TE'], tier=5),
    M('starts',   'Games started',           'block', 'Workload', 'context', 'num0', OLINE + ['TE'], tier=4),
    M('posver',   'Positions played',        'block', 'Workload', 'context', 'num0', OLINE, tier=4),
    M('fsg',      'False starts / game',     'block', 'Discipline', 'output', 'num2', OLINE + ['TE'], den='g', thr=10, lower=True),
    M('holdg',    'Holding / game',          'block', 'Discipline', 'output', 'num2', OLINE + ['TE'], den='g', thr=10, lower=True),
    M('pensnap',  'Flags / 100 snaps',        'block', 'Discipline', 'output', 'num2', OLINE + ['TE'], tier=4, den='snap', thr=400, lower=True),
    M('penydsg',  'Penalty yards / game',     'block', 'Discipline', 'output', 'num1', OLINE + ['TE'], den='g', thr=10, lower=True),
    M('penepag',  'Expected points lost to flags / game', 'block', 'Discipline', 'output', 'num2', OLINE + ['TE'], den='g', thr=10, lower=True),
    M('prsallow', 'Pressure rate allowed',   'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='pblk', thr=200, lower=True),
    M('sackallow','Sack rate allowed',       'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='pblk', thr=300, lower=True),
    M('epadbon',  'EPA / dropback',          'block', 'Protection (unit, on his snaps)', 'output', 'num3', OLINE + ['TE'], tier=5, den='pblk', thr=200),
    M('srdbon',   'Dropback success rate',   'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='pblk', thr=200),
    M('rushfaced','Pass rushers faced',      'block', 'Protection (unit, on his snaps)', 'context', 'num2', OLINE + ['TE'], tier=5, den='pblk', thr=200),
    M('hitallow', 'QB-hit rate allowed',      'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE, tier=4, den='pblk', thr=200, lower=True),
    M('prsqb',    'Pressure rate allowed (charted)', 'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE, tier=6, den='pblk', thr=200, lower=True),
    M('ypcon',    'Yards / carry',           'block', 'Run game (unit, on his snaps)', 'output', 'num2', OLINE + ['TE'], tier=5, den='rblk', thr=150),
    M('srrunon',  'Rush success rate',       'block', 'Run game (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='rblk', thr=150),
    M('stuffon',  'Stuffed rate',            'block', 'Run game (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='rblk', thr=150, lower=True),
    M('boxfaced', 'Defenders in the box',    'block', 'Run game (unit, on his snaps)', 'context', 'num2', OLINE + ['TE'], tier=5, den='rblk', thr=150),
    M('gapsr',    'Rush success behind him',  'block', 'Run game (unit, on his snaps)', 'output', 'pct1', OLINE, tier=4, den='gaprun', thr=60),
    M('gapypc',   'Yards / carry behind him', 'block', 'Run game (unit, on his snaps)', 'output', 'num2', OLINE, tier=4, den='gaprun', thr=60),
    M('gapstf',   'Stuffed rate behind him',  'block', 'Run game (unit, on his snaps)', 'output', 'pct1', OLINE, tier=4, den='gaprun', thr=60, lower=True),
    M('prsoo',    'Pressure rate, on minus off', 'block', 'On / off', 'output', 'sgn1', OLINE + ['TE'], tier=5, den='pblk', thr=250, lower=True),
    M('epaoo',    'EPA / dropback, on minus off', 'block', 'On / off', 'output', 'sgn3', OLINE + ['TE'], tier=5, den='pblk', thr=250),
    M('sroo',     'Rush success, on minus off', 'block', 'On / off', 'output', 'sgn1', OLINE + ['TE'], tier=5, den='rblk', thr=200),
    M('wosack',   'Sack rate, games with minus without', 'block', 'With / without (by game)', 'output', 'sgn1', OLINE, tier=4, den='gmiss', thr=4, lower=True),
    M('worun',    'Rush success, games with minus without', 'block', 'With / without (by game)', 'output', 'sgn1', OLINE, tier=4, den='gmiss', thr=4),
    # ---------------------------------------------------------------- pass rush
    M('prss',     'Pressures / game',    'prsh', 'Pressure', 'output', 'num1', FRONT, tier=6, den='g', thr=8),
    M('prsssnap', 'Pressures / defensive snap', 'prsh', 'Pressure', 'output', 'pct1', FRONT, tier=6, den='dsnap', thr=250),
    M('prsspass', 'Pressures / pass-play snap', 'prsh', 'Pressure', 'output', 'pct1', FRONT, tier=6, den='dpass', thr=150),
    M('prsshr',   'Share of team pressures', 'prsh', 'Pressure', 'context', 'pct1', FRONT, tier=6, den='g', thr=8),
    M('hrry',     'Hurries / game',      'prsh', 'Pressure', 'output', 'num1', FRONT, tier=6, den='g', thr=8),
    M('qbkd',     'QB knockdowns / game', 'prsh', 'Pressure', 'output', 'num2', FRONT, tier=6, den='g', thr=8),
    M('hits',     'QB hits / game',      'prsh', 'Pressure', 'output', 'num2', FRONT, den='g', thr=8),
    M('prod',     'Pass-rush productivity', 'prsh', 'Pressure', 'output', 'num2', FRONT, tier=6, den='dsnap', thr=250),
    M('blitz',    'Blitzes / game',      'prsh', 'Pressure', 'context', 'num1', ['LB', 'CB', 'S'], tier=6, den='g', thr=8),
    M('blitzrate','Blitz rate',          'prsh', 'Pressure', 'context', 'pct1', ['LB', 'CB', 'S'], tier=6, den='dpass', thr=150),
    M('sk',       'Sacks / game',        'prsh', 'Finishing', 'output', 'num2', FRONT, den='g', thr=16),
    M('sksnap',   'Sacks / snap',        'prsh', 'Finishing', 'output', 'pct1', FRONT, tier=4, den='dsnap', thr=400),
    M('skpass',   'Sacks / pass-play snap', 'prsh', 'Finishing', 'output', 'pct1', FRONT, tier=5, den='dpass', thr=250),
    M('skepa',    'Expected points taken / sack', 'prsh', 'Finishing', 'output', 'num2', FRONT, den='sk', thr=6),
    M('skyds',    'Yards lost / sack',   'prsh', 'Finishing', 'output', 'num1', FRONT, den='sk', thr=6),
    M('sk3pct',   'Share of sacks on third or fourth down', 'prsh', 'Finishing', 'context', 'pct1', FRONT, den='sk', thr=8),
    M('tfl',      'Tackles for loss / game', 'prsh', 'Finishing', 'output', 'num2', DEF, den='g', thr=12),
    M('tflsnap',  'TFL / snap',          'prsh', 'Finishing', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=300),
    M('bats',     'Batted passes / game', 'prsh', 'Finishing', 'output', 'num2', FRONT, tier=6, den='g', thr=16),
    M('ff',       'Forced fumbles / game', 'prsh', 'Finishing', 'output', 'num2', DEF, den='g', thr=16),
    M('havoc',    'Havoc rate',          'prsh', 'Finishing', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=300),
    M('jumpg',    'Pre-snap flags / game', 'prsh', 'Discipline', 'output', 'num2', FRONT, den='g', thr=10, lower=True),
    M('roughg',   'Roughing-the-passer flags / game', 'prsh', 'Discipline', 'output', 'num2', FRONT, den='g', thr=10, lower=True),

    # ---------------------------------------------------------------- run defense
    M('tkl',      'Tackles / game',      'rdef', 'Volume', 'context', 'num1', DEF),
    M('tklsnap',  'Tackles / snap',      'rdef', 'Volume', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=250),
    M('solopct',  'Solo tackle share',   'rdef', 'Volume', 'ingredient', 'pct1', DEF, den='g', thr=10),
    M('rstopg',   'Run stops / game',    'rdef', 'Stops', 'output', 'num2', DEF, den='g', thr=8),
    M('rstoprate','Run-stop rate',       'rdef', 'Stops', 'output', 'pct1', DEF, tier=5, den='drun', thr=150),
    M('rstopshr', 'Stop share of run tackles', 'rdef', 'Stops', 'ingredient', 'pct1', DEF, den='rtkl', thr=25),
    M('tkldepth', 'Average depth of run tackle', 'rdef', 'Stops', 'output', 'num2', DEF, den='rtkl', thr=25, lower=True),
    M('mtklpct',  'Missed tackle %',     'rdef', 'Reliability', 'output', 'pct1', DEF, tier=6, den='dsnap', thr=250, lower=True),
    M('dpepaoo',  'EPA / dropback allowed, on minus off', 'donoff', '', 'output', 'sgn3', DEF, tier=5, den='dpass', thr=200, lower=True),
    M('drsroo',   'Rush success allowed, on minus off', 'donoff', '', 'output', 'sgn1', DEF, tier=5, den='drun', thr=150, lower=True),

    # ---------------------------------------------------------------- coverage
    M('ctgt',     'Targets defended / game', 'cov', 'Volume', 'context', 'num1', COV, tier=6),
    M('ctgtsnap', 'Targets / defensive snap', 'cov', 'Volume', 'context', 'pct1', COV, tier=6, den='dsnap', thr=250, lower=True),
    M('ctgtpass', 'Targets / coverage snap', 'cov', 'Volume', 'context', 'pct1', COV, tier=6, den='dpass', thr=150, lower=True),
    M('cmpall',   'Completion % allowed', 'cov', 'Coverage', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('yptall',   'Yards / target allowed', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ycs',      'Yards allowed / defensive snap', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ycpass',   'Yards allowed / coverage snap', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ratall',   'Passer rating allowed', 'cov', 'Coverage', 'output', 'num1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('yacall',   'YAC allowed / completion', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('tdallrate','TD rate allowed',     'cov', 'Coverage', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('airall',   'Air yards allowed / completion', 'cov', 'Coverage', 'context', 'num1', COV, tier=6, den='ctgt', thr=50),
    M('dadot',    'Depth of target covered', 'cov', 'Assignment', 'context', 'num1', COV, tier=6, den='ctgt', thr=40),
    M('ptkgain',  'Average gain on catches he tackled', 'cov', 'Assignment', 'context', 'num1', COV, den='ptk', thr=25, lower=True),
    M('int',      'Interceptions / game', 'cov', 'Ball production', 'output', 'num2', DEF, den='g', thr=32),
    M('pd',       'Passes defended / game', 'cov', 'Ball production', 'output', 'num2', DEF, den='g', thr=16),
    M('ballrate', 'Ball production / target', 'cov', 'Ball production', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50),
    M('covpeng',  'Coverage flags / game', 'cov', 'Flags', 'output', 'num2', COV, den='g', thr=10, lower=True),
    M('covpenyds','Coverage flag yards / game', 'cov', 'Flags', 'output', 'num1', COV, den='g', thr=10, lower=True),

    # ---------------------------------------------------------------- kicking
    M('fgpct',    'Field goal %',        'kick', 'Kicking', 'output', 'pct1', ['K'], den='fga', thr=25),
    M('fgoe',     'FG over expected / att', 'kick', 'Kicking', 'expected', 'num2', ['K'], den='fga', thr=25),
    M('fg50',     '50+ yard FG %',       'kick', 'Kicking', 'output', 'pct1', ['K'], den='fga', thr=40),
    M('fglong',   'Longest field goal',  'kick', 'Kicking', 'context', 'num0', ['K']),
    M('fga',      'FG attempts / game',  'kick', 'Kicking', 'context', 'num1', ['K']),
    M('patpct',   'Extra point %',       'kick', 'Kicking', 'output', 'pct1', ['K'], den='g', thr=10),
    M('fgoeout',  'FG over expected, outdoors', 'kick', 'Kicking', 'expected', 'num2', ['K'], den='fgaout', thr=20),
    M('kwpa',     'Wins added by his kicks', 'kick', 'Kicking', 'output', 'sgn3', ['K'], den='fga', thr=25),
    M('kotb',     'Kickoff touchback rate', 'kick', 'Kickoffs', 'context', 'pct1', ['K', 'P'], den='ko', thr=30),
    M('kodist',   'Kickoff distance',    'kick', 'Kickoffs', 'context', 'num1', ['K', 'P'], den='ko', thr=30),
    M('kooob',    'Kickoffs out of bounds', 'kick', 'Kickoffs', 'output', 'pct1', ['K', 'P'], den='ko', thr=30, lower=True),
    M('pgross',   'Gross punt average',  'kick', 'Punting', 'output', 'num1', ['P'], den='punt', thr=40),
    M('pnet',     'Net punt average',    'kick', 'Punting', 'output', 'num1', ['P'], den='punt', thr=40),
    M('pin20',    'Inside-20 rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40),
    M('ptb',      'Touchback rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40, lower=True),
    M('pretr',    'Return rate allowed', 'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40, lower=True),
    M('pretyds',  'Return yards allowed / punt', 'kick', 'Punting', 'output', 'num2', ['P'], den='punt', thr=40, lower=True),
    M('pnoe',     'Net yards over expected / punt', 'kick', 'Punting', 'expected', 'num2', ['P'], den='punt', thr=40),
    M('pin10',    'Inside-10 rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40),
    M('punts',    'Punts / game',        'kick', 'Punting', 'context', 'num1', ['P']),

    # ---------------------------------------------------------------- value
    M('epatot',   'Total EPA',           'val', '', 'output', 'num1', SKILL),
    M('fppg',     'Fantasy points / game', 'val', '', 'output', 'num1', SKILL + ['K']),
    M('toucheg',  'Touches / game',      'val', '', 'context', 'num1', ['RB', 'WR', 'TE']),
    M('xfpg',     'Expected fantasy points / game', 'val', '', 'expected', 'num1', SKILL, tier=2, den='g', thr=8),
    M('fpoeg',    'Fantasy points over expected / game', 'val', '', 'output', 'sgn1', SKILL, tier=2, den='g', thr=8),
    M('tdoeg',    'Touchdowns over expected / game', 'val', '', 'context', 'sgn3', SKILL, tier=2, den='g', thr=8),
    
    # ---------------------------------------------------------------- special teams
    M('stshr',    'Special-teams snap share', 'st', '', 'context', 'pct1', STPOS, tier=4, den='g', thr=6),
    M('sttklg',   'Special-teams tackles / game', 'st', '', 'output', 'num2', STPOS, den='g', thr=8),
    M('kravg',    'Kick return average', 'st', 'Returns', 'output', 'num1', STPOS, den='kr', thr=20),
    M('krepa',    'EPA / kick return',   'st', 'Returns', 'output', 'num3', STPOS, den='kr', thr=20),
    M('pravg',    'Punt return average', 'st', 'Returns', 'output', 'num1', STPOS, den='pr', thr=15),
    M('prepa',    'EPA / punt return',   'st', 'Returns', 'output', 'num3', STPOS, den='pr', thr=15),

    # ---------------------------------------------------------------- athletic
    M('ht',       'Height',              'ath', '', 'ingredient', 'ftin', ALL),
    M('wt',       'Weight',              'ath', '', 'ingredient', 'lb',   ALL),
    M('forty',    '40-yard dash',        'ath', '', 'ingredient', 'sec',  ALL, lower=True),
    M('vert',     'Vertical jump',       'ath', '', 'ingredient', 'inch', ALL),
    M('broad',    'Broad jump',          'ath', '', 'ingredient', 'inch', ALL),
    M('cone',     '3-cone drill',        'ath', '', 'ingredient', 'sec',  ALL, lower=True),
    M('shuttle',  '20-yard shuttle',     'ath', '', 'ingredient', 'sec',  ALL, lower=True),
    M('bench',    'Bench press',         'ath', '', 'ingredient', 'num0', ALL),
    M('spdscore', 'Speed score',         'ath', '', 'ingredient', 'num1', ['RB', 'WR', 'TE']),
]

GROUP_LABEL = {
    'ctx': 'Context', 'pass': 'Passing', 'rush': 'Rushing', 'rec': 'Receiving',
    'prsh': 'Pass rush', 'rdef': 'Run defense', 'cov': 'Coverage',
    'kick': 'Kicking & punting', 'val': 'Value', 'ath': 'Athletic profile',
    'block': 'Blocking',
    'st': 'Special teams', 'donoff': 'The defense with and without him',
}

# Which panels a cohort shows, in order. Position is the page's organizing principle:
# a corner and a center share no box score, so they should not share a metric table.
POS_PANELS = {
    'QB':  ['ctx', 'pass', 'rush', 'val', 'ath'],
    'RB':  ['ctx', 'rush', 'rec', 'st', 'val', 'ath'],
    'WR':  ['ctx', 'rec', 'rush', 'st', 'val', 'ath'],
    'TE':  ['ctx', 'rec', 'block', 'st', 'val', 'ath'],
    'OL':  ['ctx', 'block', 'ath'],
    'OT':  ['ctx', 'block', 'ath'],
    'OG':  ['ctx', 'block', 'ath'],
    'OC':  ['ctx', 'block', 'ath'],
    'ED':  ['ctx', 'prsh', 'rdef', 'cov', 'donoff', 'ath'],
    'DI':  ['ctx', 'prsh', 'rdef', 'donoff', 'ath'],
    'LB':  ['ctx', 'rdef', 'prsh', 'cov', 'donoff', 'st', 'ath'],
    'CB':  ['ctx', 'cov', 'rdef', 'donoff', 'st', 'ath'],
    'S':   ['ctx', 'cov', 'rdef', 'prsh', 'donoff', 'st', 'ath'],
    'K':   ['ctx', 'kick', 'val'],
    'P':   ['ctx', 'kick'],
}

POS_LABEL = {
    'QB': 'Quarterback', 'RB': 'Running back', 'WR': 'Wide receiver', 'TE': 'Tight end',
    'OL': 'Offensive line', 'OT': 'Offensive tackle', 'OG': 'Guard', 'OC': 'Center',
    'ED': 'Edge', 'DI': 'Interior D-line', 'LB': 'Linebacker',
    'CB': 'Cornerback', 'S': 'Safety', 'K': 'Kicker', 'P': 'Punter',
}

# The bars that define "how good was this season" for the career arc and for comps.
HEADLINE = {
    'QB': ['epadb', 'cpoe', 'anya', 'srdb', 'sackpct'],
    'RB': ['epacar', 'srcar', 'ypc', 'yacr', 'rushy'],
    'WR': ['ypsnap', 'ypt', 'epatgt', 'srtgt', 'wopr', 'yprec', 'recy'],
    'TE': ['ypsnap', 'ypt', 'epatgt', 'srtgt', 'wopr', 'yprec', 'recy'],
    'OL': ['prsallow', 'sackallow', 'srrunon', 'snapshr', 'fsg'],
    'OT': ['prsallow', 'sackallow', 'srrunon', 'snapshr', 'fsg'],
    'OG': ['prsallow', 'sackallow', 'srrunon', 'snapshr', 'fsg'],
    'OC': ['prsallow', 'sackallow', 'srrunon', 'snapshr', 'fsg'],
    'ED': ['prsssnap', 'sksnap', 'tflsnap', 'mtklpct', 'hits'],
    'DI': ['prsssnap', 'sksnap', 'tflsnap', 'mtklpct', 'tklsnap'],
    'LB': ['tklsnap', 'tflsnap', 'mtklpct', 'ycs', 'prsssnap'],
    'CB': ['ycs', 'cmpall', 'ratall', 'ballrate', 'ctgtsnap'],
    'S':  ['ycs', 'cmpall', 'ratall', 'tklsnap', 'ballrate'],
    'K':  ['fgoe', 'fgpct', 'fg50'],
    'P':  ['pnet', 'pin20', 'pretyds'],
}

# Weakness comps hinge at the median, so a player's strengths contribute nothing and two
# players match on a shared flaw even when their full profiles never would.
WEAK_DIMS = {
    'OL': ['prsallow', 'sackallow', 'stuffon', 'fsg', 'holdg', 'snapshr'],
    'OT': ['prsallow', 'sackallow', 'stuffon', 'fsg', 'holdg', 'snapshr'],
    'OG': ['prsallow', 'sackallow', 'stuffon', 'fsg', 'holdg', 'snapshr'],
    'OC': ['prsallow', 'sackallow', 'stuffon', 'fsg', 'holdg', 'snapshr'],
    'QB': ['epadb', 'cpoe', 'srdb', 'sackpct', 'intpct', 'ontgt', 'ypa'],
    'RB': ['srcar', 'ypc', 'yacr', 'stuff', 'ypt', 'catch', 'fumrate'],
    'WR': ['ypt', 'catch', 'srtgt', 'dropr', 'sep', 'racr', 'yacoe'],
    'TE': ['ypt', 'catch', 'srtgt', 'dropr', 'sep', 'racr', 'yacoe'],
    'ED': ['prsssnap', 'sksnap', 'tflsnap', 'mtklpct', 'tklsnap'],
    'DI': ['prsssnap', 'sksnap', 'tflsnap', 'mtklpct', 'tklsnap'],
    'LB': ['tklsnap', 'mtklpct', 'ycs', 'cmpall', 'tflsnap'],
    'CB': ['cmpall', 'ycs', 'ratall', 'ballrate', 'yacall', 'mtklpct'],
    'S':  ['cmpall', 'ycs', 'ratall', 'ballrate', 'mtklpct', 'tklsnap'],
    'K':  ['fgpct', 'fgoe', 'fg50', 'patpct'],
    'P':  ['pnet', 'pin20', 'ptb', 'pretyds'],
}

# What it takes to be in a cohort's percentile pool for a season.
QUALIFY = {
    'QB': ('db', 150), 'RB': ('car', 60), 'WR': ('tgt', 35), 'TE': ('tgt', 25),
    'OL': ('snap', 250), 'OT': ('snap', 250), 'OG': ('snap', 250), 'OC': ('snap', 250),
    'ED': ('dsnap', 250), 'DI': ('dsnap', 250),
    'LB': ('dsnap', 250), 'CB': ('dsnap', 250), 'S': ('dsnap', 250),
    'K': ('fga', 12), 'P': ('punt', 20),
}
# Before snap counts existed (pre-2013) defenders and linemen fall back to games played.
# Before snap counts (2013) defenders and linemen fall back to games played; before targets
# were charted (2012) receivers fall back to catches. Without these, twelve seasons of the
# archive would have no percentile pool at all for half the positions.
QUALIFY_FALLBACK = {'OL': ('g', 8), 'OT': ('g', 8), 'OG': ('g', 8), 'OC': ('g', 8),
                    'ED': ('g', 8), 'DI': ('g', 8),
                    'LB': ('g', 8), 'CB': ('g', 8), 'S': ('g', 8),
                    'WR': ('rec', 20), 'TE': ('rec', 15)}
