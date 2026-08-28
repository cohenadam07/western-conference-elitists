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
  6  2018  Pro-Football-Reference charting (pressure, drops, broken tackles, coverage)
"""

from explain import EXPLAIN

TIER_SINCE = {1: 1999, 2: 2006, 3: 2012, 4: 2013, 5: 2016, 6: 2018}

# Sample-size denominators. A metric's stabilization threshold is expressed in whichever
# of these it actually accumulates, so the page can hatch a bar honestly rather than
# guessing from games played.
DENOMS = {
    'db': 'dropbacks', 'att': 'pass attempts', 'car': 'carries', 'tgt': 'targets',
    'rec': 'receptions', 'snap': 'snaps', 'dsnap': 'defensive snaps',
    'pblk': 'pass-blocking snaps', 'rblk': 'run-blocking snaps',
    'ctgt': 'targets defended', 'fga': 'field goal attempts', 'punt': 'punts',
    'g': 'games',
}

SKILL = ['QB', 'RB', 'WR', 'TE']
PASSC = ['WR', 'TE', 'RB']
DEF = ['ED', 'DI', 'LB', 'CB', 'S']
FRONT = ['ED', 'DI', 'LB']
COV = ['CB', 'S', 'LB']
ALL = ['QB', 'RB', 'WR', 'TE', 'OL', 'ED', 'DI', 'LB', 'CB', 'S', 'K', 'P']


def M(key, label, grp, sub, layer, unit, pos, tier=1, den='g', thr=0, lower=False):
    # `exp` (explain.py) is the single source of truth for a metric's prose: what it is,
    # why it matters, and the formula. There is deliberately no second caveat field —
    # anything worth saying belongs in the explanation a reader actually opens.
    return dict(key=key, label=label, grp=grp, sub=sub, layer=layer, unit=unit,
                pos=list(pos), tier=tier, den=den, thr=thr, lower=lower,
                since=TIER_SINCE[tier], exp=EXPLAIN[key])


METRICS = [
    # ---------------------------------------------------------------- context
    M('g',        'Games played',        'ctx', '', 'context', 'num0', ALL),
    M('avail',    'Availability',        'ctx', '', 'context', 'pct1', ALL),
    M('snaps',    'Snaps / game',        'ctx', '', 'context', 'num1', ALL, tier=4),
    M('snapshr',  'Snap share',          'ctx', '', 'context', 'pct1', ALL, tier=4),
    M('pen',      'Penalties / game',    'ctx', '', 'output',  'num2', ALL, lower=True, den='g', thr=8),

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
    M('blitzpct', 'Blitz rate faced',    'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200),
    M('scrrate',  'Scramble rate',       'pass', 'Pocket',     'ingredient', 'pct1', ['QB'], den='db', thr=150),
    M('adot',     'Average depth of target', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=2, den='att', thr=150),
    M('aysticks', 'Air yards to sticks', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=5, den='att', thr=150),
    M('aggr',     'Aggressiveness',      'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=5, den='att', thr=150),
    M('deeprate', 'Deep attempt rate',   'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=2, den='att', thr=150),
    M('parate',   'Play-action rate',    'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=6, den='att', thr=150),
    M('rporate',  'RPO rate',            'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=6, den='att', thr=150),
    M('xcomp',    'Expected completion %', 'pass', 'Accuracy', 'expected', 'pct1', ['QB'], tier=5, den='att', thr=150),
    M('ontgt',    'On-target %',         'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=6, den='att', thr=150),
    M('badthrow', 'Bad throw %',         'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=6, den='att', thr=150, lower=True),
    M('droppct',  'Drop % (his throws)', 'pass', 'Accuracy', 'context', 'pct1', ['QB'], tier=6, den='att', thr=200, lower=True),
    M('fddb',     'First-down rate',     'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=200),
    M('td3conv',  'Third/fourth-down conversion', 'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=80),
    M('rztd',     'Red-zone TD rate',    'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=60),

    # ---------------------------------------------------------------- rushing
    M('car',      'Carries / game',      'rush', 'Volume', 'context', 'num1', ['RB', 'QB', 'WR', 'TE']),
    M('rushy',    'Rushing yards / game', 'rush', 'Volume', 'output', 'num1', ['RB', 'QB', 'WR'], den='g', thr=8),
    M('epacar',   'EPA / carry',         'rush', 'Efficiency', 'output', 'num3', ['RB', 'QB', 'WR'], den='car', thr=120),
    M('srcar',    'Rush success rate',   'rush', 'Efficiency', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=100),
    M('ypc',      'Yards / carry',       'rush', 'Efficiency', 'output', 'num2', ['RB', 'QB', 'WR'], den='car', thr=120),
    M('ryoe',     'Rush yards over expected / att', 'rush', 'Efficiency', 'expected', 'num2', ['RB', 'QB'], tier=5, den='car', thr=100),
    M('ybc',      'Yards before contact / att', 'rush', 'Contact', 'context', 'num2', ['RB'], tier=6, den='car', thr=100),
    M('yacr',     'Yards after contact / att', 'rush', 'Contact', 'output', 'num2', ['RB'], tier=6, den='car', thr=100),
    M('brkrate',  'Broken tackle rate',  'rush', 'Contact', 'output', 'pct1', ['RB'], tier=6, den='car', thr=100),
    M('stuff',    'Stuffed rate',        'rush', 'Contact', 'output', 'pct1', ['RB', 'QB'], den='car', thr=100, lower=True),
    M('ex10',     '10+ yard run rate',   'rush', 'Explosiveness', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=100),
    M('ex20',     '20+ yard run rate',   'rush', 'Explosiveness', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=150),
    M('box8',     '8+ in the box',       'rush', 'Context', 'context', 'pct1', ['RB'], tier=5, den='car', thr=80),
    M('tlos',     'Time behind the line', 'rush', 'Context', 'ingredient', 'sec', ['RB'], tier=5, den='car', thr=80, lower=True),
    M('fdcar',    'First-down rate',     'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car', thr=100),
    M('rztdcar',  'Red-zone TD rate',    'rush', 'Situational', 'output', 'pct1', ['RB'], den='car', thr=30),
    M('fumrate',  'Fumble rate',         'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car', thr=250, lower=True),

    # ---------------------------------------------------------------- receiving
    M('tgt',      'Targets / game',      'rec', 'Opportunity', 'context', 'num1', PASSC, tier=3),
    M('recg',     'Receptions / game',   'rec', 'Opportunity', 'context', 'num1', PASSC),
    M('tgtshr',   'Target share',        'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=3, den='g', thr=6),
    M('ayshr',    'Air yards share',     'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=3, den='g', thr=6),
    M('wopr',     'WOPR',                'rec', 'Opportunity', 'context', 'num2', PASSC, tier=3, den='g', thr=6),
    M('tprs',     'Targets / snap',      'rec', 'Opportunity', 'ingredient', 'pct1', PASSC, tier=4, den='snap', thr=200),
    M('ypsnap',   'Yards / snap',        'rec', 'Opportunity', 'output', 'num2', PASSC, tier=4, den='snap', thr=200),
    M('recy',     'Receiving yards / game', 'rec', 'Efficiency', 'output', 'num1', PASSC, den='g', thr=8),
    M('ypt',      'Yards / target',      'rec', 'Efficiency', 'output', 'num2', PASSC, tier=3, den='tgt', thr=150),
    M('yprec',    'Yards / reception',   'rec', 'Efficiency', 'output', 'num2', PASSC, den='rec', thr=50),
    M('epatgt',   'EPA / target',        'rec', 'Efficiency', 'output', 'num3', PASSC, tier=3, den='tgt', thr=120),
    M('srtgt',    'Target success rate', 'rec', 'Efficiency', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('catch',    'Catch rate',          'rec', 'Efficiency', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('racr',     'RACR',                'rec', 'Efficiency', 'output', 'num2', PASSC, tier=3, den='tgt', thr=120),
    M('rattgt',   'Passer rating when targeted', 'rec', 'Efficiency', 'output', 'num1', PASSC, tier=6, den='tgt', thr=100),
    M('adotr',    'Average depth of target', 'rec', 'Route profile', 'ingredient', 'num1', PASSC, tier=3, den='tgt', thr=80),
    M('deeptgt',  'Deep target rate',    'rec', 'Route profile', 'ingredient', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('sep',      'Average separation',  'rec', 'Route profile', 'output', 'num2', PASSC, tier=5, den='tgt', thr=80),
    M('cush',     'Average cushion',     'rec', 'Route profile', 'context', 'num2', PASSC, tier=5, den='tgt', thr=80, lower=True),
    M('yacrec',   'YAC / reception',     'rec', 'After the catch', 'output', 'num2', PASSC, tier=2, den='rec', thr=60),
    M('yacoe',    'YAC over expected / rec', 'rec', 'After the catch', 'expected', 'num2', PASSC, tier=5, den='rec', thr=60),
    M('ybcr',     'Yards before catch / rec', 'rec', 'After the catch', 'ingredient', 'num2', PASSC, tier=6, den='rec', thr=60),
    M('brkrec',   'Broken tackle rate',  'rec', 'After the catch', 'output', 'pct1', PASSC, tier=6, den='rec', thr=60),
    M('dropr',    'Drop %',              'rec', 'After the catch', 'output', 'pct1', PASSC, tier=6, den='tgt', thr=120, lower=True),
    M('fdtgt',    'First-down rate',     'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('ex20rec',  '20+ yard catch rate', 'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('tdtgt',    'TD rate / target',    'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=250),
    M('rztgtr',   'Red-zone target rate', 'rec', 'Situational', 'context', 'pct1', PASSC, tier=3, den='tgt', thr=100),


    # ---------------------------------------------------------------- blocking
    # An offensive lineman has no box score. What open data can say about him splits three
    # ways, and the page keeps them apart because they are not equally his:
    #   Workload and Discipline  — unambiguously his
    #   Protection / Run game    — the unit's, on his snaps
    #   On / off                 — the unit's, differenced against his bench time
    M('pblkg',    'Pass-block snaps / game', 'block', 'Workload', 'context', 'num1', ['OL', 'TE'], tier=5),
    M('rblkg',    'Run-block snaps / game',  'block', 'Workload', 'context', 'num1', ['OL', 'TE'], tier=5),
    M('starts',   'Games started',           'block', 'Workload', 'context', 'num0', ['OL', 'TE'], tier=4),
    M('posver',   'Positions played',        'block', 'Workload', 'context', 'num0', ['OL'], tier=4),
    M('fsg',      'False starts / game',     'block', 'Discipline', 'output', 'num2', ['OL', 'TE'], den='g', thr=10, lower=True),
    M('holdg',    'Holding / game',          'block', 'Discipline', 'output', 'num2', ['OL', 'TE'], den='g', thr=10, lower=True),
    M('prsallow', 'Pressure rate allowed',   'block', 'Protection (unit, on his snaps)', 'output', 'pct1', ['OL', 'TE'], tier=5, den='pblk', thr=200, lower=True),
    M('sackallow','Sack rate allowed',       'block', 'Protection (unit, on his snaps)', 'output', 'pct1', ['OL', 'TE'], tier=5, den='pblk', thr=300, lower=True),
    M('epadbon',  'EPA / dropback',          'block', 'Protection (unit, on his snaps)', 'output', 'num3', ['OL', 'TE'], tier=5, den='pblk', thr=200),
    M('srdbon',   'Dropback success rate',   'block', 'Protection (unit, on his snaps)', 'output', 'pct1', ['OL', 'TE'], tier=5, den='pblk', thr=200),
    M('rushfaced','Pass rushers faced',      'block', 'Protection (unit, on his snaps)', 'context', 'num2', ['OL', 'TE'], tier=5, den='pblk', thr=200),
    M('ypcon',    'Yards / carry',           'block', 'Run game (unit, on his snaps)', 'output', 'num2', ['OL', 'TE'], tier=5, den='rblk', thr=150),
    M('srrunon',  'Rush success rate',       'block', 'Run game (unit, on his snaps)', 'output', 'pct1', ['OL', 'TE'], tier=5, den='rblk', thr=150),
    M('stuffon',  'Stuffed rate',            'block', 'Run game (unit, on his snaps)', 'output', 'pct1', ['OL', 'TE'], tier=5, den='rblk', thr=150, lower=True),
    M('boxfaced', 'Defenders in the box',    'block', 'Run game (unit, on his snaps)', 'context', 'num2', ['OL', 'TE'], tier=5, den='rblk', thr=150),
    M('prsoo',    'Pressure rate, on minus off', 'block', 'On / off', 'output', 'sgn1', ['OL', 'TE'], tier=5, den='pblk', thr=250, lower=True),
    M('epaoo',    'EPA / dropback, on minus off', 'block', 'On / off', 'output', 'sgn3', ['OL', 'TE'], tier=5, den='pblk', thr=250),
    M('sroo',     'Rush success, on minus off', 'block', 'On / off', 'output', 'sgn1', ['OL', 'TE'], tier=5, den='rblk', thr=200),
    # ---------------------------------------------------------------- pass rush
    M('prss',     'Pressures / game',    'prsh', 'Pressure', 'output', 'num1', FRONT, tier=6, den='g', thr=8),
    M('prsssnap', 'Pressures / defensive snap', 'prsh', 'Pressure', 'output', 'pct1', FRONT, tier=6, den='dsnap', thr=250),
    M('hrry',     'Hurries / game',      'prsh', 'Pressure', 'output', 'num1', FRONT, tier=6, den='g', thr=8),
    M('qbkd',     'QB knockdowns / game', 'prsh', 'Pressure', 'output', 'num2', FRONT, tier=6, den='g', thr=8),
    M('hits',     'QB hits / game',      'prsh', 'Pressure', 'output', 'num2', FRONT, den='g', thr=8),
    M('prod',     'Pass-rush productivity', 'prsh', 'Pressure', 'output', 'num2', FRONT, tier=6, den='dsnap', thr=250),
    M('blitz',    'Blitzes / game',      'prsh', 'Pressure', 'context', 'num1', ['LB', 'CB', 'S'], tier=6, den='g', thr=8),
    M('sk',       'Sacks / game',        'prsh', 'Finishing', 'output', 'num2', FRONT, den='g', thr=16),
    M('sksnap',   'Sacks / snap',        'prsh', 'Finishing', 'output', 'pct1', FRONT, tier=4, den='dsnap', thr=400),
    M('tfl',      'Tackles for loss / game', 'prsh', 'Finishing', 'output', 'num2', DEF, den='g', thr=12),
    M('tflsnap',  'TFL / snap',          'prsh', 'Finishing', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=300),
    M('bats',     'Batted passes / game', 'prsh', 'Finishing', 'output', 'num2', FRONT, tier=6, den='g', thr=16),
    M('ff',       'Forced fumbles / game', 'prsh', 'Finishing', 'output', 'num2', DEF, den='g', thr=16),

    # ---------------------------------------------------------------- run defense
    M('tkl',      'Tackles / game',      'rdef', 'Volume', 'context', 'num1', DEF),
    M('tklsnap',  'Tackles / snap',      'rdef', 'Volume', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=250),
    M('solopct',  'Solo tackle share',   'rdef', 'Volume', 'ingredient', 'pct1', DEF, den='g', thr=10),
    M('mtklpct',  'Missed tackle %',     'rdef', 'Reliability', 'output', 'pct1', DEF, tier=6, den='dsnap', thr=250, lower=True),

    # ---------------------------------------------------------------- coverage
    M('ctgt',     'Targets defended / game', 'cov', 'Volume', 'context', 'num1', COV, tier=6),
    M('ctgtsnap', 'Targets / defensive snap', 'cov', 'Volume', 'context', 'pct1', COV, tier=6, den='dsnap', thr=250, lower=True),
    M('cmpall',   'Completion % allowed', 'cov', 'Coverage', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('yptall',   'Yards / target allowed', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ycs',      'Yards allowed / defensive snap', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ratall',   'Passer rating allowed', 'cov', 'Coverage', 'output', 'num1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('yacall',   'YAC allowed / completion', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('dadot',    'Depth of target covered', 'cov', 'Assignment', 'context', 'num1', COV, tier=6, den='ctgt', thr=40),
    M('int',      'Interceptions / game', 'cov', 'Ball production', 'output', 'num2', DEF, den='g', thr=32),
    M('pd',       'Passes defended / game', 'cov', 'Ball production', 'output', 'num2', DEF, den='g', thr=16),
    M('ballrate', 'Ball production / target', 'cov', 'Ball production', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50),

    # ---------------------------------------------------------------- kicking
    M('fgpct',    'Field goal %',        'kick', 'Kicking', 'output', 'pct1', ['K'], den='fga', thr=25),
    M('fgoe',     'FG over expected / att', 'kick', 'Kicking', 'expected', 'num2', ['K'], den='fga', thr=25),
    M('fg50',     '50+ yard FG %',       'kick', 'Kicking', 'output', 'pct1', ['K'], den='fga', thr=40),
    M('fglong',   'Longest field goal',  'kick', 'Kicking', 'context', 'num0', ['K']),
    M('fga',      'FG attempts / game',  'kick', 'Kicking', 'context', 'num1', ['K']),
    M('patpct',   'Extra point %',       'kick', 'Kicking', 'output', 'pct1', ['K'], den='g', thr=10),
    M('pgross',   'Gross punt average',  'kick', 'Punting', 'output', 'num1', ['P'], den='punt', thr=40),
    M('pnet',     'Net punt average',    'kick', 'Punting', 'output', 'num1', ['P'], den='punt', thr=40),
    M('pin20',    'Inside-20 rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40),
    M('ptb',      'Touchback rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40, lower=True),
    M('pretr',    'Return rate allowed', 'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40, lower=True),
    M('pretyds',  'Return yards allowed / punt', 'kick', 'Punting', 'output', 'num2', ['P'], den='punt', thr=40, lower=True),
    M('punts',    'Punts / game',        'kick', 'Punting', 'context', 'num1', ['P']),

    # ---------------------------------------------------------------- value
    M('epatot',   'Total EPA',           'val', '', 'output', 'num1', SKILL),
    M('fppg',     'Fantasy points / game', 'val', '', 'output', 'num1', SKILL + ['K']),
    M('toucheg',  'Touches / game',      'val', '', 'context', 'num1', ['RB', 'WR', 'TE']),

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
}

# Which panels a cohort shows, in order. Position is the page's organizing principle:
# a corner and a center share no box score, so they should not share a metric table.
POS_PANELS = {
    'QB':  ['ctx', 'pass', 'rush', 'val', 'ath'],
    'RB':  ['ctx', 'rush', 'rec', 'val', 'ath'],
    'WR':  ['ctx', 'rec', 'rush', 'val', 'ath'],
    'TE':  ['ctx', 'rec', 'block', 'val', 'ath'],
    'OL':  ['ctx', 'block', 'ath'],
    'ED':  ['ctx', 'prsh', 'rdef', 'cov', 'ath'],
    'DI':  ['ctx', 'prsh', 'rdef', 'ath'],
    'LB':  ['ctx', 'rdef', 'prsh', 'cov', 'ath'],
    'CB':  ['ctx', 'cov', 'rdef', 'ath'],
    'S':   ['ctx', 'cov', 'rdef', 'prsh', 'ath'],
    'K':   ['ctx', 'kick', 'val'],
    'P':   ['ctx', 'kick'],
}

POS_LABEL = {
    'QB': 'Quarterback', 'RB': 'Running back', 'WR': 'Wide receiver', 'TE': 'Tight end',
    'OL': 'Offensive line', 'ED': 'Edge', 'DI': 'Interior D-line', 'LB': 'Linebacker',
    'CB': 'Cornerback', 'S': 'Safety', 'K': 'Kicker', 'P': 'Punter',
}

# The bars that define "how good was this season" for the career arc and for comps.
HEADLINE = {
    'QB': ['epadb', 'cpoe', 'anya', 'srdb', 'sackpct'],
    'RB': ['epacar', 'srcar', 'ypc', 'yacr', 'rushy'],
    'WR': ['ypsnap', 'ypt', 'epatgt', 'srtgt', 'wopr', 'yprec', 'recy'],
    'TE': ['ypsnap', 'ypt', 'epatgt', 'srtgt', 'wopr', 'yprec', 'recy'],
    'OL': ['prsallow', 'sackallow', 'srrunon', 'snapshr', 'fsg'],
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
    'OL': ('snap', 250), 'ED': ('dsnap', 250), 'DI': ('dsnap', 250),
    'LB': ('dsnap', 250), 'CB': ('dsnap', 250), 'S': ('dsnap', 250),
    'K': ('fga', 12), 'P': ('punt', 20),
}
# Before snap counts existed (pre-2013) defenders and linemen fall back to games played.
# Before snap counts (2013) defenders and linemen fall back to games played; before targets
# were charted (2012) receivers fall back to catches. Without these, twelve seasons of the
# archive would have no percentile pool at all for half the positions.
QUALIFY_FALLBACK = {'OL': ('g', 8), 'ED': ('g', 8), 'DI': ('g', 8),
                    'LB': ('g', 8), 'CB': ('g', 8), 'S': ('g', 8),
                    'WR': ('rec', 20), 'TE': ('rec', 15)}
