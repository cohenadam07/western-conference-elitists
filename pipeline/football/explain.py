# -*- coding: utf-8 -*-
"""Plain-language explanations for every metric.

Three fields each, and the rule for all of them is that a ten-year-old should follow it:
  w  what the number is
  y  why it matters
  f  the formula, where one exists

The page shows all three when a reader clicks a stat name. Keeping them here rather than
inline in metrics.py keeps the metric table readable and makes the prose easy to review
as prose."""

EXPLAIN = {}


def _e(k, w, y, f=None):
    EXPLAIN[k] = dict(w=w, y=y, f=f)


# ---------------------------------------------------------------- context
_e('g', "How many games he played this season.",
     "You can't help your team from the sideline. Everything else on this page is built out of these games.")
_e('avail', "The share of his team's games he was available for.",
     "Staying healthy is a skill. A very good player who misses half the year helps his team less than a good one who never misses.",
     "games played ÷ team's games")
_e('snaps', "The average number of plays he was on the field for, per game.",
     "This is his playing time. A star plays almost every snap; a backup plays a handful.",
     "total plays on the field ÷ games")
_e('snapshr', "Out of all the plays his side of the ball ran, the share he was out there for.",
     "This is the coaches voting with their feet. They put their best players on the field, so a high number means they trust him.",
     "his plays ÷ his unit's plays")
_e('pen', "Penalties he was flagged for, per game.",
     "Penalties hand the other team free yards. Fewer is better.",
     "penalties ÷ games")

# ---------------------------------------------------------------- passing
_e('epadb', "How many points he adds for his team on an average dropback.",
     "This is the best single number for a quarterback. It counts everything a dropback can turn into — a completion, a sack, a scramble — and asks whether the team ended up better or worse off.",
     "total expected points added ÷ dropbacks")
_e('cpoe', "How much more often he completes passes than an average QB would, throwing the same throws.",
     "A short dump-off is easy and a deep ball into coverage is hard, so raw completion percentage isn't fair. This fixes that by grading each throw on its own difficulty. It's also one of the few QB numbers that stays true from one year to the next.",
     "his completion % − expected completion %")
_e('comp', "His EPA and his CPOE mixed into one score.",
     "EPA says how much he helped; CPOE says how accurate he was. Putting them together gives the most complete one-number answer, and it's built so a 2004 season and a 2024 season mean the same thing.",
     "average of the two, measured in standard deviations from that season's average")
_e('anya', "Yards per pass, after rewarding touchdowns and punishing interceptions and sacks.",
     "It's the old-school yards-per-attempt stat with the good and bad stuff priced in. Simple, and it lines up closely with winning.",
     "(yards + 20×TD − 45×INT − sack yards) ÷ (attempts + sacks)")
_e('srdb', "How often his dropbacks keep the offense on schedule.",
     "EPA tells you how much he gains; this tells you how often. A QB can look great on EPA off three long touchdowns while most of his plays go nowhere — this catches that.",
     "successful plays ÷ dropbacks. Success = 40% of the needed yards on 1st down, 60% on 2nd, all of it on 3rd or 4th")
_e('cmppct', "The share of his passes that are caught.",
     "The most familiar passing stat. Just remember it rewards throwing short — CPOE above is the fairer version.",
     "completions ÷ attempts")
_e('ypa', "Average yards gained per pass attempt.", "Rewards throwing downfield and completing it.",
     "passing yards ÷ attempts")
_e('rate', "The old NFL passer rating, from 1973.",
     "Everybody knows it, so it's here as a familiar landmark. But it over-rewards short completions and completely ignores sacks and running, so don't win an argument with it.",
     "a 0–158.3 scale built from completion %, yards, touchdowns and interceptions")
_e('qbr', "ESPN's 0–100 quarterback score.",
     "It adjusts for who he played, weights the big moments more, and tries to split credit between the QB and his teammates. A different lens than EPA, which is why it's here.")
_e('tdpct', "The share of his passes that go for touchdowns.", "Scoring is the point of the whole exercise.",
     "passing touchdowns ÷ attempts")
_e('intpct', "The share of his passes that get picked off.",
     "Turnovers lose games. But be careful: interceptions bounce around a lot year to year, so one season of this is closer to a coin flip than a skill.",
     "interceptions ÷ attempts")
_e('twrate', "How often a dropback ends in a turnover he caused.",
     "Counts interceptions and his own lost fumbles together, since both hand the ball over.",
     "(interceptions + lost fumbles) ÷ dropbacks")
_e('sackpct', "How often he gets sacked on a dropback.",
     "People blame the offensive line, but this is mostly the quarterback: holding the ball too long is what turns pressure into a sack.",
     "sacks ÷ dropbacks")
_e('ttt', "The average time from the snap until he throws, in seconds.",
     "The hidden dial behind a lot of his other numbers. Get rid of it fast and you take fewer sacks but throw shorter; hold it and the opposite.",
     "measured by tracking chips in the ball and on the players")
_e('pocket', "The average time he has before the pocket breaks down.",
     "Time to throw is his choice; this is closer to what his blockers gave him.")
_e('prsspct', "The share of his dropbacks where a defender got in his face.",
     "Pressure is the single biggest thing that wrecks a passing play. This is mostly about his line and how long he holds it, so treat it as background, not as his fault.",
     "pressured dropbacks ÷ dropbacks")
_e('blitzpct', "How often defenses send extra rushers at him.",
     "Defenses blitz quarterbacks they think they can rattle, and back off the ones who punish it.",
     "blitzes faced ÷ dropbacks")
_e('scrrate', "How often he takes off running instead of throwing.",
     "Scrambling turns a dead play into a live one. It's a real part of the modern job.",
     "scrambles ÷ dropbacks")
_e('adot', "How far downfield the ball travels in the air on an average throw.",
     "This describes his job, not his quality. A 6-yard average and a 12-yard average are two different offenses, and every efficiency number above reads differently depending on which one he's in.",
     "total air yards ÷ attempts")
_e('aysticks', "How far past the first-down marker he's aiming, on average.",
     "A negative number means he's usually throwing short of the sticks and asking the receiver to make up the difference. That's the checkdown tell.",
     "average air yards − average yards needed for a first down")
_e('aggr', "The share of his throws he squeezes into tight coverage.",
     "Some quarterbacks only throw when a man is open; others trust their arm. Neither is wrong, but it tells you what kind of player he is.",
     "throws with a defender within 1 yard of the target ÷ attempts")
_e('deeprate', "The share of his throws that go deep.",
     "Taking shots stretches a defense. Doing it well is what makes them respect it.",
     "throws travelling 20+ yards in the air ÷ attempts")
_e('parate', "How often he throws off play-action — faking a handoff first.",
     "The fake freezes linebackers for a split second and opens up throws behind them. It works nearly everywhere, and some teams still barely use it.",
     "play-action attempts ÷ attempts")
_e('rporate', "How often he runs a run-pass option, deciding after the snap.",
     "A modern trick that makes one defender wrong no matter what he does.",
     "RPO attempts ÷ attempts")
_e('xcomp', "The completion percentage an average QB would post on his exact throws.",
     "It's the difficulty of his menu before he touches it. Compare it to his real completion percentage to see whether he beat it.")
_e('ontgt', "The share of his throws that were actually catchable.",
     "Completion percentage punishes a QB when his receiver drops it. This doesn't — it's accuracy with the receivers' hands taken out of it.",
     "catchable throws ÷ attempts, with throwaways and spikes removed")
_e('badthrow', "The share of his throws that were nowhere near catchable.",
     "The other half of the accuracy picture. Fewer is better.",
     "bad throws ÷ attempts")
_e('droppct', "The share of his catchable passes his receivers dropped.",
     "Not his fault — it's here so you know when his completion percentage is being dragged down by other people.",
     "drops ÷ attempts")
_e('fddb', "How often a dropback picks up a first down.",
     "First downs keep drives alive. This is moving-the-chains, boiled down.",
     "passing first downs ÷ dropbacks")
_e('td3conv', "How often he converts on third or fourth down.",
     "These are the plays the whole drive hangs on, and defenses know a pass is coming.",
     "third/fourth downs converted ÷ third/fourth-down dropbacks")
_e('rztd', "How often a dropback inside the opponent's 20 ends in a touchdown.",
     "The field gets short and tight near the end zone, so throwing windows shrink. Points, not yards, decide games.",
     "red-zone passing touchdowns ÷ red-zone dropbacks")

# ---------------------------------------------------------------- rushing
_e('car', "How many times he runs the ball per game.", "His workload. Volume isn't skill, but it's the base everything else sits on.",
     "carries ÷ games")
_e('rushy', "Rushing yards per game.", "The headline running number everybody quotes.", "rushing yards ÷ games")
_e('epacar', "Points added for his team on an average carry.",
     "Careful with this one — running plays are so dependent on blocking that this number jumps around a lot from year to year. Always read it beside success rate.",
     "total expected points added ÷ carries")
_e('srcar', "How often his runs keep the offense on schedule.",
     "The half of running that a couple of long touchdowns can't fake. A back with great yards-per-carry but a poor success rate is boom-or-bust.",
     "successful runs ÷ carries")
_e('ypc', "Average yards per carry.", "The classic. It's easily skewed by one 70-yard run, so check success rate too.",
     "rushing yards ÷ carries")
_e('ryoe', "Yards he gains beyond what an average back would, on the same runs.",
     "Cameras track where all 22 players are at the handoff, so a computer can guess how many yards were 'there'. What's left over is the runner and not his blockers. It's the best attempt at separating the two.",
     "actual yards − expected yards, per carry")
_e('ybc', "Yards he gains before anybody touches him.",
     "This is mostly his offensive line's number, sitting here for contrast with the one below it.",
     "yards before contact ÷ carries")
_e('yacr', "Yards he gains after somebody hits him.",
     "This one really is his. It's balance, power and effort, and it stays consistent year after year — which makes it one of the most trustworthy running-back stats there is.",
     "yards after contact ÷ carries")
_e('brkrate', "How often he makes a defender miss or breaks a tackle.",
     "Creating something out of nothing. Like yards after contact, it's a genuine, repeatable skill.",
     "broken tackles ÷ carries")
_e('stuff', "How often he's stopped for no gain or a loss.",
     "Second-and-10 puts an offense behind schedule. Fewer of these is better.",
     "runs of 0 yards or fewer ÷ carries")
_e('ex10', "How often a carry goes for 10+ yards.", "Chunk runs flip a drive in one play.", "runs of 10+ yards ÷ carries")
_e('ex20', "How often a carry goes for 20+ yards.", "Home-run speed. Rare, and worth a lot when it shows up.",
     "runs of 20+ yards ÷ carries")
_e('box8', "How often he runs into a stacked defensive front.",
     "Pure context, not skill. If defenses load up against him, every yard he gets is earned against more bodies.",
     "carries against 8+ defenders in the box ÷ carries")
_e('tlos', "How long he takes to reach the line of scrimmage.",
     "Decisiveness. Dancing in the backfield usually means the hole is already closed.",
     "average seconds from handoff to crossing the line")
_e('fdcar', "How often a carry picks up a first down.", "Moving the chains on the ground.",
     "rushing first downs ÷ carries")
_e('rztdcar', "How often a carry inside the 20 ends in a touchdown.",
     "Short-yardage scoring is a real, separate skill from running in open space.",
     "red-zone rushing touchdowns ÷ red-zone carries")
_e('fumrate', "How often he puts the ball on the ground.",
     "One fumble can decide a game. Like interceptions, though, it bounces around a lot season to season.",
     "fumbles ÷ carries")

# ---------------------------------------------------------------- receiving
_e('tgt', "How many passes are thrown his way per game.",
     "Opportunity. You can't catch what isn't thrown to you, and targets are the most valuable thing a receiver can have.",
     "targets ÷ games")
_e('recg', "Catches per game.", "The simplest measure of how involved he is.", "receptions ÷ games")
_e('tgtshr', "Out of every pass his team throws, the share that goes to him.",
     "This is how much the offense runs through him. A number above 25% means he's the main guy.",
     "his targets ÷ team's targets")
_e('ayshr', "His share of all the yards his team throws into the air.",
     "Target share counts throws; this weights them by how far downfield they go. A deep threat can own the air yards without owning the targets.",
     "his air yards ÷ team's air yards")
_e('wopr', "Target share and air-yards share rolled into one opportunity score.",
     "The best single number for 'how big a role does this offense give him', and it predicts fantasy scoring better than either half alone.",
     "1.5 × target share + 0.7 × air-yards share")
_e('tprs', "How often he's targeted, per snap he's on the field.",
     "The gold-standard version of this uses routes run instead of snaps, but nobody publishes routes. Snaps are the honest stand-in — blunter, because they include snaps he spent blocking.",
     "targets ÷ offensive snaps")
_e('ypsnap', "Receiving yards per snap he's on the field.",
     "The stand-in for yards per route run, which is the best simple receiver stat there is when you can get it. Same idea: judge him by his time on the field, not by how often the QB happened to look his way.",
     "receiving yards ÷ offensive snaps")
_e('recy', "Receiving yards per game.", "The headline number everybody quotes.", "receiving yards ÷ games")
_e('ypt', "Average yards gained each time he's thrown to.",
     "A good efficiency number, but slow to mean anything — it takes about 205 targets, more than two full seasons, before it's half skill and half luck.",
     "receiving yards ÷ targets")
_e('yprec', "Average yards per catch.", "Tells you whether he's a short-area chain-mover or a big-play threat.",
     "receiving yards ÷ receptions")
_e('epatgt', "Points added for his team each time he's targeted.",
     "Counts the incompletions too, so it's a fuller picture than yards per catch.",
     "total expected points added ÷ targets")
_e('srtgt', "How often a pass to him keeps the offense on schedule.",
     "The 'how often' to go with EPA's 'how much'.",
     "successful targets ÷ targets")
_e('catch', "The share of passes thrown to him that he catches.",
     "Reads low for deep threats and high for checkdown targets, so always read it next to his average depth of target below.",
     "receptions ÷ targets")
_e('racr', "How much real yardage he turns his intended air yards into.",
     "Above 1.0 means he's gaining more than the ball travelled — he's making things happen after the catch.",
     "receiving yards ÷ air yards")
_e('rattgt', "The passer rating a quarterback gets when throwing to him.",
     "A neat way to ask: does he make his QB look good?")
_e('adotr', "How far downfield he's targeted on average.",
     "This is his job description, and it reframes everything above it. A 4-yard average and a 14-yard average are different roles, not different talent levels.",
     "total air yards ÷ targets")
_e('deeptgt', "The share of his targets that are deep shots.",
     "Tells you if he's the guy they take chances with.",
     "targets travelling 20+ yards in the air ÷ targets")
_e('sep', "How many yards of daylight he has from the nearest defender when the ball arrives.",
     "Getting open is the whole job. Read it next to cushion below — getting open against a defender playing tight is much harder than against one playing off.",
     "measured by tracking chips, averaged over his targets")
_e('cush', "How far off him the defender lines up before the snap.",
     "Respect, measured in yards. Defenders back off the guys who scare them, which makes separation easier to get — that's why a low cushion here is the harder assignment.",
     "distance to the nearest defender at the snap")
_e('yacrec', "Yards he gains after catching it.", "Turning a short pass into a long gain.",
     "yards after catch ÷ receptions")
_e('yacoe', "Yards after the catch beyond what an average receiver would get.",
     "A computer looks at where all the defenders are at the moment he catches it and predicts the yards that were available. What he gets on top of that is him.",
     "actual yards after catch − expected, per reception")
_e('ybcr', "How far downfield he is when he catches it.", "Separates the deep-ball guys from the screen-and-slant guys.",
     "yards before catch ÷ receptions")
_e('brkrec', "How often he breaks a tackle after catching the ball.", "Extra yards nobody blocked for.",
     "broken tackles ÷ receptions")
_e('dropr', "The share of catchable passes he drops.",
     "Real, but noisier than reputations suggest — one bad afternoon can follow a receiver around for years.",
     "drops ÷ targets")
_e('fdtgt', "How often a target to him picks up a first down.", "Moving the chains is worth more than empty yards.",
     "first downs ÷ targets")
_e('ex20rec', "How often a target to him goes for 20+ yards.", "Big-play ability.",
     "catches of 20+ yards ÷ targets")
_e('tdtgt', "How often a target to him ends in a touchdown.", "Scoring. Bounces around a lot in one season.",
     "receiving touchdowns ÷ targets")
_e('rztgtr', "The share of his targets that come inside the opponent's 20.",
     "Whether the offense trusts him where it counts most.",
     "red-zone targets ÷ targets")

# ---------------------------------------------------------------- blocking
_e('pblkg', "Pass-blocking snaps per game.", "How much of his job is protecting the quarterback.",
     "dropback snaps on the field ÷ games")
_e('rblkg', "Run-blocking snaps per game.", "The other half of his job.",
     "run snaps on the field ÷ games")
_e('starts', "Games he started.",
     "Nobody publishes an official start for linemen, so this counts any game where he played at least half his unit's snaps. Being the guy they line up every week is most of the value.",
     "games with 50%+ of his unit's offensive snaps")
_e('posver', "How many different spots on the line he played this season.",
     "A lineman who can play tackle and guard saves his team a roster spot and covers an injury. Versatility is genuinely valuable, and it's one of the few lineman traits you can actually see in the data.")
_e('fsg', "False starts per game.",
     "Jumping early costs five yards and it's entirely on him — one of only two stats on this card that nobody else can take credit or blame for.",
     "false starts ÷ games")
_e('holdg', "Holding penalties per game.",
     "Usually a sign he got beaten and had to grab. The other stat here that's purely his.",
     "offensive holding ÷ games")
_e('prsallow', "How often the quarterback got pressured while he was on the field.",
     "Careful — this is the whole line's number, not his. All five linemen are out there together, so two teammates who never come off the field will have exactly the same figure. The on/off rows further down are the only ones that try to separate them.",
     "pressured dropbacks ÷ his pass-blocking snaps")
_e('sackallow', "How often the quarterback got sacked while he was on the field.",
     "Same warning as above: the unit's number, not his alone.",
     "sacks ÷ his pass-blocking snaps")
_e('epadbon', "Points the offense added per dropback while he was blocking.",
     "The broadest measure of whether the passing game worked with him out there.",
     "expected points added ÷ his pass-blocking snaps")
_e('srdbon', "How often dropbacks stayed on schedule while he was blocking.", "The 'how often' version of the row above.",
     "successful dropbacks ÷ his pass-blocking snaps")
_e('rushfaced', "How many defenders rushed the passer on his snaps, on average.",
     "Context for the pressure numbers above. Holding up against five or six rushers is a much harder night than holding up against four.",
     "total pass rushers ÷ his pass-blocking snaps")
_e('ypcon', "Yards the team gained per carry while he was blocking.", "Whether the running game worked with him in there.",
     "rushing yards ÷ his run-blocking snaps")
_e('srrunon', "How often runs stayed on schedule while he was blocking.", "The steadier half of the running picture.",
     "successful runs ÷ his run-blocking snaps")
_e('stuffon', "How often runs were stopped for nothing while he was blocking.",
     "Getting stuffed puts an offense behind schedule. Fewer is better.",
     "runs of 0 yards or fewer ÷ his run-blocking snaps")
_e('boxfaced', "How many defenders were in the box on his run snaps.",
     "Context again: more defenders near the line means harder blocking.",
     "total defenders in the box ÷ his run-blocking snaps")
_e('prsoo', "Pressure rate with him blocking, minus pressure rate without him.",
     "This is the one number here that really tries to separate him from the four men beside him. Negative is good — it means the pocket held up better when he played. It's blank for players who never left the field, because there's nothing to compare against.",
     "his on-field pressure rate − his team's pressure rate without him")
_e('epaoo', "Points per dropback with him blocking, minus without him.",
     "Same idea, using the broadest measure of passing success. Positive is good.",
     "his on-field EPA per dropback − his team's without him")
_e('sroo', "Run success rate with him blocking, minus without him.",
     "The running-game version. Positive is good.",
     "his on-field run success rate − his team's without him")

# ---------------------------------------------------------------- pass rush
_e('prss', "How often he pressures the quarterback, per game.",
     "Pressure is the thing that actually wrecks a passing play, and it happens far more often than a sack does. It's also much steadier year to year, which makes it the better way to judge a rusher.",
     "hurries + knockdowns + sacks, ÷ games")
_e('prsssnap', "How often he pressures the quarterback, per snap he plays.",
     "The per-game version rewards guys who simply play more. This one is fairer. Note it uses all his defensive snaps, because nobody publishes how many were pass-rush snaps — so a rusher on a run-heavy defence is understated.",
     "pressures ÷ defensive snaps")
_e('hrry', "Hurries per game — times he made the QB move or throw early without hitting him.",
     "The quietest kind of pressure, and it still ruins the play.",
     "hurries ÷ games")
_e('qbkd', "Knockdowns per game — times he put the QB on the ground after the throw.",
     "Not a sack, but the hit still counts. It wears a quarterback down over four quarters.",
     "knockdowns ÷ games")
_e('hits', "QB hits per game.", "The physical toll he puts on a passer.", "quarterback hits ÷ games")
_e('prod', "A single pass-rush score that weights sacks above hits and hurries.",
     "Sack totals get all the attention but they're mostly noise in one season. This keeps the sack as the biggest prize while giving credit for all the pressure underneath it.",
     "(sacks + 0.75 × (knockdowns + hurries)) ÷ defensive snaps × 100")
_e('blitz', "How often he's sent after the quarterback, per game.",
     "For a linebacker or defensive back this describes his role — is he a coverage player or is he coming?",
     "blitzes ÷ games")
_e('sk', "Sacks per game.",
     "The famous one. But be honest with it: at one season's volume, sack totals are mostly luck sitting on top of pressure. The pressure rows above are the real signal.",
     "sacks ÷ games")
_e('sksnap', "Sacks per snap he plays.", "The playing-time-adjusted version.", "sacks ÷ defensive snaps")
_e('tfl', "Tackles behind the line of scrimmage, per game.", "A play that loses yards is a drive-killer.",
     "tackles for loss ÷ games")
_e('tflsnap', "Tackles for loss per snap he plays.", "Fairer than the per-game version.",
     "tackles for loss ÷ defensive snaps")
_e('bats', "Passes he knocked down at the line, per game.",
     "Small, real, and very satisfying — a tall lineman getting his hands up turns a completion into nothing.",
     "batted passes ÷ games")
_e('ff', "Forced fumbles per game.", "Taking the ball away is the single most valuable thing a defender can do.",
     "forced fumbles ÷ games")

# ---------------------------------------------------------------- run defence
_e('tkl', "Tackles per game.",
     "Read this as a job description, not a skill. Tackle counts mostly measure how many snaps he plays and where his team lines him up — a linebacker will always out-tackle a great cornerback.",
     "solo + assisted tackles ÷ games")
_e('tklsnap', "Tackles per snap he plays.", "Adjusts for playing time, which makes it a bit fairer than the raw count.",
     "tackles ÷ defensive snaps")
_e('solopct', "The share of his tackles he makes on his own.", "A rough read on whether he finishes plays himself.",
     "solo tackles ÷ total tackles")
_e('mtklpct', "How often he misses when he tries to make a tackle.",
     "This is the tackling stat that's really about him rather than about scheme. Fewer is better.",
     "missed tackles ÷ (tackles + missed tackles)")

# ---------------------------------------------------------------- coverage
_e('ctgt', "How often quarterbacks throw at the man he's covering, per game.",
     "Read this one first. A shutdown corner's reward is that nobody tests him, and every rate below it is calculated on whatever throws are left.",
     "targets ÷ games")
_e('ctgtsnap', "How often he's thrown at, per snap he plays.",
     "The fairest version of 'do quarterbacks avoid him'. A long bar here means they do.",
     "targets ÷ defensive snaps")
_e('cmpall', "The share of passes thrown at him that get caught.",
     "The most direct measure of coverage. Lower is better.",
     "completions allowed ÷ targets")
_e('yptall', "Yards he gives up each time he's thrown at.", "Counts the incompletions too, so it's fuller than yards allowed.",
     "yards allowed ÷ targets")
_e('ycs', "Yards he gives up per snap he plays.",
     "The key coverage rate, because it folds in both how often he's thrown at and how much he gives up. It does get polluted by drops and bad throws he had nothing to do with — which is exactly why ball production sits below it. One oddity worth knowing: it's measured per snap, but its wobble comes from targets, so the settling bar underneath it is counted in targets rather than snaps.",
     "yards allowed ÷ defensive snaps")
_e('ratall', "The passer rating quarterbacks get when throwing at him.",
     "A familiar summary of how well the offence does when it picks on him. Lower is better.")
_e('yacall', "Yards the receiver gains after catching it on him.", "Coverage is only finished when somebody makes the tackle.",
     "yards after catch allowed ÷ completions allowed")
_e('dadot', "How far downfield he's asked to defend, on average.",
     "Job description again. A slot corner living in the flat and a boundary corner running deep are doing different things, and it changes how you read everything above.",
     "average air yards of the throws aimed at him")
_e('int', "Interceptions per game.",
     "The biggest play a defensive back can make. Also wildly unpredictable — one season of interceptions is close to a coin flip.",
     "interceptions ÷ games")
_e('pd', "Passes defended per game.", "Breakups plus interceptions. Steadier than picks alone, so trust it more.",
     "passes defended ÷ games")
_e('ballrate', "How often he makes a play on the ball when thrown at.",
     "Combines breakups and interceptions against how often he's targeted. It's the closest open-data cousin of 'forced incompletions' — incompletions he actually caused rather than got lucky on.",
     "(interceptions + breakups) ÷ targets")

# ---------------------------------------------------------------- kicking
_e('fgpct', "The share of field goals he makes.",
     "The famous one, and a bit unfair: it mostly measures how far out his coach lets him try from.",
     "field goals made ÷ attempts")
_e('fgoe', "Kicks made above what an average kicker would make from the same distances.",
     "This fixes the problem above. Every attempt is priced by its distance against that season's league-wide make rate, and only the difference is credited to him.",
     "actual makes − expected makes, ÷ attempts")
_e('fg50', "The share of his 50-yard-plus attempts he makes.", "Long-range ability, which changes what an offence can do on fourth down.",
     "50+ yard makes ÷ 50+ yard attempts")
_e('fglong', "His longest made field goal this season.", "Leg strength, in one number.")
_e('fga', "Field goal attempts per game.", "How often his team asks him to kick. More about the offence than about him.",
     "attempts ÷ games")
_e('patpct', "The share of extra points he makes.", "They moved these back to 33 yards in 2015, so they're no longer automatic.",
     "extra points made ÷ attempts")
_e('pgross', "Average distance of his punts.", "Raw leg power — but see net average below, which is the one that counts.",
     "punt yards ÷ punts")
_e('pnet', "Average punt distance after the return is subtracted.",
     "The one that actually matters. Booming a punt 60 yards is worthless if it comes back 30. Net average together with inside-20 rate is the best simple pair in punting.",
     "(punt yards − return yards − touchback yardage) ÷ punts")
_e('pin20', "The share of his punts downed inside the opponent's 20.", "Pinning a team deep is the whole job.",
     "punts inside the 20 ÷ punts")
_e('ptb', "The share of his punts that sail into the end zone for a touchback.",
     "A wasted punt — the ball comes out to the 20 and all that distance is thrown away.",
     "touchbacks ÷ punts")
_e('pretr', "How often his punts get returned at all.", "A punt nobody can return is a punt that did its job.",
     "returned punts ÷ punts")
_e('pretyds', "Return yards he gives up per punt.", "Partly his hang time, partly his coverage team.",
     "return yards allowed ÷ punts")
_e('punts', "Punts per game.", "Says more about how bad his offence is than about him.", "punts ÷ games")

# ---------------------------------------------------------------- value
_e('epatot', "Total points he added across the whole season.",
     "Every other rate on this page says how good; this says how much of it there was. A great player who plays sixteen games beats a great player who plays six.",
     "sum of expected points added on all his plays")
_e('fppg', "Fantasy points per game, PPR scoring.", "The number most people actually feel, week to week.",
     "PPR fantasy points ÷ games")
_e('toucheg', "Carries plus catches per game.", "How often the ball ends up in his hands.",
     "(carries + receptions) ÷ games")

# ---------------------------------------------------------------- athletic
_e('ht', "His height, without shoes, measured at the combine.",
     "Matters differently everywhere: it's near-essential for a tackle and almost irrelevant for a running back.")
_e('wt', "His weight at the combine.", "Size for holding up at the line, or for absorbing hits.")
_e('forty', "His 40-yard dash time.", "The famous speed test. Remember this was measured once, years before the season you're looking at.")
_e('vert', "How high he jumped from a standstill.", "Explosive lower-body power, and useful for going up to get a ball.")
_e('broad', "How far he jumped forward from a standstill.", "The other explosion test, measuring power pushing forward instead of up.")
_e('cone', "His three-cone drill time.", "Changing direction sharply. It matters most for receivers and pass rushers who live on sudden movement.")
_e('shuttle', "His 20-yard shuttle time.", "Short, sharp side-to-side quickness.")
_e('bench', "How many times he benched 225 pounds.", "Upper-body strength, which matters most in the trenches.")
_e('spdscore', "Speed and size combined into one number.",
     "A 4.50 forty at 235 pounds is far more impressive than the same time at 190. This prices that in.",
     "(weight × 200) ÷ 40-time⁴")

