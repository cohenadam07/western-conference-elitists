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
     "play-action dropbacks ÷ dropbacks. Two charting crews sit behind this line: "
     "Pro-Football-Reference from 2018 to 2021, FTN from 2022 on. PFR stopped publishing "
     "play-action after 2023, which is why the handover happened.")
_e('rporate', "How often he runs a run-pass option, deciding after the snap.",
     "A modern trick that makes one defender wrong no matter what he does.",
     "RPO dropbacks ÷ dropbacks. Read the jump at 2022 carefully: "
     "Pro-Football-Reference charted this through 2021 and FTN charts it from 2022, and "
     "the two do not mean the same thing by the word. PFR counts roughly four times as "
     "many RPOs as FTN does, so a quarterback whose rate falls off a cliff in 2022 did "
     "not change — the definition did.")
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
_e('tgtshr', "Out of every pass his team throws in the games he plays, the share that goes to him.",
     "This is how much the offense runs through him. A number above 25% means he's the main guy. Games he missed are left out, so an injury does not shrink it.",
     "his targets ÷ team's targets in the games he played")
_e('ayshr', "His share of all the yards his team throws into the air.",
     "Target share counts throws; this weights them by how far downfield they go. A deep threat can own the air yards without owning the targets.",
     "his air yards ÷ team's air yards in the games he played")
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



# ---------------------------------------------------------------- FTN charting (2022+)
# Pro-Football-Reference publishes a season at a time, months after it ends. FTN charts
# every play within days of it being played, so these are the rows that stay alive in
# September. What FTN does not chart - pressure, hurries, a defender's name - is not
# invented here.
_e('rushfaceq', "How many pass rushers come at him on an average dropback.",
     "Four is the standard rush. A quarterback who sees more than that is being attacked; one who sees fewer is being respected, with everyone else dropping into coverage.",
     "pass rushers ÷ dropbacks where rushers were counted")
_e('oop', "How often he ends up throwing or running from outside the pocket.",
     "Some of this is pressure chasing him out, and some of it is a quarterback who would rather be moving. Either way it changes what the offense can ask for.",
     "out-of-pocket dropbacks ÷ dropbacks")
_e('faultsack', "Of the sacks he took, the share charters judged to be his own doing.",
     "A sack is usually blamed on the line. Sometimes it should be blamed on the man holding the ball for four and a half seconds. This separates the two.",
     "his-fault sacks ÷ sacks")
_e('screen', "How often he throws a screen.",
     "A screen is a called completion. A passing line propped up by them looks better than the arm behind it.",
     "screen attempts ÷ attempts")
_e('motion', "How often somebody is moving before the snap on his dropbacks.",
     "This is his coordinator, not him. Motion tells a quarterback whether the defense is in man or zone before the ball is snapped, so an offense that never uses it is making his reads harder.",
     "dropbacks with pre-snap motion ÷ dropbacks")
_e('nohuddle', "How often his offense skips the huddle.",
     "Tempo. It tires a defense and stops it substituting, and it puts the game in the quarterback's hands at the line.",
     "no-huddle dropbacks ÷ dropbacks")
_e('firstread', "How often he throws to the first man he looks at.",
     "Not good or bad on its own. A scheme can be built to make the first read right; a quarterback who never gets past it against a defense that knows this is a different story.",
     "first-read throws ÷ throws where the read was charted")
_e('checkdown', "How often he gives up on the play downfield and takes the safe short one.",
     "The checkdown is the right answer more often than fans think, and the wrong one when it becomes a habit.",
     "checkdowns ÷ throws where the read was charted")
_e('catchable', "The share of his throws a receiver could actually have caught.",
     "Completion percentage blames him for drops. This does not: it is accuracy with the receivers' hands taken out of it.",
     "catchable balls ÷ attempts")
_e('throwaway', "How often he throws it away on purpose.",
     "A throwaway is a small win disguised as an incompletion - it beats a sack and it beats a turnover. It also drags his completion percentage down.",
     "throwaways ÷ attempts")
_e('iwrate', "How often he makes a throw that deserved to be intercepted.",
     "Interceptions are half luck: dropped by the safety, tipped to a linebacker. This counts the decision rather than the outcome, so it tells you sooner whether he is playing with fire.",
     "interception-worthy throws ÷ attempts")
_e('boxcar', "How many defenders are in the box on his average carry.",
     "Context, not skill. Seven men in the box is a hard afternoon; six is a light one. It is the fairest way to ask whether his yards were there to be taken.",
     "defenders in the box ÷ carries where the box was counted")
_e('created', "How often a target becomes a catch he had to invent.",
     "A reception charted as created is one the throw did not give him - he adjusted, or beat a man to it, or caught it somewhere it had no business being caught.",
     "created receptions ÷ targets")
_e('ctchtgt', "The share of balls thrown his way that were catchable.",
     "This is about his quarterback, not him. A receiver with a low number is being asked to catch passes nobody could.",
     "catchable targets ÷ targets")
_e('ctchhand', "Of the catchable balls thrown to him, how many he caught.",
     "Catch rate, with the bad throws taken out. This is as close as public data gets to grading a pair of hands.",
     "catches on catchable balls ÷ catchable targets")
_e('contest', "How often he is targeted with a defender right on him.",
     "A measure of the job he is given. Number one receivers draw coverage; slot men and backs are often thrown to in space.",
     "contested targets ÷ targets")
_e('contestw', "How often he wins the ball when a defender is right there.",
     "The 50-50 ball. Size, timing and nerve, in one number.",
     "contested catches ÷ contested targets")


# Blitz rate and the two drop rates are charted by Pro-Football-Reference from 2018 and
# by FTN from 2022. The two crews agree closely (r = .90 to .95, with matching league
# averages), which is why one row carries both rather than splitting in two.


# =====================================================================================
# The October 2026 additions. Same rule as everything above: a ten-year-old should follow
# it, and where a number is an estimate or only exists for finished seasons, the
# explanation says so in plain words, because this is the text a reader actually opens.
# =====================================================================================

# ---------------------------------------------------------------- context
_e('offsideg', "How often he is flagged for jumping before the snap: offside, encroachment or lining up in the neutral zone.",
     "A pass rusher who guesses the snap count gets a head start, and sometimes a flag. A few of these are the price of getting off the ball fast; a lot of them are free yards for the offense.",
     "offside, encroachment and neutral-zone flags ÷ games")
_e('rtpg', "How often he is flagged for roughing the passer.",
     "Fifteen yards and a first down, usually on a play his defense had already won. It is the most expensive flag a pass rusher can draw.",
     "roughing-the-passer flags ÷ games")
_e('stshr', "Out of all his team's special-teams plays, the share he was on the field for.",
     "Kickoffs, punts and field goals. For a backup this is often the reason he has a job, and a starter who still plays them is doing extra work.",
     "his special-teams snaps ÷ his team's special-teams snaps in the games he played")
_e('sttk', "Tackles he makes covering kickoffs and punts, per game.",
     "The play nobody watches. A good coverage man quietly takes yards off every drive the other team starts.",
     "tackles on kickoffs and punts ÷ games")
_e('soso', "How good the offenses he has faced are, on average.",
     "A defender who has played four bad offenses will look better than one who has played four great ones. This is the schedule he has had, so you can read his other numbers with that in mind. A higher number means a harder schedule.",
     "each opponent's EPA per play in all its other games, averaged over the games he played")

# ---------------------------------------------------------------- passing
_e('p2s', "When a defender gets to him, how often it ends in a sack.",
     "Pressure is mostly the line's fault. Turning pressure into a sack is mostly the quarterback's: the ones who feel it and get the ball out, or slide away, keep this number low. Lower is better.",
     "sacks ÷ times pressured")
_e('hurrypct', "How often he is rushed into throwing sooner than he wanted.",
     "A hurry is pressure that did not reach him but still changed the play. It is the gentlest kind of pressure and the most common.",
     "times hurried ÷ dropbacks")
_e('hitpct', "How often he is knocked down as he throws or just after.",
     "Hits add up over a season. This is a measure of how much punishment he is taking, whoever is to blame for it.",
     "times hit while throwing ÷ dropbacks")
_e('ucrate', "How often he takes the snap from under center instead of standing back in the shotgun.",
     "It is a description of the offense, not a grade. Under center sets up play-action and the run game; shotgun gives him a clearer view of the defense.",
     "dropbacks from under center ÷ charted dropbacks")
_e('cayatt', "How far downfield his completed passes travel in the air, per attempt.",
     "Yards per attempt gives him credit for what his receivers do after the catch. This counts only the part the throw did.",
     "(passing yards − yards after the catch) ÷ attempts")
_e('yacshr', "The share of his passing yards that came after the catch.",
     "A high number means his receivers are doing a lot of the work, or the offense is built on short throws to fast people. It is not a fault, but it tells you whose yards they are.",
     "yards after the catch ÷ passing yards")
_e('manrate', "How often defenses play man-to-man coverage against him.",
     "Defenses play man against quarterbacks they think cannot beat it. Only known once a season is over, because the file that records it is published after the Super Bowl.",
     "dropbacks against man coverage ÷ dropbacks where the coverage was recorded")
_e('intluck', "His interceptions compared with the throws that deserved to be intercepted.",
     "Above zero means he has been picked off more than his throws earned: tipped balls, receivers falling down. Below zero means defenders have dropped some he gave them, and the bill may still be coming.",
     "interception % − interception-worthy throw %")
_e('cmpb', "His completion percentage on throws behind the line of scrimmage.",
     "Screens and swing passes. These are supposed to be completed almost every time.",
     "completions ÷ attempts, throws behind the line")
_e('cmps', "His completion percentage on short throws, up to 9 yards downfield.",
     "The bread and butter of every offense. Most of a quarterback's throws live here.",
     "completions ÷ attempts, throws of 0 to 9 air yards")
_e('cmpm', "His completion percentage on throws 10 to 19 yards downfield.",
     "The intermediate area is where the tight windows are. Coaches will tell you this is where you find out who can really play the position.",
     "completions ÷ attempts, throws of 10 to 19 air yards")
_e('cmpd', "His completion percentage on deep throws, 20 yards or more in the air.",
     "Deep balls are low-percentage for everyone, and there are not many of them, so this one bounces around a lot.",
     "completions ÷ attempts, throws of 20 or more air yards")
_e('ypab', "Yards per attempt on throws behind the line of scrimmage.",
     "All of this is his receivers running after the catch, and his blockers getting out in front of them.",
     "yards ÷ attempts, throws behind the line")
_e('ypas', "Yards per attempt on short throws, up to 9 yards downfield.",
     "Short throws only pay off if the ball arrives on time and in stride.",
     "yards ÷ attempts, throws of 0 to 9 air yards")
_e('ypam', "Yards per attempt on throws 10 to 19 yards downfield.",
     "The most valuable part of the field to be good at, because these throws move the chains and still get completed.",
     "yards ÷ attempts, throws of 10 to 19 air yards")
_e('ypad', "Yards per attempt on deep throws, 20 yards or more in the air.",
     "This is the home-run swing. It counts the misses too, so a quarterback who throws deep often but connects rarely does not look good here.",
     "yards ÷ attempts, throws of 20 or more air yards")
_e('airdist', "How far the ball actually flies on his average throw, measured from his hand to the catch point.",
     "Depth of target only counts yards downfield. This counts the real distance, so a throw from one hash to the far sideline gets the credit it deserves.",
     "measured by the tracking chip in the ball")
_e('maxair', "The longest any of his completions has flown through the air this season.",
     "A fun one. It is the ceiling of his arm, at least on a throw somebody caught.",
     "measured by the tracking chip in the ball")
_e('ngscpoe', "CPOE again, but worked out from player tracking instead of from the play-by-play.",
     "The tracking version knows how close the nearest defender was and how fast everyone was moving, so it grades each throw's difficulty more carefully. It is here beside the other one so you can see when they disagree.",
     "his completion % − the completion % tracking expected")
_e('epapa', "How many points he adds per dropback when the play starts with a fake handoff.",
     "Play-action is the easiest way to make a passing play work, so almost everybody is better with it. The question is how much better.",
     "EPA on play-action dropbacks ÷ play-action dropbacks")
_e('epablz', "How many points he adds per dropback when the defense sends extra rushers.",
     "A blitz leaves fewer defenders in coverage. Good quarterbacks make defenses pay for it; shaky ones get sacked.",
     "EPA on blitzed dropbacks ÷ blitzed dropbacks")
_e('epauc', "How many points he adds per dropback when he starts under center.",
     "Some quarterbacks are much more comfortable in the shotgun. This shows whether he can do both.",
     "EPA on under-center dropbacks ÷ under-center dropbacks")
_e('epaman', "How many points he adds per dropback against man-to-man coverage.",
     "Beating man coverage takes accuracy and a receiver who can win. Only known once a season is over.",
     "EPA ÷ dropbacks, against man coverage")
_e('epazone', "How many points he adds per dropback against zone coverage.",
     "Beating zone is about reading the defense and being patient. Only known once a season is over.",
     "EPA ÷ dropbacks, against zone coverage")
_e('epadbng', "His EPA per dropback counting only the plays when the game was still up for grabs.",
     "Numbers piled up while losing by 24 in the fourth quarter are easy to come by. This throws those out and keeps the plays where neither team was better than nine in ten to win.",
     "EPA ÷ dropbacks, with win probability between 10% and 90%")
_e('ppd', "How many points his offense scores on an average drive he leads.",
     "This is the scoreboard version of everything else. It includes his running backs and his line, so it is a team number with his name on it.",
     "points scored on his drives ÷ his drives. Drives that only ran out the clock are left out")
_e('tddrv', "How often a drive he leads ends in a touchdown.",
     "Field goals keep you in games. Touchdowns win them.",
     "touchdown drives ÷ his drives")
_e('to3', "How often a drive he leads goes three plays and a punt.",
     "The worst kind of drive: no points, no field position, and his defense is straight back on the field. Lower is better.",
     "three-and-out drives ÷ his drives")
_e('sosp', "How good the pass defenses he has faced are.",
     "A quarterback who has played four bad defenses will look better than he is. Lower means tougher defenses. Before about week 4 there is not enough to go on, so this stays blank.",
     "each opponent's EPA per dropback allowed in all its other games, averaged over his dropbacks")
_e('epadbadj', "His EPA per dropback, moved up or down for how tough his opponents were.",
     "If he has faced hard defenses his number goes up a little; if he has faced soft ones it comes down. It is a simple correction, not a perfect one.",
     "EPA per dropback − (how much his opponents usually allow − the league average)")

# ---------------------------------------------------------------- rushing
_e('desrun', "Runs that were called for him, per game. Scrambles are not counted.",
     "A designed run is the coach's choice; a scramble is the quarterback's. They are different plays and this keeps them apart.",
     "designed runs ÷ games")
_e('carshr', "Out of all his team's carries in the games he played, the share that were his.",
     "This is how much of the running game belongs to him. A workhorse is above 60 percent; a committee back is near 40.",
     "his carries ÷ his team's carries in his games")
_e('i10shr', "Out of his team's carries inside the opponent's 10-yard line, the share that were his.",
     "This is where rushing touchdowns come from. A back can lose this job to a bigger teammate and keep everything else.",
     "his carries inside the 10 ÷ his team's carries inside the 10")
_e('i5shr', "Out of his team's carries inside the opponent's 5-yard line, the share that were his.",
     "The goal-line job. Nothing predicts rushing touchdowns better.",
     "his carries inside the 5 ÷ his team's carries inside the 5")
_e('ropct', "How often he gains more than the blocking gave him.",
     "Rush yards over expected can be propped up by two long runs. This asks how often he beats the expectation, which is steadier.",
     "runs that beat the expected yards ÷ runs, from player tracking")
_e('rueff', "How far he actually runs for each yard he gains.",
     "A back who goes straight ahead is near 3. A back who dances sideways is above 4. Lower is more north-and-south.",
     "total distance run ÷ yards gained, from player tracking")
_e('desepa', "The points his called runs add per game: sneaks, read options, draws.",
     "A quarterback's legs show up twice. Scrambles are dropbacks, so they are already inside EPA per dropback. This is the other half, the runs the play-caller drew up for him, with kneel-downs and fumbled snaps left out.",
     "EPA on his designed runs ÷ games")
_e('ypcdes', "Yards per carry on runs that were called for him.",
     "Scrambles make every quarterback's yards per carry look huge. This is the number without them.",
     "yards on designed runs ÷ designed runs")
_e('ypcscr', "Yards per scramble.",
     "When the pass play breaks down and he takes off, this is what he gets.",
     "scramble yards ÷ scrambles")
_e('epascr', "How many points he adds each time he scrambles.",
     "A scramble that turns third-and-8 into a first down is worth a lot more than its yards. This counts that.",
     "EPA on scrambles ÷ scrambles")
_e('ypclt', "Yards per carry when the defense has six or fewer defenders near the line.",
     "A light box is an invitation to run. This is how well he accepts it.",
     "yards ÷ carries, with 6 or fewer in the box")
_e('ypcst', "Yards per carry when the defense crowds eight or more defenders near the line.",
     "Everybody knows the run is coming. Yards here are the hardest a back earns.",
     "yards ÷ carries, with 8 or more in the box")
_e('sosr', "How good the run defenses he has faced are.",
     "Lower means tougher defenses. Before about week 4 there is not enough to go on, so this stays blank.",
     "each opponent's EPA per carry allowed in all its other games, averaged over his carries")
_e('epacaradj', "His EPA per carry, moved up or down for how tough his opponents were.",
     "A simple correction for schedule: hard run defenses push it up, soft ones pull it down.",
     "EPA per carry − (how much his opponents usually allow − the league average)")
_e('outrate', "How often his carries go outside, around the tackle or the end.",
     "A description of how he is used. Some backs are sent between the guards all day; others are sent to the edge.",
     "carries off tackle or around end ÷ carries with a recorded direction")
_e('ypcin', "Yards per carry on runs up the middle or behind a guard.",
     "Inside running is about vision and power, and it leans heavily on the three men in the middle of the line.",
     "yards ÷ inside carries")
_e('srin', "How often his inside runs keep the offense on schedule.",
     "The steady version of the number above.",
     "successful inside carries ÷ inside carries")
_e('ypcout', "Yards per carry on runs off tackle or around the end.",
     "Outside running is about speed and getting the corner. It is more boom-or-bust than running inside.",
     "yards ÷ outside carries")
_e('srout', "How often his outside runs keep the offense on schedule.",
     "The steady version of the number above.",
     "successful outside carries ÷ outside carries")
_e('syconv', "On third or fourth down with two yards or less to go, how often he gets it.",
     "Everybody in the stadium knows what is coming. Getting it anyway is its own skill.",
     "first downs or touchdowns ÷ carries on 3rd or 4th and 2 or less")
_e('snkconv', "How often his quarterback sneaks get the first down.",
     "The most reliable play in football when it is done well.",
     "successful sneaks ÷ sneaks")

# ---------------------------------------------------------------- receiving
_e('tpps', "How often he is thrown to, out of the pass plays he was on the field for.",
     "Targets per snap punishes a receiver whose team runs a lot. This only counts the plays where he could have been thrown to. It is the closest free number to targets per route run. Until a season's play-by-play lineups are published, after the Super Bowl, the pass-play count is an estimate.",
     "targets ÷ pass plays he was on the field for")
_e('ypps', "Receiving yards for every pass play he was on the field for.",
     "The best single efficiency number for a receiver that free data can give. It is the closest thing to yards per route run. Until a season's play-by-play lineups are published, after the Super Bowl, the pass-play count is an estimate.",
     "receiving yards ÷ pass plays he was on the field for")
_e('frshr', "When his quarterback throws to the first man he looks at, how often that man is him.",
     "The first read is who the play was drawn up for. This is the truest measure of who the offense is built around.",
     "his first-read targets ÷ his team's first-read targets in his games")
_e('ydshr', "Out of his team's receiving yards in the games he played, the share that were his.",
     "Target share says how often they look his way. This says how much of the production is his.",
     "his receiving yards ÷ his team's receiving yards in his games")
_e('tdshr', "Out of his team's receiving touchdowns in the games he played, the share that were his.",
     "Touchdowns are few, so this jumps around. Over a full season it shows who they trust near the goal line.",
     "his receiving touchdowns ÷ his team's receiving touchdowns in his games")
_e('fdshr', "Out of his team's first downs through the air in the games he played, the share that were his.",
     "The chain-mover. Some receivers get their yards in big chunks; this finds the ones who keep drives alive.",
     "his receiving first downs ÷ his team's receiving first downs in his games")
_e('ezshr', "Out of his team's throws into the end zone, the share that went to him.",
     "End-zone targets are where receiving touchdowns come from, and they are steadier than the touchdowns themselves.",
     "his end-zone targets ÷ his team's end-zone targets in his games")
_e('eztgt', "Throws into the end zone aimed at him, per game.",
     "The raw count behind the share above.",
     "end-zone targets ÷ games")
_e('tgt1st', "Of the balls thrown to him, how many came when he was the quarterback's first look.",
     "A high number means the plays are being called for him. A low one means he is getting the ball after something else was covered.",
     "first-read targets ÷ charted targets")
_e('tgtdes', "Of the balls thrown to him, how many came on a play designed to get him the ball right away.",
     "Screens, quick flips and shovel passes. These are touches the coach handed him, not ones he won.",
     "designed targets ÷ charted targets")
_e('tgtchk', "Of the balls thrown to him, how many were checkdowns: the safe short throw after nothing else was open.",
     "For a running back this is most of the job. It is why his yards per target is not comparable with a wide receiver's.",
     "checkdown targets ÷ charted targets")
_e('tgtscr', "Of the balls thrown to him, how many were screens.",
     "Screen yards belong to the blockers as much as to him.",
     "screen targets ÷ charted targets")
_e('yptman', "Yards per target when the defense is in man-to-man coverage.",
     "One defender, one receiver. This is where a receiver wins on his own. Only known once a season is over.",
     "receiving yards ÷ targets, against man coverage")
_e('yptzone', "Yards per target when the defense is in zone coverage.",
     "Against zone a receiver has to find the soft spot and sit in it. Only known once a season is over.",
     "receiving yards ÷ targets, against zone coverage")
_e('yptb', "Yards per target on balls thrown to him behind the line of scrimmage.",
     "Every yard here is one he made himself after the catch.",
     "yards ÷ targets behind the line")
_e('ypts', "Yards per target on short throws, up to 9 yards downfield.",
     "Where slot receivers, tight ends and running backs make their living.",
     "yards ÷ targets of 0 to 9 air yards")
_e('yptm', "Yards per target on throws 10 to 19 yards downfield.",
     "The intermediate game: digs, outs and crossers. Winning here takes real route running.",
     "yards ÷ targets of 10 to 19 air yards")
_e('yptd', "Yards per target on deep throws, 20 yards or more in the air.",
     "There are not many of these in a season, so the number swings. It still tells you whether the deep ball to him is working.",
     "yards ÷ targets of 20 or more air yards")
_e('catchs', "His catch rate on short throws, up to 9 yards downfield.",
     "These should be caught most of the time.",
     "catches ÷ targets of 0 to 9 air yards")
_e('catchm', "His catch rate on throws 10 to 19 yards downfield.",
     "Tighter windows and bigger hits. A good number here is worth more than the same number on short throws.",
     "catches ÷ targets of 10 to 19 air yards")
_e('catchd', "His catch rate on deep throws, 20 yards or more in the air.",
     "Low for everyone. The league catches about one in three.",
     "catches ÷ targets of 20 or more air yards")
_e('xyacoe', "Yards after the catch compared with what an average player gets from the same catch, worked out from the play-by-play.",
     "The tracking version of this stat only covers players with a lot of targets. This one covers everybody. The two do not agree exactly, so they are kept as two rows and never mixed.",
     "(his yards after catch − expected yards after catch) ÷ catches")
_e('croe', "How much more often he catches the ball than an average receiver would, given the same throws.",
     "A receiver who runs deep routes will always have a lower catch rate than one who catches screens. This grades each target on how hard it was, the same way CPOE does for quarterbacks.",
     "his catch % − the catch % expected from the throws he saw")
_e('td3tgt', "Targets on third and fourth down, per game.",
     "The money downs. This is who the quarterback looks for when the drive is on the line.",
     "targets on 3rd and 4th down ÷ games")
_e('td3cv', "When he is thrown to on third or fourth down, how often the offense gets the first down.",
     "Catching it is not enough; he has to catch it past the marker.",
     "first downs ÷ targets on 3rd and 4th down")
_e('dpig', "Pass-interference flags he draws on defenders, per game.",
     "A receiver who is too fast or too strong to cover fairly gets grabbed. Those yards never show up in his stats, so they are counted here.",
     "defensive pass-interference flags drawn ÷ games")
_e('dpiyds', "Yards his team gains from the pass-interference flags he draws, per game.",
     "Deep threats draw the long ones. For a few receivers this is a real hidden chunk of what they produce.",
     "yards from defensive pass interference drawn ÷ games")
_e('sospr', "How good the pass defenses he has faced are.",
     "Lower means tougher defenses. Before about week 4 there is not enough to go on, so this stays blank.",
     "each opponent's EPA per dropback allowed in all its other games, averaged over his targets")

# ---------------------------------------------------------------- returns
_e('krg', "Kickoffs he returns, per game.",
     "How much of the kick-return job is his.",
     "kick returns ÷ games")
_e('kravg', "Average yards on his kickoff returns.",
     "The classic return stat.",
     "kick-return yards ÷ kick returns")
_e('krepa', "How many points he adds on an average kickoff return.",
     "Return average does not know where the ball was caught or whether he fumbled it. This does.",
     "EPA on his kick returns ÷ kick returns")
_e('prg', "Punts he returns, per game.",
     "How much of the punt-return job is his.",
     "punt returns ÷ games")
_e('pravg', "Average yards on his punt returns.",
     "The classic return stat.",
     "punt-return yards ÷ punt returns")
_e('prepa', "How many points he adds on an average punt return.",
     "A muffed punt is a disaster and a 12-yard return is a quiet win. This counts both properly.",
     "EPA on his punt returns ÷ punt returns")

# ---------------------------------------------------------------- blocking
_e('pen100', "Penalties per 100 snaps.",
     "Penalties per game is unfair to a man who plays every snap. This is the same count over how much he actually played.",
     "penalties ÷ offensive snaps × 100")
_e('penydg', "Penalty yards he costs his team, per game.",
     "A false start is five yards. A hold is ten and wipes out the play. This weighs them.",
     "penalty yards ÷ games")
_e('penstall', "Flags on him that came on a series his offense then failed to convert, per game.",
     "A penalty you recover from is an annoyance. One that ends the drive is a real cost.",
     "his flags on series that did not get a first down or a score ÷ games")
_e('prsallowc', "How often the quarterback is pressured on the pass plays he blocks for, as counted by game charters.",
     "This one is filled in every week of the season. It is the whole line's number on his snaps, not a grade of him alone. It comes from a different set of counters than the row above it, and the two do not always agree, so they are kept apart.",
     "his team's charted pressures in each game × his share of the snaps ÷ pass plays he blocked on")
_e('hitallow', "How often the quarterback is hit on the pass plays he blocks for.",
     "A hit is more than a pressure and less than a sack. It is the whole line's number on his snaps. Until a season's play-by-play lineups are published, after the Super Bowl, it is worked out from his share of each game's snaps.",
     "quarterback hits on his pass-blocking snaps ÷ pass-blocking snaps")
_e('gapsr', "How often runs aimed at his spot on the line keep the offense on schedule.",
     "The play-by-play records which gap every run went through. This is the closest free data gets to grading one lineman's run blocking, though the man next to him is part of every one of these plays too.",
     "successful runs to his gap in his games × his share of the snaps ÷ runs to his gap")
_e('gapypc', "Yards per carry on runs aimed at his spot on the line.",
     "Left tackle gets the runs around left end and off left tackle; a guard gets the runs behind him; the center gets the middle.",
     "yards on runs to his gap ÷ runs to his gap")
_e('gapstuff', "How often a run aimed at his spot goes nowhere.",
     "A run stopped for no gain or a loss usually means somebody got beaten at the point of attack. Lower is better.",
     "runs to his gap for zero or fewer yards ÷ runs to his gap")
_e('gwo', "How much better or worse his team's offense is in the games he plays than in the games he misses.",
     "The oldest test there is: what happens when he is not there? It needs him to have missed at least two games, and it cannot tell his absence apart from anything else that changed those weeks.",
     "team EPA per play in his games − team EPA per play in the games he missed")
_e('linescore', "The grade for his team's whole offensive line, from 0 to 100.",
     "A lineman is one of five. This is how the five are doing together: sacks allowed, quarterback hits allowed and how often the runs work.",
     "average of his team's league percentile in sack rate, QB-hit rate and rush success rate")
_e('linecont', "How much of the season his team's line has been the same five men.",
     "Lines get better by playing together. 100% means the same five have taken every snap; a number in the 70s means injuries have been shuffling the deck.",
     "snaps by the five most-used linemen ÷ all snaps by linemen")

# ---------------------------------------------------------------- pass rush
_e('prsspass', "How often he gets pressure, out of the pass plays he was on the field for.",
     "Pressures per snap punishes a run-stuffer and flatters a specialist who only comes in on third down. This counts only the plays where he could rush the passer. Until a season's play-by-play lineups are published, after the Super Bowl, the pass-play count is an estimate.",
     "pressures ÷ pass plays he was on the field for")
_e('prsshr', "Out of all his team's pressures in the games he played, the share that were his.",
     "Tells you whether he is the pass rush or one part of it.",
     "his pressures ÷ his team's pressures in his games")
_e('blitzrate', "How often he is sent after the quarterback, out of the pass plays he was on the field for.",
     "For a linebacker or a defensive back this is a description of the job his coach gives him. Until a season's play-by-play lineups are published, after the Super Bowl, the pass-play count is an estimate.",
     "blitzes ÷ pass plays he was on the field for")
_e('skpass', "Sacks out of the pass plays he was on the field for.",
     "The fair version of sacks per snap. Until a season's play-by-play lineups are published, after the Super Bowl, the pass-play count is an estimate.",
     "sacks ÷ pass plays he was on the field for")
_e('skshr', "Out of all his team's sacks in the games he played, the share that were his.",
     "A man with ten sacks on a team with fifty is a different story from ten on a team with twenty-five.",
     "his sacks ÷ his team's sacks in his games")
_e('skepa', "How many points an average sack of his takes away from the offense.",
     "A sack on third-and-long in field-goal range is worth far more than one on first down at midfield. This prices each of his sacks.",
     "points taken off the offense by his sacks ÷ his sacks")
_e('skyd', "How many yards the offense loses on an average sack of his.",
     "Some sacks are a one-yard tackle at the line. Some put the offense out of field-goal range.",
     "yards lost on his sacks ÷ his sacks")
_e('sk3rd', "Sacks on third and fourth down, per game.",
     "A sack on the last down ends the drive. These are the ones that get the defense off the field.",
     "sacks on 3rd and 4th down ÷ games")
_e('stripsk', "Sacks where he also knocked the ball loose, per game.",
     "The best play a pass rusher can make. It is rare, so read it over a career more than over a season.",
     "sacks with a forced fumble ÷ games")

# ---------------------------------------------------------------- run defense
_e('rstop', "Tackles on runs that failed for the offense, per game.",
     "A tackle eight yards downfield is still a tackle. This only counts the ones that stopped the run short of what the offense needed.",
     "tackles on unsuccessful runs ÷ games")
_e('rstoprate', "How often he makes a run stop, out of the running plays he was on the field for.",
     "The fair version of the row above for a man who does not play every snap. Until a season's play-by-play lineups are published, after the Super Bowl, the run-play count is an estimate.",
     "run stops ÷ run plays he was on the field for")
_e('rtkdepth', "How far the runner had got when he made the tackle, on average.",
     "A defensive tackle should be making tackles at the line. A safety making them seven yards downfield is cleaning up after somebody else. Compare only with players at his own position. Lower is better.",
     "yards gained on the runs he tackled ÷ run tackles")
_e('havoc', "How often he makes a play that wrecks the offense: a tackle for loss, a sack, a forced fumble, an interception or a pass knocked away.",
     "One number for the disruptive plays, whichever kind his position makes.",
     "(tackles for loss + sacks + forced fumbles + interceptions + passes defended) ÷ defensive snaps")
_e('passshr', "Out of the snaps he plays, the share that are pass plays.",
     "This is his role. A nose tackle comes off the field on passing downs and sits near 40%; a pass-rush specialist is above 70%. Only known once a season is over.",
     "pass plays he was on the field for ÷ all plays he was on the field for")
_e('depaoo', "How much the offense gains per play with him on the field, compared with when he is off it.",
     "Below zero means his defense is better with him out there. It needs him to have sat out enough plays to compare, and it cannot separate him from whoever replaces him. Only known once a season is over.",
     "EPA per play allowed with him on the field − with him off it")
_e('drsoo', "How often runs succeed against his defense with him on the field, compared with when he is off it.",
     "Below zero means the run defense is better with him out there. Only known once a season is over.",
     "rush success rate allowed with him on the field − with him off it")

# ---------------------------------------------------------------- coverage
_e('ctgtcov', "How often he is thrown at, out of the pass plays he was on the field for.",
     "Quarterbacks avoid the best corners. A low number can mean he is covering so well nobody tries him. Until a season's play-by-play lineups are published, after the Super Bowl, the pass-play count is an estimate.",
     "targets ÷ pass plays he was on the field for")
_e('ycovsnap', "Yards he gives up for every pass play he was on the field for.",
     "The best single coverage number free data can give, because it rewards not being thrown at as well as not being beaten. Until a season's play-by-play lineups are published, after the Super Bowl, the pass-play count is an estimate.",
     "yards allowed in coverage ÷ pass plays he was on the field for")
_e('airall', "How far downfield the completions he allows are caught, on average.",
     "Giving up short catches in front of you is one thing. Getting beaten deep is another. Lower is better.",
     "air yards on completions allowed ÷ completions allowed")
_e('tdall', "Touchdowns he gives up in coverage, per game.",
     "The worst outcome there is for a defensive back.",
     "touchdowns allowed in coverage ÷ games")
_e('tkyac', "When he tackles a receiver, how far that receiver had already run after the catch.",
     "A low number means he arrives with the ball. A high one means he is chasing. Lower is better.",
     "yards after the catch on the completions he tackled ÷ those tackles")
_e('dpepaoo', "How much the offense gains per dropback with him on the field, compared with when he is off it.",
     "Below zero means the pass defense is better with him out there. Only known once a season is over.",
     "EPA per dropback allowed with him on the field − with him off it")
_e('covpen', "Pass interference, defensive holding and illegal contact flags on him, per game.",
     "Grabbing is how a beaten defender avoids giving up a catch. It still costs yards and usually a first down.",
     "coverage flags ÷ games")
_e('covpenyds', "Yards he gives away on coverage flags, per game.",
     "Pass interference is a spot foul, so one of these can be worth forty yards. They never show up in his yards allowed.",
     "yards on coverage flags ÷ games")

# ---------------------------------------------------------------- kicking
_e('fgoeout', "Field goals over expected, counting only the kicks he tried outdoors.",
     "Kicking in a dome is easier. This compares everybody on the kicks where there was weather.",
     "(makes − expected makes) ÷ attempts, outdoor stadiums only")
_e('fgwpa', "How much his field goal tries have moved his team's chance of winning, added up.",
     "A make at the gun is worth far more than a make up 20. This weighs every kick by how much it mattered. A miss counts against him.",
     "the change in win probability on each field goal try, added up")
_e('kotb', "How often his kickoffs are touchbacks.",
     "Under the newer kickoff rules a touchback is no longer the goal it used to be, so read this as a description of how his team wants to kick off.",
     "touchbacks ÷ kickoffs")
_e('kodist', "How far his kickoffs travel, on average.",
     "Leg strength, more or less, though coaches now ask for kicks that land short on purpose.",
     "kickoff yards ÷ kickoffs")
_e('koflag', "How often he kicks it out of bounds, per 100 kickoffs.",
     "A kickoff out of bounds gives the other team the ball at the 40. It is the one clear mistake a kickoff man can make.",
     "kickoffs out of bounds ÷ kickoffs × 100")
_e('pepa', "How many points an average punt of his is worth to his team.",
     "Gross and net average do not know where on the field he was standing. A 38-yard punt that dies at the 3 is a great punt, and this knows it.",
     "EPA on his punts ÷ punts")

# ---------------------------------------------------------------- value
_e('xfp', "The fantasy points an average player would have scored with his exact workload, per game.",
     "This is his opportunity: every carry and target, priced by where on the field it happened. Opportunity is steadier than production, so it is the better guide to what happens next.",
     "expected PPR points from his carries, targets and pass attempts ÷ games (the ffopportunity model)")
_e('fpoe', "How many more fantasy points he scores per game than his workload says he should.",
     "Above zero means he is making more of his chances than most would. Part of that is talent and part is luck, and it tends to drift back toward zero.",
     "(actual PPR points − expected PPR points) ÷ games")
_e('tdoe', "Touchdowns compared with what his carries and targets would normally produce.",
     "Touchdowns are the luckiest stat in the game. A big number here usually comes back down; a big negative usually comes back up.",
     "touchdowns − expected touchdowns, season total")
_e('sav', "The points he has been worth this season above a replacement-level player at his position. It is what the All-Savant Team is picked on.",
     "One number for the whole job. It counts only this season, it counts every game he missed against him, and it leans on the stats that are his own: each stat is weighted by how well it follows a player to a new team and by how much it says about points, and a small sample is pulled toward average. An offensive lineman has one from 2016 on, where blocking numbers exist, and most of it is his line's play while he was on the field.",
     "for each part of his job: his standing in its stats, in expected points a game, times the share of it that is the player's; added up, less a replacement player (the 25th percentile at the position), times the games' worth of snaps he has played")
_e('wpa', "How much his plays have moved his team's chance of winning, added up over the season.",
     "EPA treats every situation the same. This one cares about the scoreboard and the clock, so a late go-ahead drive counts for more.",
     "the change in win probability on each of his dropbacks, carries and targets, added up")
_e('apy', "What his contract pays him per year, in millions of dollars.",
     "Not a grade. It is here so you can see what he costs next to what he does.",
     "total contract value ÷ contract years, from the contract in force that season")
_e('capshr', "His yearly pay as a share of the salary cap in the year he signed.",
     "The cap goes up every year, so dollars are not comparable across time. A share of the cap is.",
     "average pay per year ÷ the salary cap when he signed")
