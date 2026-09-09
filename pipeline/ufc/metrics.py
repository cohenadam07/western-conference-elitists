"""The UFC Savant metric table.

One row per bar the tool can draw, in the same shape as Football Savant's table:

  key    stable id, used by the page and by shareable URLs
  label  what a reader sees
  grp    which panel it lands in
  sub    subheading inside the panel
  layer  ingredient | output | context   (Basketball Savant's taxonomy; MMA has no
         public "expected" models worth shipping, so that layer is absent on purpose)
  unit   how to format the number
  lower  true when a smaller number is better; the page flips the percentile
  since  era gate — the metric is hidden in windows whose fights predate it
  den    which denominator governs its sample size (see DENOMS)
  thr    how much of that denominator before the number stops wobbling
  exp    what it is / why it matters / the formula, in plain language

A fighter has no season. Every metric is computed over a WINDOW of his UFC fights —
career, last five, last three — and ranked against the men (or women) of his weight class
over the same window. Rates are per minute of cage time or per 15 minutes (three rounds),
which is how FightMetric itself reports them, so the numbers here match what a reader has
already seen on ufcstats.com wherever the definitions coincide.

ERAS. ufcstats' feed has two hard edges:
  1994  significant strikes by target and position (UFC 2 onward is essentially complete)
  2000  control time — 0% populated before 1999, 58% in 1999, 100% from 2000
"""

DENOMS = {
    'min': 'minutes of cage time', 'n': 'UFC fights', 'ssa': 'sig. strikes attempted',
    'ss': 'sig. strikes landed', 'oppssa': "opponents' sig. strikes attempted",
    'oppss': "sig. strikes absorbed", 'tda': 'takedown attempts',
    'opptda': "opponents' takedown attempts", 'wins': 'wins', 'losses': 'losses',
    'r1min': 'first-round minutes', 'r3min': 'third-round minutes',
}


def M(key, label, grp, sub, layer, unit, since=1994, den='min', thr=0, lower=False, w='', y='', f=''):
    if not w or not y:
        raise ValueError('every metric needs an explanation: ' + key)
    exp = {'w': w, 'y': y}
    if f:
        exp['f'] = f
    return dict(key=key, label=label, grp=grp, sub=sub, layer=layer, unit=unit,
                since=since, den=den, thr=thr, lower=lower, exp=exp)


METRICS = [
    # ---------------------------------------------------------------- context
    M('n', 'UFC fights', 'ctx', '', 'context', 'num0', den='n',
      w='How many UFC fights fall inside this window.',
      y='Every rate on this page is built out of these fights. Three is where a profile starts to mean something; ten is where it stops moving much.'),
    M('min', 'Cage time', 'ctx', '', 'context', 'mins', den='min',
      w='Total minutes fought in the window.',
      y="A fighter who finishes everyone in ninety seconds has very little cage time, and every per-minute rate of his is built on a thin sample. This is the denominator of the page."),
    M('avgtime', 'Avg fight length', 'ctx', '', 'context', 'mins', den='n', thr=3,
      w='Average length of his fights, in minutes.',
      y="Short fights mean finishes — his or his opponent's. Long fights mean decisions. The number tells you what kind of night he usually has."),
    M('act', 'Fights per year', 'ctx', '', 'context', 'num1', den='n', thr=2,
      w='UFC fights per calendar year, from his first fight in the window to his last.',
      y='Activity is a skill too. Long layoffs come with ring rust and lost prime years.',
      f='fights ÷ years spanned (at least one year)'),
    M('winpct', 'Win rate', 'ctx', '', 'output', 'pct0', den='n', thr=5,
      w='Share of his UFC fights in the window that he won.',
      y='The record is the thing everyone starts from. Everything below is an attempt to explain it.',
      f='wins ÷ (wins + losses)'),
    M('elo', 'Savant rating', 'ctx', '', 'output', 'num0', den='n', thr=3,
      w='An Elo rating, computed across every UFC fight in order, read at the end of the window. 1500 is a debutant; finishes move it more than decisions.',
      y='A record says how often he won. A rating says who he beat. Beating a 1700 is worth far more than beating a 1400, and the rating knows the difference when the record does not.',
      f='K = 32, ×1.25 for a finish, expected score from the rating gap'),
    M('sos', 'Opponent rating', 'ctx', '', 'context', 'num0', den='n', thr=3,
      w="The average Elo rating of the opponents he faced in the window, as they were on fight night.",
      y='Strength of schedule. Two fighters with identical striking numbers have not done the same thing if one did it against contenders and the other against debutants.'),

    # ---------------------------------------------------------------- striking
    M('slpm', 'Sig. strikes landed / min', 'strike', 'Output', 'output', 'num2', den='min', thr=30,
      w='Significant strikes he lands per minute of cage time. "Significant" is every strike at distance, plus power strikes in the clinch and on the ground.',
      y='Volume. The single most-watched striking number in the sport, and the one the judges see most clearly.',
      f='sig. strikes landed ÷ minutes'),
    M('sapm', 'Sig. strikes absorbed / min', 'strike', 'Output', 'output', 'num2', den='min', thr=30, lower=True,
      w='Significant strikes his opponents land on him per minute.',
      y='The other half of every striking exchange. A high number is a fighter who gets hit — through poor defense, or because his style invites the trade.',
      f="opponents' sig. strikes landed ÷ minutes"),
    M('diff', 'Strike differential / min', 'strike', 'Output', 'output', 'sgn2', den='min', thr=30,
      w='Significant strikes landed minus significant strikes absorbed, per minute.',
      y='The number analysts reach for first. A positive differential wins rounds; a large one wins fights. It rolls output and defense into one reading.',
      f='(landed − absorbed) ÷ minutes'),
    M('pace', 'Pace', 'strike', 'Output', 'context', 'num2', den='min', thr=30,
      w='Significant strikes landed by both men combined, per minute.',
      y='What kind of fight he is in. Some fighters drag every opponent into a brawl; some make every fight a chess match. Neither is better, but it tells you how to read his other numbers.',
      f='(landed + absorbed) ÷ minutes'),
    M('sacc', 'Sig. strike accuracy', 'strike', 'Precision', 'ingredient', 'pct0', den='ssa', thr=150,
      w='Share of his significant strike attempts that landed.',
      y='Precision. High-accuracy fighters pick shots; low-accuracy fighters throw volume and accept the misses. Read it next to pace.',
      f='sig. strikes landed ÷ attempted'),
    M('sdef', 'Sig. strike defense', 'strike', 'Precision', 'ingredient', 'pct0', den='oppssa', thr=150,
      w="Share of opponents' significant strike attempts that did not land.",
      y='Head movement, footwork, range. The best defensive strikers make the other man miss six of every ten.',
      f="1 − opponents' landed ÷ attempted"),
    M('kd15', 'Knockdowns / 15 min', 'strike', 'Power', 'output', 'num2', den='min', thr=30,
      w='Knockdowns scored per fifteen minutes — the length of a three-round fight.',
      y='Power, and the ability to land it. Knockdowns end fights and swing rounds; they are also the most weight-class-dependent number on the page, which is why the ranking is within his division.',
      f='knockdowns ÷ minutes × 15'),
    M('kd100', 'Knockdowns / 100 landed', 'strike', 'Power', 'ingredient', 'num2', den='ss', thr=200,
      w='Knockdowns per hundred significant strikes landed.',
      y='Power per punch, separated from volume. A fighter who lands little but drops people has a very different weapon from one who lands a lot and drops people.',
      f='knockdowns ÷ sig. strikes landed × 100'),
    M('kdabs15', 'Knockdowns absorbed / 15', 'strike', 'Power', 'output', 'num2', den='min', thr=30, lower=True,
      w='Times he was knocked down, per fifteen minutes.',
      y='Chin, and defense against the big shot. Fighters who get dropped often get finished eventually.',
      f='knockdowns against ÷ minutes × 15'),
    M('headshr', 'Head share', 'strike', 'Targets', 'ingredient', 'pct0', den='ss', thr=100,
      w='Share of his landed significant strikes that went to the head.',
      y='Around four in five UFC strikes go to the head, so this is mostly a stylistic signature: a low head share is a body-and-leg fighter.',
      f='head strikes landed ÷ sig. strikes landed'),
    M('bodyshr', 'Body share', 'strike', 'Targets', 'ingredient', 'pct0', den='ss', thr=100,
      w='Share of his landed significant strikes that went to the body.',
      y='Body work is slow-acting and under-scored, which is why fighters who invest in it tend to be the ones who finish late.'),
    M('legshr', 'Leg share', 'strike', 'Targets', 'ingredient', 'pct0', den='ss', thr=100,
      w='Share of his landed significant strikes that went to the legs.',
      y='Leg kicks compound. A high share here is a fighter who wins the second half of fights by taking the other man\'s base away in the first.'),
    M('distshr', 'At distance', 'strike', 'Position', 'ingredient', 'pct0', den='ss', thr=100,
      w='Share of his landed significant strikes thrown at distance — on the feet, out of the clinch.',
      y='Where he does his work. A pure striker lives here; a wrestler lands most of his on the ground.'),
    M('clinchshr', 'In the clinch', 'strike', 'Position', 'ingredient', 'pct0', den='ss', thr=100,
      w='Share of his landed significant strikes thrown in the clinch.',
      y='Knees, elbows, dirty boxing. The clinch is where strength and cage craft show up in the striking numbers.'),
    M('groundshr', 'On the ground', 'strike', 'Position', 'ingredient', 'pct0', den='ss', thr=100,
      w='Share of his landed significant strikes thrown on the ground.',
      y='Ground and pound. Read it with control time — a fighter who gets on top and stays there lands most of his best shots from there.'),

    # ---------------------------------------------------------------- grappling
    M('td15', 'Takedowns / 15 min', 'grap', 'Wrestling', 'output', 'num2', den='min', thr=30,
      w='Takedowns landed per fifteen minutes.',
      y='Whether he can put the fight where he wants it. The average UFC fighter lands about one and a half per fifteen; a wrestler lands four or five.',
      f='takedowns ÷ minutes × 15'),
    M('tdacc', 'Takedown accuracy', 'grap', 'Wrestling', 'ingredient', 'pct0', den='tda', thr=15,
      w='Share of his takedown attempts that succeeded.',
      y='The league average sits under forty percent. A fighter who shoots and fails is spending energy and eating knees for nothing.',
      f='takedowns landed ÷ attempted'),
    M('tddef', 'Takedown defense', 'grap', 'Wrestling', 'ingredient', 'pct0', den='opptda', thr=15,
      w="Share of opponents' takedown attempts that he stuffed.",
      y="For a striker this is the most important grappling number there is: it decides whether he gets to fight his fight. For a wrestler it decides whether he can fight from the top rather than the bottom.",
      f="1 − opponents' takedowns landed ÷ attempted"),
    M('ctrl15', 'Control time / 15 min', 'grap', 'Control', 'output', 'mins', since=2000, den='min', thr=30,
      w='Minutes of ground or clinch control per fifteen minutes fought. Control is time spent in a dominant position — on top, or pressing the opponent against the fence.',
      y='Judges reward control, and it is the surest way to win a round without landing a big shot. Not tracked before 2000, so fighters from the early era have no bar here.',
      f='control seconds ÷ minutes × 15'),
    M('ctrldiff', 'Control differential / 15', 'grap', 'Control', 'output', 'sgnm', since=2000, den='min', thr=30, lower=False,
      w='His control time minus his opponents\' control time, per fifteen minutes.',
      y='Who was on top. A fighter with a lot of control time who also gets controlled a lot is in a grappling war; a positive differential is a fighter who dictates position.',
      f="(control − opponents' control) ÷ minutes × 15"),
    M('ctrlabs15', 'Controlled / 15 min', 'grap', 'Control', 'output', 'mins', since=2000, den='min', thr=30, lower=True,
      w='Minutes his opponents spent controlling him, per fifteen.',
      y='Time spent on your back is time not spent winning. This is the grappling equivalent of strikes absorbed.'),
    M('sub15', 'Submission attempts / 15', 'grap', 'Submissions', 'output', 'num2', den='min', thr=30,
      w='Submission attempts per fifteen minutes.',
      y='How often he hunts for a finish on the ground. Attempts, not finishes — a fighter who threatens keeps the other man honest even when nothing lands.',
      f='submission attempts ÷ minutes × 15'),
    M('rev15', 'Reversals / 15', 'grap', 'Submissions', 'output', 'num2', den='min', thr=30,
      w='Times he reversed position — got off his back and onto top — per fifteen minutes.',
      y='Scrambling. The fighters who can\'t be held down make wrestlers\' control time worthless.'),

    # ---------------------------------------------------------------- finishing & durability
    M('finrate', 'Finish rate', 'fin', 'Finishing', 'output', 'pct0', den='wins', thr=4,
      w='Share of his wins that came by knockout or submission rather than the judges.',
      y='Finishers get title shots and bonuses. A high finish rate is a fighter who does not leave it to three people at cageside.',
      f='(KO wins + sub wins) ÷ wins'),
    M('kowin', 'KO wins per fight', 'fin', 'Finishing', 'output', 'pct0', den='n', thr=5,
      w='Share of his fights that ended with him winning by knockout or TKO.',
      y='The most direct measure of fight-ending power there is.',
      f='KO/TKO wins ÷ fights'),
    M('subwin', 'Sub wins per fight', 'fin', 'Finishing', 'output', 'pct0', den='n', thr=5,
      w='Share of his fights that ended with him winning by submission.',
      y='Jiu-jitsu that closes. Attempts are in the grappling panel; this is the ones that worked.',
      f='submission wins ÷ fights'),
    M('r1fin', 'R1 finishes per fight', 'fin', 'Finishing', 'output', 'pct0', den='n', thr=5,
      w='Share of his fights that he finished inside the first round.',
      y='Fast starters. Also a fighter whose whole game may be built for five minutes — read it with the round curve below.',
      f='first-round finishes ÷ fights'),
    M('finloss', 'Finished-loss rate', 'fin', 'Durability', 'output', 'pct0', den='n', thr=5, lower=True,
      w='Share of his fights that he lost by knockout or submission.',
      y='Getting finished is the loss that follows a fighter. A high number is a fighter who, when he loses, loses badly.',
      f='(KO losses + sub losses) ÷ fights'),
    M('koloss100', 'KO losses / 100 absorbed', 'fin', 'Durability', 'ingredient', 'num2', den='oppss', thr=200, lower=True,
      w='Times he was knocked out or stopped by strikes, per hundred significant strikes absorbed.',
      y='Chin, adjusted for how much he gets hit. A fighter who absorbs a lot and never goes out is durable; one who goes out early and often is not, whatever his defense says.',
      f='KO/TKO losses ÷ sig. strikes absorbed × 100'),
    M('decrate', 'Goes to decision', 'fin', 'Durability', 'context', 'pct0', den='n', thr=5,
      w='Share of his fights that went to the judges.',
      y='Context, not skill. A fighter who never sees the scorecards fights very differently from one who lives there.'),

    # ---------------------------------------------------------------- rounds
    M('r1out', 'Round 1 output / min', 'rounds', 'By round', 'output', 'num2', den='r1min', thr=15,
      w='Significant strikes landed per minute in first rounds.',
      y='How he starts. Read against his later rounds, not against other fighters\' first rounds.'),
    M('r2out', 'Round 2 output / min', 'rounds', 'By round', 'output', 'num2', den='min', thr=30,
      w='Significant strikes landed per minute in second rounds.',
      y='The middle of the fight, where conditioning starts to tell.'),
    M('r3out', 'Round 3 output / min', 'rounds', 'By round', 'output', 'num2', den='r3min', thr=15,
      w='Significant strikes landed per minute in third rounds.',
      y='How he closes. Championship rounds are excluded so five-round fighters are not compared on a different footing.'),
    M('fade', 'Late-fight index', 'rounds', 'By round', 'ingredient', 'num2', den='r3min', thr=15,
      w='His third-round output per minute divided by his first-round output per minute. Above 1 is a fighter who gets stronger; below 1 is a fighter who fades.',
      y='Cardio and pacing in one number. Some of the best finishers in the sport are below 1 here — they front-load on purpose — so read it with his finish rate.',
      f='R3 sig. strikes/min ÷ R1 sig. strikes/min'),
    M('r3abs', 'Round 3 absorbed / min', 'rounds', 'By round', 'output', 'num2', den='r3min', thr=15, lower=True,
      w='Significant strikes absorbed per minute in third rounds.',
      y='Whether the other man is still landing on him late. Tired fighters get hit.'),

    # ---------------------------------------------------------------- belts (leaderboard only —
    # the 'belt' group is not in PANELS, so these never draw as bars on a profile)
    M('beltdays', 'Days as champion', 'belt', '', 'output', 'num0', den='n',
      w='Total days he has held a UFC title (undisputed reigns; interim belts not counted), across his career.',
      y='The belt is the point. Reigns are reconstructed from the title-fight record: a reign starts when he wins the belt and ends when he loses it, or when the next title fight in the division happens without him (vacated or stripped).',
      f='sum of reign lengths in days'),
    M('defenses', 'Title defenses', 'belt', '', 'output', 'num0', den='n',
      w='Successful undisputed title defenses across his career.',
      y='Winning a belt is one night; keeping it is a résumé.'),
]

# Which panels each cohort shows, in story order. Every division shows every panel — a
# heavyweight and a strawweight share the same box score, which is the one way this is
# simpler than football.
PANELS = ['ctx', 'strike', 'grap', 'fin', 'rounds']

GROUP_LABEL = {
    'ctx': 'Context', 'strike': 'Striking', 'grap': 'Grappling',
    'fin': 'Finishing & durability', 'rounds': 'Round by round',
}

# The comp vector: what "fights like him" means. Style first, results second.
HEADLINE = ['slpm', 'sapm', 'sacc', 'sdef', 'kd15', 'td15', 'tdacc', 'tddef', 'ctrl15',
            'sub15', 'distshr', 'groundshr', 'legshr', 'finrate', 'fade']
# The weakness vector: where he can be beaten.
WEAK_DIMS = ['sdef', 'tddef', 'sapm', 'kdabs15', 'ctrlabs15', 'koloss100', 'fade', 'sacc', 'tdacc']

# Qualifying line for the percentile pool, per window: (fights, minutes)
QUALIFY = {'career': (3, 15), 'l5': (3, 15), 'l3': (3, 15)}

DIVISIONS = [
    # key, label, ufcstats weight-class text (lowercased, matched as substring), sex
    ('FLW', 'Flyweight', 'flyweight', 'M'),
    ('BW', 'Bantamweight', 'bantamweight', 'M'),
    ('FW', 'Featherweight', 'featherweight', 'M'),
    ('LW', 'Lightweight', 'lightweight', 'M'),
    ('WW', 'Welterweight', 'welterweight', 'M'),
    ('MW', 'Middleweight', 'middleweight', 'M'),
    ('LHW', 'Light Heavyweight', 'light heavyweight', 'M'),
    ('HW', 'Heavyweight', 'heavyweight', 'M'),
    ('WSW', "Women's Strawweight", "women's strawweight", 'F'),
    ('WFLW', "Women's Flyweight", "women's flyweight", 'F'),
    ('WBW', "Women's Bantamweight", "women's bantamweight", 'F'),
    ('WFW', "Women's Featherweight", "women's featherweight", 'F'),
    ('OPEN', 'Open weight', 'open weight', 'M'),
]
DIV_LABEL = {k: v for k, v, _, _ in DIVISIONS}
DIV_SEX = {k: s for k, _, _, s in DIVISIONS}


def division_of(wc):
    """ufcstats weight-class text -> division key. Order matters: 'Women's Flyweight' must
    beat 'Flyweight', 'Light Heavyweight' must beat 'Heavyweight'."""
    t = (wc or '').lower()
    if not t:
        return None
    if "women" in t:
        for k, _, pat, s in DIVISIONS:
            if s == 'F' and pat in t:
                return k
        return None
    if 'light heavyweight' in t:
        return 'LHW'
    if 'super heavyweight' in t:
        return 'HW'
    for k, _, pat, s in DIVISIONS:
        if s == 'M' and pat in t:
            return k
    if 'catch' in t or 'open' in t or 'superfight' in t or 'tournament' in t:
        return 'OPEN'
    return None
