"""The Football Savant metric table.

One row per bar the tool can draw. Read the fields as:

  key    stable id, used by the page and by shareable URLs
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

TIER_SINCE = {1: 1999, 2: 2006, 3: 2012, 4: 2013, 5: 2016, 6: 2018}

# Sample-size denominators. A metric's stabilization threshold is expressed in whichever
# of these it actually accumulates, so the page can hatch a bar honestly rather than
# guessing from games played.
DENOMS = {
    'db': 'dropbacks', 'att': 'pass attempts', 'car': 'carries', 'tgt': 'targets',
    'rec': 'receptions', 'snap': 'snaps', 'dsnap': 'defensive snaps',
    'ctgt': 'targets defended', 'fga': 'field goal attempts', 'punt': 'punts',
    'g': 'games',
}

SKILL = ['QB', 'RB', 'WR', 'TE']
PASSC = ['WR', 'TE', 'RB']
DEF = ['ED', 'DI', 'LB', 'CB', 'S']
FRONT = ['ED', 'DI', 'LB']
COV = ['CB', 'S', 'LB']
ALL = ['QB', 'RB', 'WR', 'TE', 'OL', 'ED', 'DI', 'LB', 'CB', 'S', 'K', 'P']


def M(key, label, grp, sub, layer, unit, pos, tier=1, den='g', thr=0, lower=False, note=None):
    return dict(key=key, label=label, grp=grp, sub=sub, layer=layer, unit=unit,
                pos=list(pos), tier=tier, den=den, thr=thr, lower=lower,
                since=TIER_SINCE[tier], note=note)


METRICS = [
    # ---------------------------------------------------------------- context
    M('g',        'Games played',        'ctx', '', 'context', 'num0', ALL),
    M('avail',    'Availability',        'ctx', '', 'context', 'pct1', ALL,
      note='Games played as a share of his team\'s games that season. The most undervalued stat in football.'),
    M('snaps',    'Snaps / game',        'ctx', '', 'context', 'num1', ALL, tier=4),
    M('snapshr',  'Snap share',          'ctx', '', 'context', 'pct1', ALL, tier=4,
      note='Share of his unit\'s snaps he was on the field for. Football\'s minutes: the coaching staff\'s vote, and the context for every rate below it.'),
    M('pen',      'Penalties / game',    'ctx', '', 'output',  'num2', ALL, lower=True, den='g', thr=8),

    # ---------------------------------------------------------------- passing
    M('epadb',    'EPA / dropback',      'pass', 'Efficiency', 'output',   'num3', ['QB'], den='db', thr=200,
      note='Expected points added per dropback — sacks and scrambles included, because the dropback is the decision, not just the throw. The closest thing football has to a common currency.'),
    M('cpoe',     'CPOE',                'pass', 'Efficiency', 'expected', 'sgn1', ['QB'], tier=2, den='att', thr=200,
      note='Completion percentage over expected. A model prices every throw by air distance, sideline distance, receiver separation and pressure, then measures what he did with it. Stickier year to year than EPA — the accuracy signal that actually survives into next season.'),
    M('comp',     'EPA + CPOE composite', 'pass', 'Efficiency', 'expected', 'num2', ['QB'], tier=2, den='db', thr=200,
      note='The standard blend: EPA supplies the value, CPOE supplies the part that repeats. Standardized within each season, so a 2004 composite and a 2024 composite mean the same thing.'),
    M('anya',     'ANY/A',               'pass', 'Efficiency', 'output',   'num2', ['QB'], den='att', thr=200,
      note='Adjusted net yards per attempt: (yards + 20·TD − 45·INT − sack yards) ÷ (attempts + sacks). Pre-tracking-era compatible and still one of the hardest correlations to winning football.'),
    M('srdb',     'Success rate',        'pass', 'Efficiency', 'output',   'pct1', ['QB'], den='db', thr=200,
      note='Share of dropbacks that stayed on schedule — 40% of the yards needed on first down, 60% on second, all of it on third and fourth. EPA is how much; this is how often.'),
    M('cmppct',   'Completion %',        'pass', 'Efficiency', 'output',   'pct1', ['QB'], den='att', thr=150),
    M('ypa',      'Yards / attempt',     'pass', 'Efficiency', 'output',   'num2', ['QB'], den='att', thr=150),
    M('rate',     'Passer rating',       'pass', 'Efficiency', 'output',   'num1', ['QB'], den='att', thr=150,
      note='The 1973 formula. Over-weights completions, ignores sacks and everything he does with his legs. Kept as a familiar anchor, never as an argument.'),
    M('qbr',      'Total QBR',           'pass', 'Efficiency', 'output',   'num1', ['QB'], tier=2, den='db', thr=200,
      note='ESPN\'s play-level rating: opponent-adjusted, clutch-weighted, and it splits credit between the quarterback and the people around him.'),
    M('tdpct',    'TD %',                'pass', 'Efficiency', 'output',   'pct1', ['QB'], den='att', thr=250),
    M('intpct',   'INT %',               'pass', 'Efficiency', 'output',   'pct1', ['QB'], den='att', thr=400, lower=True,
      note='Interceptions per attempt. Famously unstable — at one season of volume this is closer to a coin than a skill.'),
    M('twrate',   'Turnover-worthy rate', 'pass', 'Efficiency', 'output',  'pct1', ['QB'], den='db', thr=300, lower=True),
    M('sackpct',  'Sack rate',           'pass', 'Pocket',     'output',   'pct1', ['QB'], den='db', thr=200, lower=True,
      note='More a quarterback stat than an offensive line stat: time to throw drives it.'),
    M('ttt',      'Time to throw',       'pass', 'Pocket',     'ingredient', 'sec', ['QB'], tier=5, den='att', thr=150,
      note='Seconds from snap to release. The master variable behind sack rate, pressure rate and average depth of target.'),
    M('pocket',   'Pocket time',         'pass', 'Pocket',     'ingredient', 'sec', ['QB'], tier=6, den='att', thr=150),
    M('prsspct',  'Pressure rate faced', 'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200, lower=True),
    M('blitzpct', 'Blitz rate faced',    'pass', 'Pocket',     'context',  'pct1', ['QB'], tier=6, den='db', thr=200),
    M('scrrate',  'Scramble rate',       'pass', 'Pocket',     'ingredient', 'pct1', ['QB'], den='db', thr=150),
    M('adot',     'Average depth of target', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=2, den='att', thr=150),
    M('aysticks', 'Air yards to sticks', 'pass', 'Shot selection', 'ingredient', 'num1', ['QB'], tier=5, den='att', thr=150,
      note='Intended depth relative to the first-down marker. Negative means he is throwing short of the sticks on average — the checkdown tell.'),
    M('aggr',     'Aggressiveness',      'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=5, den='att', thr=150,
      note='Share of throws into tight coverage — a defender within a yard of the target at the catch point.'),
    M('deeprate', 'Deep attempt rate',   'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=2, den='att', thr=150),
    M('parate',   'Play-action rate',    'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=6, den='att', thr=150),
    M('rporate',  'RPO rate',            'pass', 'Shot selection', 'ingredient', 'pct1', ['QB'], tier=6, den='att', thr=150),
    M('xcomp',    'Expected completion %', 'pass', 'Accuracy', 'expected', 'pct1', ['QB'], tier=5, den='att', thr=150,
      note='What an average quarterback completes on his exact diet of throws. The difficulty of the menu, before he touches it.'),
    M('ontgt',    'On-target %',         'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=6, den='att', thr=150,
      note='Charted: catchable throws as a share of attempts, throwaways and spikes removed. Completion percentage with the receivers\' hands taken out of it.'),
    M('badthrow', 'Bad throw %',         'pass', 'Accuracy', 'output', 'pct1', ['QB'], tier=6, den='att', thr=150, lower=True),
    M('droppct',  'Drop % (his throws)', 'pass', 'Accuracy', 'context', 'pct1', ['QB'], tier=6, den='att', thr=200, lower=True),
    M('fddb',     'First-down rate',     'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=200),
    M('td3conv',  'Third/fourth-down conversion', 'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=80),
    M('rztd',     'Red-zone TD rate',    'pass', 'Situational', 'output', 'pct1', ['QB'], den='db', thr=60),

    # ---------------------------------------------------------------- rushing
    M('car',      'Carries / game',      'rush', 'Volume', 'context', 'num1', ['RB', 'QB', 'WR', 'TE']),
    M('rushy',    'Rushing yards / game', 'rush', 'Volume', 'output', 'num1', ['RB', 'QB', 'WR'], den='g', thr=8),
    M('epacar',   'EPA / carry',         'rush', 'Efficiency', 'output', 'num3', ['RB', 'QB', 'WR'], den='car', thr=120,
      note='Noisy even at a full season of carries — year-to-year correlation sits around 0.30. Read it next to success rate, never alone.'),
    M('srcar',    'Rush success rate',   'rush', 'Efficiency', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=100,
      note='How often a run stayed on schedule. The half of rushing that breakaway runs cannot fake.'),
    M('ypc',      'Yards / carry',       'rush', 'Efficiency', 'output', 'num2', ['RB', 'QB', 'WR'], den='car', thr=120),
    M('ryoe',     'Rush yards over expected / att', 'rush', 'Efficiency', 'expected', 'num2', ['RB', 'QB'], tier=5, den='car', thr=100,
      note='Tracking prices every carry from where all 22 players were at the handoff. The residual is the runner rather than the blocking — the best public attempt at separating the two.'),
    M('ybc',      'Yards before contact / att', 'rush', 'Contact', 'context', 'num2', ['RB'], tier=6, den='car', thr=100,
      note='This one is mostly the offensive line\'s number, sitting on the runner\'s page for contrast.'),
    M('yacr',     'Yards after contact / att', 'rush', 'Contact', 'output', 'num2', ['RB'], tier=6, den='car', thr=100,
      note='And this one is his. Sticky year to year, and the main driver of a back outrunning his blocking.'),
    M('brkrate',  'Broken tackle rate',  'rush', 'Contact', 'output', 'pct1', ['RB'], tier=6, den='car', thr=100),
    M('stuff',    'Stuffed rate',        'rush', 'Contact', 'output', 'pct1', ['RB', 'QB'], den='car', thr=100, lower=True),
    M('ex10',     '10+ yard run rate',   'rush', 'Explosiveness', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=100),
    M('ex20',     '20+ yard run rate',   'rush', 'Explosiveness', 'output', 'pct1', ['RB', 'QB', 'WR'], den='car', thr=150),
    M('box8',     '8+ in the box',       'rush', 'Context', 'context', 'pct1', ['RB'], tier=5, den='car', thr=80,
      note='Share of his carries against a loaded box. Pure context: heavy boxes mean everything above was earned against more defenders.'),
    M('tlos',     'Time behind the line', 'rush', 'Context', 'ingredient', 'sec', ['RB'], tier=5, den='car', thr=80, lower=True),
    M('fdcar',    'First-down rate',     'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car', thr=100),
    M('rztdcar',  'Red-zone TD rate',    'rush', 'Situational', 'output', 'pct1', ['RB'], den='car', thr=30),
    M('fumrate',  'Fumble rate',         'rush', 'Situational', 'output', 'pct1', ['RB', 'QB'], den='car', thr=250, lower=True),

    # ---------------------------------------------------------------- receiving
    M('tgt',      'Targets / game',      'rec', 'Opportunity', 'context', 'num1', PASSC, tier=3),
    M('recg',     'Receptions / game',   'rec', 'Opportunity', 'context', 'num1', PASSC),
    M('tgtshr',   'Target share',        'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=3, den='g', thr=6),
    M('ayshr',    'Air yards share',     'rec', 'Opportunity', 'context', 'pct1', PASSC, tier=3, den='g', thr=6),
    M('wopr',     'WOPR',                'rec', 'Opportunity', 'context', 'num2', PASSC, tier=3, den='g', thr=6,
      note='Weighted opportunity rating: 1.5 × target share + 0.7 × air-yards share. The best single opportunity number available from open data.'),
    M('tprs',     'Targets / snap',      'rec', 'Opportunity', 'ingredient', 'pct1', PASSC, tier=4, den='snap', thr=200,
      note='The open-data stand-in for targets per route run. Routes run are charted by PFF and are not public, so this uses offensive snaps as the denominator — close in spirit, blunter in practice, because it counts snaps he spent blocking.'),
    M('ypsnap',   'Yards / snap',        'rec', 'Opportunity', 'output', 'num2', PASSC, tier=4, den='snap', thr=200,
      note='The open-data stand-in for yards per route run — the best simple receiver number there is, when you can get routes. Same caveat as above.'),
    M('recy',     'Receiving yards / game', 'rec', 'Efficiency', 'output', 'num1', PASSC, den='g', thr=8),
    M('ypt',      'Yards / target',      'rec', 'Efficiency', 'output', 'num2', PASSC, tier=3, den='tgt', thr=150,
      note='Slow to mean anything: yards per target needs roughly 205 targets — more than two full seasons — before it is half skill and half luck.'),
    M('yprec',    'Yards / reception',   'rec', 'Efficiency', 'output', 'num2', PASSC, den='rec', thr=50),
    M('epatgt',   'EPA / target',        'rec', 'Efficiency', 'output', 'num3', PASSC, tier=3, den='tgt', thr=120),
    M('srtgt',    'Target success rate', 'rec', 'Efficiency', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('catch',    'Catch rate',          'rec', 'Efficiency', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('racr',     'RACR',                'rec', 'Efficiency', 'output', 'num2', PASSC, tier=3, den='tgt', thr=120,
      note='Receiving yards divided by air yards: how much real yardage he turns his intended depth into.'),
    M('rattgt',   'Passer rating when targeted', 'rec', 'Efficiency', 'output', 'num1', PASSC, tier=6, den='tgt', thr=100),
    M('adotr',    'Average depth of target', 'rec', 'Route profile', 'ingredient', 'num1', PASSC, tier=3, den='tgt', thr=80,
      note='The role descriptor that reframes every efficiency number above it. A 4-yard aDOT and a 14-yard aDOT are different jobs, not different talent.'),
    M('deeptgt',  'Deep target rate',    'rec', 'Route profile', 'ingredient', 'pct1', PASSC, tier=3, den='tgt', thr=100),
    M('sep',      'Average separation',  'rec', 'Route profile', 'output', 'num2', PASSC, tier=5, den='tgt', thr=80,
      note='Yards to the nearest defender when the ball arrives. Read it against cushion: getting open from a soft cushion is a different act from getting open from press.'),
    M('cush',     'Average cushion',     'rec', 'Route profile', 'context', 'num2', PASSC, tier=5, den='tgt', thr=80, lower=True),
    M('yacrec',   'YAC / reception',     'rec', 'After the catch', 'output', 'num2', PASSC, tier=2, den='rec', thr=60),
    M('yacoe',    'YAC over expected / rec', 'rec', 'After the catch', 'expected', 'num2', PASSC, tier=5, den='rec', thr=60,
      note='A model reads the field at the catch point and predicts the yards available; the residual is what he did with them.'),
    M('ybcr',     'Yards before catch / rec', 'rec', 'After the catch', 'ingredient', 'num2', PASSC, tier=6, den='rec', thr=60),
    M('brkrec',   'Broken tackle rate',  'rec', 'After the catch', 'output', 'pct1', PASSC, tier=6, den='rec', thr=60),
    M('dropr',    'Drop %',              'rec', 'After the catch', 'output', 'pct1', PASSC, tier=6, den='tgt', thr=120, lower=True,
      note='Charted drops per target. Noisier than the reputation it creates.'),
    M('fdtgt',    'First-down rate',     'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('ex20rec',  '20+ yard catch rate', 'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=120),
    M('tdtgt',    'TD rate / target',    'rec', 'Situational', 'output', 'pct1', PASSC, tier=3, den='tgt', thr=250),
    M('rztgtr',   'Red-zone target rate', 'rec', 'Situational', 'context', 'pct1', PASSC, tier=3, den='tgt', thr=100),

    # ---------------------------------------------------------------- pass rush
    M('prss',     'Pressures / game',    'prsh', 'Pressure', 'output', 'num1', FRONT, tier=6, den='g', thr=8,
      note='Pressures are far more stable and more predictive than sacks. A sack is the tail of the pressure distribution — this is the distribution.'),
    M('prsssnap', 'Pressures / defensive snap', 'prsh', 'Pressure', 'output', 'pct1', FRONT, tier=6, den='dsnap', thr=250,
      note='Per defensive snap, not per pass-rush snap — pass-rush snap counts are charted data and not public. A rusher on a run-heavy defense is understated here.'),
    M('hrry',     'Hurries / game',      'prsh', 'Pressure', 'output', 'num1', FRONT, tier=6, den='g', thr=8),
    M('qbkd',     'QB knockdowns / game', 'prsh', 'Pressure', 'output', 'num2', FRONT, tier=6, den='g', thr=8),
    M('hits',     'QB hits / game',      'prsh', 'Pressure', 'output', 'num2', FRONT, den='g', thr=8),
    M('prod',     'Pass-rush productivity', 'prsh', 'Pressure', 'output', 'num2', FRONT, tier=6, den='dsnap', thr=250,
      note='(sacks + 0.75 × (knockdowns + hurries)) per hundred snaps — the classic weighting that stops sack totals from swallowing everything else.'),
    M('blitz',    'Blitzes / game',      'prsh', 'Pressure', 'context', 'num1', ['LB', 'CB', 'S'], tier=6, den='g', thr=8),
    M('sk',       'Sacks / game',        'prsh', 'Finishing', 'output', 'num2', FRONT, den='g', thr=16,
      note='At one season of volume, sack totals are mostly noise wearing a highlight reel. Pressure rate is the signal underneath.'),
    M('sksnap',   'Sacks / snap',        'prsh', 'Finishing', 'output', 'pct1', FRONT, tier=4, den='dsnap', thr=400),
    M('tfl',      'Tackles for loss / game', 'prsh', 'Finishing', 'output', 'num2', DEF, den='g', thr=12),
    M('tflsnap',  'TFL / snap',          'prsh', 'Finishing', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=300),
    M('bats',     'Batted passes / game', 'prsh', 'Finishing', 'output', 'num2', FRONT, tier=6, den='g', thr=16),
    M('ff',       'Forced fumbles / game', 'prsh', 'Finishing', 'output', 'num2', DEF, den='g', thr=16),

    # ---------------------------------------------------------------- run defense
    M('tkl',      'Tackles / game',      'rdef', 'Volume', 'context', 'num1', DEF,
      note='A role stat before it is a skill stat: it mostly measures snaps and scheme.'),
    M('tklsnap',  'Tackles / snap',      'rdef', 'Volume', 'output', 'pct1', DEF, tier=4, den='dsnap', thr=250),
    M('solopct',  'Solo tackle share',   'rdef', 'Volume', 'ingredient', 'pct1', DEF, den='g', thr=10),
    M('mtklpct',  'Missed tackle %',     'rdef', 'Reliability', 'output', 'pct1', DEF, tier=6, den='dsnap', thr=250, lower=True,
      note='The tackling stat that is actually about the player rather than the play-call.'),

    # ---------------------------------------------------------------- coverage
    M('ctgt',     'Targets defended / game', 'cov', 'Volume', 'context', 'num1', COV, tier=6),
    M('ctgtsnap', 'Targets / defensive snap', 'cov', 'Volume', 'context', 'pct1', COV, tier=6, den='dsnap', thr=250, lower=True,
      note='Read this one first. A shutdown corner\'s reward is not being thrown at, and every rate below it is computed on whatever is left.'),
    M('cmpall',   'Completion % allowed', 'cov', 'Coverage', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('yptall',   'Yards / target allowed', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('ycs',      'Yards allowed / defensive snap', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True,
      note='The key coverage rate — and polluted by drops and off-target throws he had nothing to do with, which is exactly why ball production sits below it. '
           'Note the split between its denominator and its sample: it is measured per snap, but its noise comes from targets. A corner nobody threw at all '
           'season posts a spectacular number off eight throws, so the stabilization bar here is counted in targets, not snaps.'),
    M('ratall',   'Passer rating allowed', 'cov', 'Coverage', 'output', 'num1', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('yacall',   'YAC allowed / completion', 'cov', 'Coverage', 'output', 'num2', COV, tier=6, den='ctgt', thr=50, lower=True),
    M('dadot',    'Depth of target covered', 'cov', 'Assignment', 'context', 'num1', COV, tier=6, den='ctgt', thr=40,
      note='How far downfield he is asked to defend. A slot corner and a boundary corner are not the same job.'),
    M('int',      'Interceptions / game', 'cov', 'Ball production', 'output', 'num2', DEF, den='g', thr=32,
      note='Famously unstable. At NFL volume this is close to a coin flip year to year.'),
    M('pd',       'Passes defended / game', 'cov', 'Ball production', 'output', 'num2', DEF, den='g', thr=16),
    M('ballrate', 'Ball production / target', 'cov', 'Ball production', 'output', 'pct1', COV, tier=6, den='ctgt', thr=50,
      note='Interceptions and breakups as a share of the throws that came his way — the closest open-data cousin of forced incompletion rate.'),

    # ---------------------------------------------------------------- kicking
    M('fgpct',    'Field goal %',        'kick', 'Kicking', 'output', 'pct1', ['K'], den='fga', thr=25),
    M('fgoe',     'FG over expected / att', 'kick', 'Kicking', 'expected', 'num2', ['K'], den='fga', thr=25,
      note='Raw field goal percentage mostly measures where his coach let him kick from. This prices each attempt by distance against that season\'s league make-rate curve and keeps only the residual.'),
    M('fg50',     '50+ yard FG %',       'kick', 'Kicking', 'output', 'pct1', ['K'], den='fga', thr=40),
    M('fglong',   'Longest field goal',  'kick', 'Kicking', 'context', 'num0', ['K']),
    M('fga',      'FG attempts / game',  'kick', 'Kicking', 'context', 'num1', ['K']),
    M('patpct',   'Extra point %',       'kick', 'Kicking', 'output', 'pct1', ['K'], den='g', thr=10),
    M('pgross',   'Gross punt average',  'kick', 'Punting', 'output', 'num1', ['P'], den='punt', thr=40),
    M('pnet',     'Net punt average',    'kick', 'Punting', 'output', 'num1', ['P'], den='punt', thr=40,
      note='Net average paired with inside-20 rate is the most predictive simple pair in punting. Gross average alone rewards outkicking your coverage.'),
    M('pin20',    'Inside-20 rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40),
    M('ptb',      'Touchback rate',      'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40, lower=True),
    M('pretr',    'Return rate allowed', 'kick', 'Punting', 'output', 'pct1', ['P'], den='punt', thr=40, lower=True),
    M('pretyds',  'Return yards allowed / punt', 'kick', 'Punting', 'output', 'num2', ['P'], den='punt', thr=40, lower=True),
    M('punts',    'Punts / game',        'kick', 'Punting', 'context', 'num1', ['P']),

    # ---------------------------------------------------------------- value
    M('epatot',   'Total EPA',           'val', '', 'output', 'num1', SKILL,
      note='The season\'s whole contribution rather than its rate. A rate says how good; this says how much of it there was.'),
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
    M('spdscore', 'Speed score',         'ath', '', 'ingredient', 'num1', ['RB', 'WR', 'TE'],
      note='(weight × 200) ÷ 40-time⁴. Size and speed in one number, because a 4.50 at 235 pounds is not a 4.50 at 190.'),
]

GROUP_LABEL = {
    'ctx': 'Context', 'pass': 'Passing', 'rush': 'Rushing', 'rec': 'Receiving',
    'prsh': 'Pass rush', 'rdef': 'Run defense', 'cov': 'Coverage',
    'kick': 'Kicking & punting', 'val': 'Value', 'ath': 'Athletic profile',
}

# Which panels a cohort shows, in order. Position is the page's organizing principle:
# a corner and a center share no box score, so they should not share a metric table.
POS_PANELS = {
    'QB':  ['ctx', 'pass', 'rush', 'val', 'ath'],
    'RB':  ['ctx', 'rush', 'rec', 'val', 'ath'],
    'WR':  ['ctx', 'rec', 'rush', 'val', 'ath'],
    'TE':  ['ctx', 'rec', 'val', 'ath'],
    'OL':  ['ctx', 'ath'],
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
    'OL': ['snapshr', 'avail', 'pen'],
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
