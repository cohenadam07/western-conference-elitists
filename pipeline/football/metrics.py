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
  est    'live' when the row is an estimate while a season is being played and a true count
         once it is over (see extras.py: the participation file posts in February). The
         page tags the row "est." for the season in progress and nowhere else.
  thrp   per-position sample lines, where one line cannot serve every cohort. `thr` was
         written for the position that does the thing most: 150 targets is a wide
         receiver's season, and no running back has reached it since targets were first
         charted in 2012 (the most is 142), so a back's yards per target could never be
         called settled. The lines below are sized so that about the same share of each
         position's regulars reaches them.

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
}
# The thirteen above are what a card is built on. The ones below are the samples behind a
# single row - a split, a depth band, a kind of snap - and exist so that row can say how
# much it is resting on. They are not listed in the "built on" line.
DENOM_CORE = list(DENOMS)
DENOMS.update({
    'qprs': 'pressures faced', 'padb': 'play-action dropbacks', 'blzdb': 'blitzed dropbacks',
    'ucdb': 'dropbacks from under center', 'ngdb': 'dropbacks with the game in doubt',
    'mandb': 'dropbacks against man coverage', 'zonedb': 'dropbacks against zone coverage',
    'attb': 'throws behind the line', 'atts': 'throws of 0-9 yards',
    'attm': 'throws of 10-19 yards', 'attd': 'throws of 20+ yards',
    'drv': 'drives', 'descar': 'designed runs', 'scr': 'scrambles', 'snk': 'sneaks',
    'sy': 'short-yardage carries', 'carlt': 'carries against light boxes',
    'carst': 'carries against stacked boxes', 'carin': 'inside runs', 'carout': 'outside runs',
    'tgtb': 'targets behind the line', 'tgts': 'targets of 0-9 yards',
    'tgtm': 'targets of 10-19 yards', 'tgtd': 'targets of 20+ yards',
    'td3t': 'third-down targets', 'tgtman': 'targets against man coverage',
    'tgtzone': 'targets against zone coverage',
    'opsnap': 'pass-play snaps', 'dpsnap': 'pass-play snaps', 'drsnap': 'run-play snaps',
    'rtk': 'run tackles', 'ptk': 'tackles after a catch', 'skn': 'sacks',
    'kr': 'kick returns', 'pr': 'punt returns', 'retn': 'returns', 'ko': 'kickoffs',
    'fgaout': 'outdoor field goal attempts', 'gaprun': 'runs to his gap',
})

SKILL = ['QB', 'RB', 'WR', 'TE']
PASSC = ['WR', 'TE', 'RB']
DEF = ['ED', 'DI', 'LB', 'CB', 'S']
FRONT = ['ED', 'DI', 'LB']
COV = ['CB', 'S', 'LB']
RETURNERS = ['RB', 'WR', 'CB', 'S']
# who covers kicks: everybody but the quarterback, the line and the specialists
TEAMERS = ['RB', 'WR', 'TE', 'ED', 'DI', 'LB', 'CB', 'S']
# A lineman's cohort is his spot on the line where the depth charts say so (2001 on) and
# the undifferentiated OL where they don't, so every blocking row applies to all four.
OLINE = ['OL', 'OT', 'OG', 'OC']
ALL = ['QB', 'RB', 'WR', 'TE', 'OL', 'OT', 'OG', 'OC',
       'ED', 'DI', 'LB', 'CB', 'S', 'K', 'P']


def M(key, label, grp, sub, layer, unit, pos, tier=1, den='g', thr=0, lower=False, est=None):
    # `exp` (explain.py) is the single source of truth for a metric's prose: what it is,
    # why it matters, and the formula. There is deliberately no second caveat field —
    # anything worth saying belongs in the explanation a reader actually opens.
    row = dict(key=key, label=label, grp=grp, sub=sub, layer=layer, unit=unit,
               pos=list(pos), tier=tier, den=den, thr=thr, lower=lower,
               since=TIER_SINCE[tier], exp=EXPLAIN[key])
    if est:
        row['est'] = est
    return row


# Sample lines by position (see `thrp` above). Multipliers on the row's own `thr`, by the
# denominator it counts. Among player-seasons with 20+ targets since 2012 the 90th
# percentile is 132 targets for a wide receiver, 102 for a tight end and 73 for a back.
THR_SCALE = {
    'tgt': {'TE': 0.75, 'RB': 0.5}, 'rec': {'TE': 0.75, 'RB': 0.5},
    'tgtb': {'TE': 0.75, 'RB': 1.0}, 'tgts': {'TE': 0.75, 'RB': 0.6},
    'tgtm': {'TE': 0.75, 'RB': 0.3}, 'tgtd': {'TE': 0.6, 'RB': 0.3},
    'td3t': {'TE': 0.75, 'RB': 0.5}, 'tgtman': {'TE': 0.75, 'RB': 0.5},
    'tgtzone': {'TE': 0.75, 'RB': 0.5}, 'opsnap': {'TE': 0.8, 'RB': 0.6},
    'car': {'QB': 0.5, 'WR': 0.2, 'TE': 0.2},
}


def _with_position_lines(rows):
    for row in rows:
        sc = THR_SCALE.get(row['den'])
        if not sc or not row['thr']:
            continue
        thrp = {p: max(5, int(round(row['thr'] * f / 5.0) * 5))
                for p, f in sc.items() if p in row['pos'] and f != 1.0}
        if thrp:
            row['thrp'] = thrp
    return rows


def thr_for(row, pos):
    """The sample line a metric uses for one position."""
    return (row.get('thrp') or {}).get(pos, row['thr'])


METRICS = [
    # ---------------------------------------------------------------- context
    M('g',        'Games played',        'ctx', '', 'context', 'num0', ALL),
    M('avail',    'Availability',        'ctx', '', 'context', 'pct1', ALL),
    M('snaps',    'Snaps / game',        'ctx', '', 'context', 'num1', ALL, tier=4),
    M('snapshr',  'Snap share',          'ctx', '', 'context', 'pct1', ALL, tier=4),
    M('pen',      'Penalties / game',    'ctx', '', 'output',  'num2', ALL, lower=True, den='g', thr=8),
    M('offsideg', 'Offside flags / game', 'ctx', '', 'output', 'num2', FRONT, lower=True, den='g', thr=12),
    M('rtpg',     'Roughing-the-passer flags / game', 'ctx', '', 'output', 'num2', FRONT, lower=True, den='g', thr=12),
    M('stshr',    'Special-teams snap share', 'ctx', '', 'context', 'pct1', TEAMERS, tier=4),
    M('sttk',     'Special-teams tackles / game', 'ctx', '', 'output', 'num2', TEAMERS, den='g', thr=8),
    M('soso',     'Offenses faced (EPA / play)', 'ctx', '', 'context', 'num3', DEF, tier=4, den='g', thr=6),

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
    M('rushfaceq','Pass rushers faced',  'pass', 'Pocket',     'context',  'num2', ['QB'], tier=7, den='db', thr=200),
    M('oop',      'Out-of-pocket rate',  'pass', 'Pocket',     'ingredient', 'pct1', ['QB'], tier=7, den='db', thr=200),
    M('faultsack','Sacks that were his fault', 'pass', 'Pocket', 'output',  'pct1', ['QB'], tier=7, den='db', thr=250, lower=True),
    M('scrrate',  'Scramble rate',       'pass', 'Pocket',     'ingredient', 'pct1', ['QB'], den='db', thr=150),
    M('p2s',      'Pressure-to-sack rate', 'pass', 'Pocket',   'output',   'pct1', ['QB'], tier=6, den='qprs', thr=80, lower=True),
    M('hurrypct', 'Hurry rate faced',    'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200, lower=True),
    M('hitpct',   'Hit rate faced',      'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200, lower=True),
    M('adot',     'Average depth of target', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=2, den='att', thr=150),
    M('aysticks', 'Air yards to sticks', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=5, den='att', thr=150),
    M('aggr',     'Aggressiveness',      'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=5, den='att', thr=150),
    M('deeprate', 'Deep attempt rate',   'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=2, den='att', thr=150),
    M('parate',   'Play-action rate',    'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=6, den='db', thr=150),
    M('rporate',  'RPO rate',            'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=6, den='db', thr=150),
    M('screen',   'Screen rate',         'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('motion',   'Pre-snap motion rate', 'pass', 'Shot selection', 'context', 'pct1', ['QB'], tier=7, den='db', thr=150),
    M('nohuddle', 'No-huddle rate',      'pass', 'Shot selection', 'context', 'pct1', ['QB'], tier=7, den='db', thr=150),
    M('ucrate',   'Under-center rate',   'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=7, den='db', thr=150),
    M('cayatt',   'Completed air yards / attempt', 'pass', 'Shot selection', 'output', 'num2', ['QB'], tier=2, den='att', thr=150),
    M('yacshr',   'Share of yards after the catch', 'pass', 'Shot selection', 'context', 'pct1', ['QB'], tier=2, den='att', thr=150),
    M('manrate',  'Man coverage faced',  'pass', 'Shot selection', 'context', 'pct1', ['QB'], tier=6, den='db', thr=150),
    M('firstread', 'First-read throw rate', 'pass', 'Reads', 'ingredient', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('checkdown', 'Checkdown rate',     'pass', 'Reads', 'ingredient', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('xcomp',    'Expected completion %', 'pass', 'Accuracy', 'expected', 'pct1', ['QB'], tier=5, den='att', thr=150),
    M('ontgt',    'On-target %',         'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=6, den='att', thr=150),
    M('badthrow', 'Bad throw %',         'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=6, den='att', thr=150, lower=True),
    M('droppct',  'Drop % (his throws)', 'pass', 'Accuracy', 'context', 'pct1', ['QB'], tier=6, den='att', thr=200, lower=True),
    M('catchable', 'Catchable ball %',   'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('throwaway', 'Throwaway rate',     'pass', 'Accuracy', 'ingredient', 'pct1', ['QB'], tier=7, den='att', thr=150),
    M('iwrate',   'Interception-worthy rate', 'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=7, den='att', thr=200, lower=True),
    M('intluck',  'INT % minus interception-worthy %', 'pass', 'Accuracy', 'context', 'sgn1', ['QB'], tier=7, den='att', thr=200, lower=True),
    M('cmpb',     'Completion %, behind the line', 'pass', 'By depth', 'output', 'pct1', ['QB'], tier=2, den='attb', thr=25),
    M('cmps',     'Completion %, 0-9 yards',  'pass', 'By depth', 'output', 'pct1', ['QB'], tier=2, den='atts', thr=90),
    M('cmpm',     'Completion %, 10-19 yards', 'pass', 'By depth', 'output', 'pct1', ['QB'], tier=2, den='attm', thr=50),
    M('cmpd',     'Completion %, 20+ yards',  'pass', 'By depth', 'output', 'pct1', ['QB'], tier=2, den='attd', thr=30),
    M('ypab',     'Yards / attempt, behind the line', 'pass', 'By depth', 'output', 'num2', ['QB'], tier=2, den='attb', thr=25),
    M('ypas',     'Yards / attempt, 0-9 yards', 'pass', 'By depth', 'output', 'num2', ['QB'], tier=2, den='atts', thr=90),
    M('ypam',     'Yards / attempt, 10-19 yards', 'pass', 'By depth', 'output', 'num2', ['QB'], tier=2, den='attm', thr=50),
    M('ypad',     'Yards / attempt, 20+ yards', 'pass', 'By depth', 'output', 'num2', ['QB'], tier=2, den='attd', thr=30),
    M('airdist',  'Average air distance', 'pass', 'Arm', 'ingredient', 'num1', ['QB'], tier=5, den='att', thr=150),
    M('maxair',   'Longest completion in the air', 'pass', 'Arm', 'context', 'num1', ['QB'], tier=5),
    M('ngscpoe',  'CPOE (tracking)',     'pass', 'Arm', 'expected', 'sgn1', ['QB'], tier=5, den='att', thr=200),
    M('epapa',    'EPA / dropback, play-action', 'pass', 'By situation', 'output', 'num3', ['QB'], tier=7, den='padb', thr=60),
    M('epablz',   'EPA / dropback when blitzed', 'pass', 'By situation', 'output', 'num3', ['QB'], tier=7, den='blzdb', thr=60),
    M('epauc',    'EPA / dropback under center', 'pass', 'By situation', 'output', 'num3', ['QB'], tier=7, den='ucdb', thr=60),
    M('epaman',   'EPA / dropback vs man coverage', 'pass', 'By situation', 'output', 'num3', ['QB'], tier=6, den='mandb', thr=60),
    M('epazone',  'EPA / dropback vs zone coverage', 'pass', 'By situation', 'output', 'num3', ['QB'], tier=6, den='zonedb', thr=120),
    M('epadbng',  'EPA / dropback, game in doubt', 'pass', 'By situation', 'output', 'num3', ['QB'], den='ngdb', thr=150),
    M('fddb',     'First-down rate',     'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=200),
    M('td3conv',  'Third/fourth-down conversion', 'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=80),
    M('rztd',     'Red-zone TD rate',    'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=60),
    M('ppd',      'Points / drive',      'pass', 'Drives', 'output', 'num2', ['QB'], den='drv', thr=60),
    M('tddrv',    'Touchdown drive rate', 'pass', 'Drives', 'output', 'pct1', ['QB'], den='drv', thr=60),
    M('to3',      'Three-and-out rate',  'pass', 'Drives', 'output', 'pct1', ['QB'], den='drv', thr=60, lower=True),
    M('sosp',     'Pass defenses faced', 'pass', 'Schedule', 'context', 'num3', ['QB'], den='db', thr=100, lower=True),
    M('epadbadj', 'EPA / dropback, opponent-adjusted', 'pass', 'Schedule', 'output', 'num3', ['QB'], den='db', thr=200),

    # ---------------------------------------------------------------- rushing
    M('car',      'Carries / game',      'rush', 'Volume', 'context', 'num1', ['RB', 'QB', 'WR', 'TE']),
    M('rushy',    'Rushing yards / game', 'rush', 'Volume', 'output', 'num1', ['RB', 'QB', 'WR'], den='g', thr=8),
    M('desrun',   'Designed runs / game', 'rush', 'Volume', 'context', 'num1', ['QB']),
    M('carshr',   'Share of team carries', 'rush', 'Volume', 'context', 'pct1', ['RB'], den='g', thr=6),
    M('i10shr',   'Share of carries inside the 10', 'rush', 'Volume', 'context', 'pct1', ['RB'], den='g', thr=8),
    M('i5shr',    'Share of carries inside the 5', 'rush', 'Volume', 'context', 'pct1', ['RB'], den='g', thr=8),
    M('epacar',   'EPA / carry',         'rush', 'Efficiency', 'output', 'num3', ['RB', 'QB', 'WR'], den='car', thr=120),
    M('srcar',    'Rush success rate',   'rush', 'Efficiency', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=100),
    M('ypc',      'Yards / carry',       'rush', 'Efficiency', 'output', 'num2', ['RB', 'QB', 'WR'], den='car', thr=120),
    M('ryoe',     'Rush yards over expected / att', 'rush', 'Efficiency', 'expected', 'num2', ['RB', 'QB'], tier=5, den='car', thr=100),
    M('ropct',    'Runs over expected',  'rush', 'Efficiency', 'expected', 'pct1', ['RB'], tier=5, den='car', thr=100),
    M('rueff',    'Rushing efficiency (yards run per yard gained)', 'rush', 'Efficiency', 'ingredient', 'num2', ['RB'], tier=5, den='car', thr=100, lower=True),
    M('ypcdes',   'Yards / designed run', 'rush', 'Efficiency', 'output', 'num2', ['QB'], den='descar', thr=40),
    M('ypcscr',   'Yards / scramble',    'rush', 'Efficiency', 'output', 'num2', ['QB'], den='scr', thr=25),
    M('epascr',   'EPA / scramble',      'rush', 'Efficiency', 'output', 'num3', ['QB'], den='scr', thr=25),
    M('ybc',      'Yards before contact / att', 'rush', 'Contact', 'context', 'num2', ['RB'], tier=6, den='car', thr=100),
    M('yacr',     'Yards after contact / att', 'rush', 'Contact', 'output', 'num2', ['RB'], tier=6, den='car', thr=100),
    M('brkrate',  'Broken tackle rate',  'rush', 'Contact', 'output', 'pct1', ['RB'], tier=6, den='car', thr=100),
    M('stuff',    'Stuffed rate',        'rush', 'Contact', 'output', 'pct1', ['RB', 'QB'], den='car', thr=100, lower=True),
    M('ex10',     '10+ yard run rate',   'rush', 'Explosiveness', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=100),
    M('ex20',     '20+ yard run rate',   'rush', 'Explosiveness', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=150),
    M('box8',     '8+ in the box',       'rush', 'Context', 'context', 'pct1', ['RB'], tier=5, den='car', thr=80),
    M('boxcar',   'Defenders in the box', 'rush', 'Context', 'context', 'num2', ['RB'], tier=7, den='car', thr=80),
    M('tlos',     'Time behind the line', 'rush', 'Context', 'ingredient', 'sec', ['RB'], tier=5, den='car', thr=80, lower=True),
    M('ypclt',    'Yards / carry vs light boxes', 'rush', 'Context', 'output', 'num2', ['RB'], tier=7, den='carlt', thr=50),
    M('ypcst',    'Yards / carry vs stacked boxes', 'rush', 'Context', 'output', 'num2', ['RB'], tier=7, den='carst', thr=30),
    M('sosr',     'Run defenses faced',  'rush', 'Context', 'context', 'num3', ['RB'], den='car', thr=80, lower=True),
    M('epacaradj','EPA / carry, opponent-adjusted', 'rush', 'Context', 'output', 'num3', ['RB'], den='car', thr=120),
    M('outrate',  'Outside run rate',    'rush', 'Direction', 'ingredient', 'pct1', ['RB'], den='car', thr=100),
    M('ypcin',    'Yards / carry inside', 'rush', 'Direction', 'output', 'num2', ['RB'], den='carin', thr=60),
    M('srin',     'Success rate inside', 'rush', 'Direction', 'output', 'pct1', ['RB'], den='carin', thr=60),
    M('ypcout',   'Yards / carry outside', 'rush', 'Direction', 'output', 'num2', ['RB'], den='carout', thr=40),
    M('srout',    'Success rate outside', 'rush', 'Direction', 'output', 'pct1', ['RB'], den='carout', thr=40),
    M('fdcar',    'First-down rate',     'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car', thr=100),
    M('rztdcar',  'Red-zone TD rate',    'rush', 'Situational', 'output', 'pct1', ['RB'], den='car', thr=30),
    M('fumrate',  'Fumble rate',         'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car', thr=250, lower=True),
    M('syconv',   'Short-yardage conversion rate', 'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='sy', thr=20),
    M('snkconv',  'Sneak conversion rate', 'rush', 'Situational', 'output', 'pct1', ['QB'], tier=7, den='snk', thr=10),

    # ---------------------------------------------------------------- receiving
    M('tgt',      'Targets / game',      'rec', 'Opportunity', 'context', 'num1', PASSC, tier=3),
    M('recg',     'Receptions / game',   'rec', 'Opportunity', 'context', 'num1', PASSC),
    M('tgtshr',   'Target share',        'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=3, den='g', thr=6),
    # Receivers and tight ends only: a back's air yards are mostly behind the line, so his
    # "share" goes negative (Bijan Robinson, -6.4%) and ranks him last for doing his job.
    M('ayshr',    'Air yards share',     'rec', 'Opportunity', 'context', 'pct1', ['WR', 'TE'], tier=3, den='g', thr=6),
    M('wopr',     'WOPR',                'rec', 'Opportunity', 'context', 'num2', PASSC, tier=3, den='g', thr=6),
    M('tprs',     'Targets / snap',      'rec', 'Opportunity', 'ingredient', 'pct1', PASSC, tier=4, den='snap', thr=200),
    M('ypsnap',   'Yards / snap',        'rec', 'Opportunity', 'output', 'num2', PASSC, tier=4, den='snap', thr=200),
    M('tpps',     'Targets / pass-play snap', 'rec', 'Opportunity', 'ingredient', 'pct1', PASSC, tier=5, den='opsnap', thr=150, est='live'),
    M('ypps',     'Yards / pass-play snap', 'rec', 'Opportunity', 'output', 'num2', PASSC, tier=5, den='opsnap', thr=150, est='live'),
    M('frshr',    'First-read target share', 'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=7, den='g', thr=6),
    M('ydshr',    'Share of team receiving yards', 'rec', 'Opportunity', 'context', 'pct1', PASSC, den='g', thr=6),
    M('tdshr',    'Share of team receiving TDs', 'rec', 'Opportunity', 'context', 'pct1', PASSC, den='g', thr=10),
    M('fdshr',    'Share of team receiving first downs', 'rec', 'Opportunity', 'context', 'pct1', PASSC, den='g', thr=6),
    M('ezshr',    'Share of end-zone targets', 'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=3, den='g', thr=8),
    M('eztgt',    'End-zone targets / game', 'rec', 'Opportunity', 'context', 'num2', PASSC, tier=3, den='g', thr=8),
    M('tgt1st',   'First-read rate',     'rec', 'Target mix', 'ingredient', 'pct1', PASSC, tier=7, den='tgt', thr=60),
    M('tgtdes',   'Designed-target rate', 'rec', 'Target mix', 'ingredient', 'pct1', PASSC, tier=7, den='tgt', thr=60),
    M('tgtchk',   'Checkdown-target rate', 'rec', 'Target mix', 'ingredient', 'pct1', PASSC, tier=7, den='tgt', thr=60),
    M('tgtscr',   'Screen-target rate',  'rec', 'Target mix', 'ingredient', 'pct1', PASSC, tier=7, den='tgt', thr=60),
    M('recy',     'Receiving yards / game', 'rec', 'Efficiency', 'output', 'num1', PASSC, den='g', thr=8),
    M('ypt',      'Yards / target',      'rec', 'Efficiency', 'output', 'num2', PASSC, tier=3, den='tgt', thr=150),
    M('yprec',    'Yards / reception',   'rec', 'Efficiency', 'output', 'num2', PASSC, den='rec', thr=50),
    M('epatgt',   'EPA / target',        'rec', 'Efficiency', 'output', 'num3', PASSC, tier=3, den='tgt', thr=120),
    M('srtgt',    'Target success rate', 'rec', 'Efficiency', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('catch',    'Catch rate',          'rec', 'Efficiency', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('racr',     'RACR',                'rec', 'Efficiency', 'output', 'num2', PASSC, tier=3, den='tgt', thr=120),
    M('rattgt',   'Passer rating when targeted', 'rec', 'Efficiency', 'output', 'num1', PASSC, tier=3, den='tgt', thr=100),
    M('yptman',   'Yards / target vs man coverage', 'rec', 'Efficiency', 'output', 'num2', PASSC, tier=6, den='tgtman', thr=30),
    M('yptzone',  'Yards / target vs zone coverage', 'rec', 'Efficiency', 'output', 'num2', PASSC, tier=6, den='tgtzone', thr=50),
    M('adotr',    'Average depth of target', 'rec', 'Route profile', 'ingredient', 'num1', PASSC, tier=3, den='tgt', thr=80),
    M('deeptgt',  'Deep target rate',    'rec', 'Route profile', 'ingredient', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('sep',      'Average separation',  'rec', 'Route profile', 'output', 'num2', PASSC, tier=5, den='tgt', thr=80),
    M('cush',     'Average cushion',     'rec', 'Route profile', 'context', 'num2', PASSC, tier=5, den='tgt', thr=80, lower=True),
    M('yptb',     'Yards / target, behind the line', 'rec', 'By depth', 'output', 'num2', PASSC, tier=3, den='tgtb', thr=25),
    M('ypts',     'Yards / target, 0-9 yards', 'rec', 'By depth', 'output', 'num2', PASSC, tier=3, den='tgts', thr=50),
    M('yptm',     'Yards / target, 10-19 yards', 'rec', 'By depth', 'output', 'num2', PASSC, tier=3, den='tgtm', thr=35),
    M('yptd',     'Yards / target, 20+ yards', 'rec', 'By depth', 'output', 'num2', PASSC, tier=3, den='tgtd', thr=25),
    M('catchs',   'Catch rate, 0-9 yards', 'rec', 'By depth', 'output', 'pct1', PASSC, tier=3, den='tgts', thr=50),
    M('catchm',   'Catch rate, 10-19 yards', 'rec', 'By depth', 'output', 'pct1', PASSC, tier=3, den='tgtm', thr=35),
    M('catchd',   'Catch rate, 20+ yards', 'rec', 'By depth', 'output', 'pct1', PASSC, tier=3, den='tgtd', thr=25),
    M('yacrec',   'YAC / reception',     'rec', 'After the catch', 'output', 'num2', PASSC, tier=2, den='rec', thr=60),
    M('yacoe',    'YAC over expected / rec', 'rec', 'After the catch', 'expected', 'num2', PASSC, tier=5, den='rec', thr=60),
    M('xyacoe',   'YAC over expected / rec (play-by-play model)', 'rec', 'After the catch', 'expected', 'num2', PASSC, tier=2, den='rec', thr=60),
    M('ybcr',     'Yards before catch / rec', 'rec', 'After the catch', 'ingredient', 'num2', PASSC, tier=2, den='rec', thr=60),
    M('brkrec',   'Broken tackle rate',  'rec', 'After the catch', 'output', 'pct1', PASSC, tier=6, den='rec', thr=60),
    M('created',  'Created reception rate', 'rec', 'After the catch', 'output', 'pct1', PASSC, tier=7, den='tgt', thr=100),
    M('croe',     'Catch rate over expected', 'rec', 'Hands', 'expected', 'sgn1', PASSC, tier=3, den='tgt', thr=100),
    M('dropr',    'Drop %',              'rec', 'Hands', 'output', 'pct1', PASSC, tier=6, den='tgt', thr=120, lower=True),
    M('ctchtgt',  'Catchable target %',  'rec', 'Hands', 'context', 'pct1', PASSC, tier=7, den='tgt', thr=100),
    M('ctchhand', 'Catch rate on catchable balls', 'rec', 'Hands', 'output', 'pct1', PASSC, tier=7, den='tgt', thr=100),
    M('contest',  'Contested target rate', 'rec', 'Hands', 'context', 'pct1', PASSC, tier=7, den='tgt', thr=100),
    M('contestw', 'Contested catch rate', 'rec', 'Hands', 'output', 'pct1', PASSC, tier=7, den='tgt', thr=150),
    M('fdtgt',    'First-down rate',     'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('ex20rec',  '20+ yard catch rate', 'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('tdtgt',    'TD rate / target',    'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=250),
    M('rztgtr',   'Red-zone target rate', 'rec', 'Situational', 'context', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('td3tgt',   'Third-down targets / game', 'rec', 'Situational', 'context', 'num2', PASSC, tier=3, den='g', thr=8),
    M('td3cv',    'Third-down conversion rate', 'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='td3t', thr=30),
    M('dpig',     'Interference drawn / game', 'rec', 'Situational', 'output', 'num2', PASSC, den='g', thr=12),
    M('dpiyds',   'Interference yards drawn / game', 'rec', 'Situational', 'output', 'num1', PASSC, den='g', thr=12),
    M('sospr',    'Pass defenses faced', 'rec', 'Situational', 'context', 'num3', PASSC, den='tgt', thr=60, lower=True),


    # ---------------------------------------------------------------- returns
    M('krg',      'Kick returns / game', 'ret', 'Kick returns', 'context', 'num2', RETURNERS),
    M('kravg',    'Kick return average', 'ret', 'Kick returns', 'output', 'num1', RETURNERS, den='kr', thr=15),
    M('krepa',    'EPA / kick return',   'ret', 'Kick returns', 'output', 'num3', RETURNERS, den='kr', thr=15),
    M('prg',      'Punt returns / game', 'ret', 'Punt returns', 'context', 'num2', RETURNERS),
    M('pravg',    'Punt return average', 'ret', 'Punt returns', 'output', 'num1', RETURNERS, den='pr', thr=12),
    M('prepa',    'EPA / punt return',   'ret', 'Punt returns', 'output', 'num3', RETURNERS, den='pr', thr=12),

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
    M('pen100',   'Penalties / 100 snaps',   'block', 'Discipline', 'output', 'num2', OLINE + ['TE'], tier=4, den='snap', thr=250, lower=True),
    M('penydg',   'Penalty yards / game',    'block', 'Discipline', 'output', 'num1', OLINE + ['TE'], den='g', thr=10, lower=True),
    M('penstall', 'Drive-stalling flags / game', 'block', 'Discipline', 'output', 'num2', OLINE + ['TE'], den='g', thr=10, lower=True),
    M('prsallow', 'Pressure rate allowed',   'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='pblk', thr=200, lower=True),
    M('prsallowc','Pressure rate allowed (charted)', 'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE, tier=6, den='pblk', thr=200, lower=True),
    M('sackallow','Sack rate allowed',       'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='pblk', thr=300, lower=True),
    M('hitallow', 'QB-hit rate allowed',     'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE, tier=5, den='pblk', thr=250, lower=True),
    M('epadbon',  'EPA / dropback',          'block', 'Protection (unit, on his snaps)', 'output', 'num3', OLINE + ['TE'], tier=5, den='pblk', thr=200),
    M('srdbon',   'Dropback success rate',   'block', 'Protection (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='pblk', thr=200),
    M('rushfaced','Pass rushers faced',      'block', 'Protection (unit, on his snaps)', 'context', 'num2', OLINE + ['TE'], tier=5, den='pblk', thr=200),
    M('ypcon',    'Yards / carry',           'block', 'Run game (unit, on his snaps)', 'output', 'num2', OLINE + ['TE'], tier=5, den='rblk', thr=150),
    M('srrunon',  'Rush success rate',       'block', 'Run game (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='rblk', thr=150),
    M('stuffon',  'Stuffed rate',            'block', 'Run game (unit, on his snaps)', 'output', 'pct1', OLINE + ['TE'], tier=5, den='rblk', thr=150, lower=True),
    M('boxfaced', 'Defenders in the box',    'block', 'Run game (unit, on his snaps)', 'context', 'num2', OLINE + ['TE'], tier=5, den='rblk', thr=150),
    M('gapsr',    'Success rate, runs to his gap', 'block', 'Runs to his gap', 'output', 'pct1', OLINE, tier=4, den='gaprun', thr=60),
    M('gapypc',   'Yards / carry, runs to his gap', 'block', 'Runs to his gap', 'output', 'num2', OLINE, tier=4, den='gaprun', thr=60),
    M('gapstuff', 'Stuffed rate, runs to his gap', 'block', 'Runs to his gap', 'output', 'pct1', OLINE, tier=4, den='gaprun', thr=60, lower=True),
    M('prsoo',    'Pressure rate, on minus off', 'block', 'On / off', 'output', 'sgn1', OLINE + ['TE'], tier=5, den='pblk', thr=250, lower=True),
    M('epaoo',    'EPA / dropback, on minus off', 'block', 'On / off', 'output', 'sgn3', OLINE + ['TE'], tier=5, den='pblk', thr=250),
    M('sroo',     'Rush success, on minus off', 'block', 'On / off', 'output', 'sgn1', OLINE + ['TE'], tier=5, den='rblk', thr=200),
    M('gwo',      'Team EPA / play, his games minus the ones he missed', 'block', 'On / off', 'output', 'sgn3', OLINE, tier=4, den='g', thr=12),
    M('linescore','His line\'s grade',        'block', 'His line', 'context', 'num0', OLINE, tier=4),
    M('linecont', 'Line continuity',         'block', 'His line', 'context', 'pct1', OLINE, tier=4),
    # ---------------------------------------------------------------- pass rush
    M('prss',     'Pressures / game',    'prsh', 'Pressure', 'output', 'num1', FRONT, tier=6, den='g', thr=8),
    M('prsssnap', 'Pressures / defensive snap', 'prsh', 'Pressure', 'output', 'pct1', FRONT, tier=6, den='dsnap', thr=250),
    M('prsspass', 'Pressures / pass-play snap', 'prsh', 'Pressure', 'output', 'pct1', FRONT, tier=6, den='dpsnap', thr=150, est='live'),
    M('prsshr',   'Share of team pressures', 'prsh', 'Pressure', 'context', 'pct1', FRONT, tier=6, den='g', thr=8),
    M('hrry',     'Hurries / game',      'prsh', 'Pressure', 'output', 'num1', FRONT, tier=6, den='g', thr=8),
    M('qbkd',     'QB knockdowns / game', 'prsh', 'Pressure', 'output', 'num2', FRONT, tier=6, den='g', thr=8),
    M('hits',     'QB hits / game',      'prsh', 'Pressure', 'output', 'num2', FRONT, den='g', thr=8),
    M('prod',     'Pass-rush productivity', 'prsh', 'Pressure', 'output', 'num2', FRONT, tier=6, den='dsnap', thr=250),
    M('blitz',    'Blitzes / game',      'prsh', 'Pressure', 'context', 'num1', ['LB', 'CB', 'S'], tier=6, den='g', thr=8),
    M('blitzrate','Blitz rate',          'prsh', 'Pressure', 'context', 'pct1', ['LB', 'CB', 'S'], tier=6, den='dpsnap', thr=150, est='live'),
    M('sk',       'Sacks / game',        'prsh', 'Finishing', 'output', 'num2', FRONT, den='g', thr=16),
    M('sksnap',   'Sacks / snap',        'prsh', 'Finishing', 'output', 'pct1', FRONT, tier=4, den='dsnap', thr=400),
    M('skpass',   'Sacks / pass-play snap', 'prsh', 'Finishing', 'output', 'pct1', FRONT, tier=5, den='dpsnap', thr=250, est='live'),
    M('skshr',    'Share of team sacks', 'prsh', 'Finishing', 'context', 'pct1', FRONT, den='g', thr=8),
    M('tfl',      'Tackles for loss / game', 'prsh', 'Finishing', 'output', 'num2', DEF, den='g', thr=12),
    M('tflsnap',  'TFL / snap',          'prsh', 'Finishing', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=300),
    M('bats',     'Batted passes / game', 'prsh', 'Finishing', 'output', 'num2', FRONT, tier=6, den='g', thr=16),
    M('ff',       'Forced fumbles / game', 'prsh', 'Finishing', 'output', 'num2', DEF, den='g', thr=16),
    M('skepa',    'EPA / sack',          'prsh', 'Sack value', 'output', 'num2', FRONT, den='skn', thr=6),
    M('skyd',     'Yards lost / sack',   'prsh', 'Sack value', 'output', 'num1', FRONT, den='skn', thr=6),
    M('sk3rd',    'Third-down sacks / game', 'prsh', 'Sack value', 'output', 'num2', FRONT, den='g', thr=16),
    M('stripsk',  'Strip sacks / game',  'prsh', 'Sack value', 'output', 'num2', FRONT, den='g', thr=16),

    # ---------------------------------------------------------------- run defense
    M('tkl',      'Tackles / game',      'rdef', 'Volume', 'context', 'num1', DEF),
    M('tklsnap',  'Tackles / snap',      'rdef', 'Volume', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=250),
    M('solopct',  'Solo tackle share',   'rdef', 'Volume', 'ingredient', 'pct1', DEF, den='g', thr=10),
    M('mtklpct',  'Missed tackle %',     'rdef', 'Reliability', 'output', 'pct1', DEF, tier=6, den='dsnap', thr=250, lower=True),
    M('rstop',    'Run stops / game',    'rdef', 'Stops', 'output', 'num2', DEF, den='g', thr=8),
    M('rstoprate','Run-stop rate',       'rdef', 'Stops', 'output', 'pct1', DEF, tier=5, den='drsnap', thr=120, est='live'),
    M('rtkdepth', 'Average depth of run tackle', 'rdef', 'Stops', 'output', 'num2', DEF, den='rtk', thr=25, lower=True),
    M('havoc',    'Havoc rate',          'rdef', 'Stops', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=250),
    M('passshr',  'Pass-play share of his snaps', 'rdef', 'Role', 'context', 'pct1', DEF, tier=5, den='dsnap', thr=250),
    M('depaoo',   'EPA / play allowed, on minus off', 'rdef', 'On / off', 'output', 'sgn3', DEF, tier=5, den='dsnap', thr=300, lower=True),
    M('drsoo',    'Run success allowed, on minus off', 'rdef', 'On / off', 'output', 'sgn1', FRONT, tier=5, den='drsnap', thr=150, lower=True),

    # ---------------------------------------------------------------- coverage
    M('ctgt',     'Targets defended / game', 'cov', 'Volume', 'context', 'num1', COV, tier=6),
    M('ctgtsnap', 'Targets / defensive snap', 'cov', 'Volume', 'context', 'pct1', COV, tier=6, den='dsnap', thr=250, lower=True),
    M('ctgtcov',  'Targets / coverage snap', 'cov', 'Volume', 'context', 'pct1', COV, tier=6, den='dpsnap', thr=150, lower=True, est='live'),
    M('cmpall',   'Completion % allowed', 'cov', 'Coverage', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('yptall',   'Yards / target allowed', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ycs',      'Yards allowed / defensive snap', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ratall',   'Passer rating allowed', 'cov', 'Coverage', 'output', 'num1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('yacall',   'YAC allowed / completion', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ycovsnap', 'Yards allowed / coverage snap', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='dpsnap', thr=150, lower=True, est='live'),
    M('airall',   'Air yards allowed / completion', 'cov', 'Coverage', 'context', 'num1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('tdall',    'Touchdowns allowed / game', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='g', thr=12, lower=True),
    M('tkyac',    'Yards after catch at his tackles', 'cov', 'Coverage', 'output', 'num2', COV, tier=2, den='ptk', thr=20, lower=True),
    M('dpepaoo',  'EPA / dropback allowed, on minus off', 'cov', 'Coverage', 'output', 'sgn3', COV, tier=5, den='dpsnap', thr=250, lower=True),
    M('dadot',    'Depth of target covered', 'cov', 'Assignment', 'context', 'num1', COV, tier=6, den='ctgt', thr=40),
    M('int',      'Interceptions / game', 'cov', 'Ball production', 'output', 'num2', DEF, den='g', thr=32),
    M('pd',       'Passes defended / game', 'cov', 'Ball production', 'output', 'num2', DEF, den='g', thr=16),
    M('ballrate', 'Ball production / target', 'cov', 'Ball production', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50),
    M('covpen',   'Coverage flags / game', 'cov', 'Flags', 'output', 'num2', COV, den='g', thr=12, lower=True),
    M('covpenyds','Coverage flag yards / game', 'cov', 'Flags', 'output', 'num1', COV, den='g', thr=12, lower=True),

    # ---------------------------------------------------------------- kicking
    M('fgpct',    'Field goal %',        'kick', 'Kicking', 'output', 'pct1', ['K'], den='fga', thr=25),
    M('fgoe',     'FG over expected / att', 'kick', 'Kicking', 'expected', 'num2', ['K'], den='fga', thr=25),
    M('fg50',     '50+ yard FG %',       'kick', 'Kicking', 'output', 'pct1', ['K'], den='fga', thr=40),
    M('fglong',   'Longest field goal',  'kick', 'Kicking', 'context', 'num0', ['K']),
    M('fga',      'FG attempts / game',  'kick', 'Kicking', 'context', 'num1', ['K']),
    M('patpct',   'Extra point %',       'kick', 'Kicking', 'output', 'pct1', ['K'], den='g', thr=10),
    M('fgoeout',  'FG over expected, outdoors', 'kick', 'Kicking', 'expected', 'num2', ['K'], den='fgaout', thr=20),
    M('fgwpa',    'Field goal win probability added', 'kick', 'Kicking', 'output', 'num2', ['K']),
    M('kotb',     'Kickoff touchback rate', 'kick', 'Kickoffs', 'output', 'pct1', ['K', 'P'], den='ko', thr=30),
    M('kodist',   'Kickoff distance',    'kick', 'Kickoffs', 'ingredient', 'num1', ['K', 'P'], den='ko', thr=30),
    M('koflag',   'Kickoffs out of bounds / 100', 'kick', 'Kickoffs', 'output', 'num1', ['K', 'P'], den='ko', thr=30, lower=True),
    M('pgross',   'Gross punt average',  'kick', 'Punting', 'output', 'num1', ['P'], den='punt', thr=40),
    M('pnet',     'Net punt average',    'kick', 'Punting', 'output', 'num1', ['P'], den='punt', thr=40),
    M('pin20',    'Inside-20 rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40),
    M('ptb',      'Touchback rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40, lower=True),
    M('pretr',    'Return rate allowed', 'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40, lower=True),
    M('pretyds',  'Return yards allowed / punt', 'kick', 'Punting', 'output', 'num2', ['P'], den='punt', thr=40, lower=True),
    M('pepa',     'EPA / punt',          'kick', 'Punting', 'output', 'num3', ['P'], den='punt', thr=40),
    M('punts',    'Punts / game',        'kick', 'Punting', 'context', 'num1', ['P']),

    # ---------------------------------------------------------------- value
    M('epatot',   'Total EPA',           'val', '', 'output', 'num1', SKILL),
    M('fppg',     'Fantasy points / game', 'val', '', 'output', 'num1', SKILL + ['K']),
    M('toucheg',  'Touches / game',      'val', '', 'context', 'num1', ['RB', 'WR', 'TE']),
    M('xfp',      'Expected fantasy points / game', 'val', '', 'expected', 'num1', SKILL, tier=2, den='g', thr=8),
    M('fpoe',     'Fantasy points over expected / game', 'val', '', 'output', 'sgn1', SKILL, tier=2, den='g', thr=8),
    M('tdoe',     'Touchdowns over expected', 'val', '', 'context', 'sgn1', SKILL, tier=2),
    M('wpa',      'Win probability added', 'val', '', 'output', 'num2', SKILL),
    M('apy',      'Average pay per year ($M)', 'val', '', 'context', 'num1', ALL, tier=4),
    M('capshr',   'Share of the salary cap', 'val', '', 'context', 'pct1', ALL, tier=4),

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

_with_position_lines(METRICS)
# Rows worked out from snap share while a season is being played, and from the
# participation file once it is over (extras.py). Tagged "est." in the season in progress.
for _m in METRICS:
    if _m['key'] in ('pblkg', 'rblkg', 'sackallow', 'hitallow', 'epadbon', 'srdbon',
                     'rushfaced', 'ypcon', 'srrunon', 'stuffon', 'boxfaced'):
        _m['est'] = 'live'

GROUP_LABEL = {
    'ctx': 'Context', 'pass': 'Passing', 'rush': 'Rushing', 'rec': 'Receiving',
    'prsh': 'Pass rush', 'rdef': 'Run defense', 'cov': 'Coverage',
    'kick': 'Kicking & punting', 'val': 'Value', 'ath': 'Athletic profile',
    'block': 'Blocking', 'ret': 'Returns',
}

# Which panels a cohort shows, in order. Position is the page's organizing principle:
# a corner and a center share no box score, so they should not share a metric table.
POS_PANELS = {
    'QB':  ['ctx', 'pass', 'rush', 'val', 'ath'],
    'RB':  ['ctx', 'rush', 'rec', 'ret', 'val', 'ath'],
    'WR':  ['ctx', 'rec', 'rush', 'ret', 'val', 'ath'],
    'TE':  ['ctx', 'rec', 'block', 'val', 'ath'],
    'OL':  ['ctx', 'block', 'val', 'ath'],
    'OT':  ['ctx', 'block', 'val', 'ath'],
    'OG':  ['ctx', 'block', 'val', 'ath'],
    'OC':  ['ctx', 'block', 'val', 'ath'],
    'ED':  ['ctx', 'prsh', 'rdef', 'cov', 'val', 'ath'],
    'DI':  ['ctx', 'prsh', 'rdef', 'val', 'ath'],
    'LB':  ['ctx', 'rdef', 'prsh', 'cov', 'val', 'ath'],
    'CB':  ['ctx', 'cov', 'rdef', 'ret', 'val', 'ath'],
    'S':   ['ctx', 'cov', 'rdef', 'prsh', 'ret', 'val', 'ath'],
    'K':   ['ctx', 'kick', 'val'],
    'P':   ['ctx', 'kick', 'val'],
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
