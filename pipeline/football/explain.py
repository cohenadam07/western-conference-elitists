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
_e('tgtshr', "Out of every pass his team throws, the share that goes to him.",
     "This is how much the offense runs through him. A number above 25% means he's the main guy.",
     "his targets ÷ team's targets, over every game his team has played. A game he missed counts against him here; the share rows further down this panel count only the games he played")
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
_e('fppg', "Fantasy points per game. PPR scoring for everybody but kickers.",
     "The number most people actually feel, week to week.",
     "PPR fantasy points ÷ games. A kicker scores 3 for a field goal under 40 yards, 4 from 40 to 49, 5 from 50 on, and 1 for an extra point")
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


# ================================================================ October 2026 additions
# Rows that the open feeds could already support and the page did not yet show. Same rule
# as everything above: a ten-year-old should follow it, and where a number is an estimate
# or belongs to the unit rather than the man, the explanation says so in plain words.

# ---------------------------------------------------------------- context
_e('passshr', "Out of all the snaps he played, the share that were pass plays.",
     "This is his job description in one number. A run-stuffing nose tackle comes off the field on third down and sits near 40%; a pass-rush specialist only plays those downs and sits near 70%. Read every pass-rush and coverage number on this page with it in mind.",
     "pass plays he was on the field for ÷ all the plays he was on the field for. In a season still being played the on-field file does not exist yet, so this is an estimate from his snap counts, each opponent's pass rate, and how his own split ran last year")

# ---------------------------------------------------------------- passing
_e('p2s', "When he is pressured, how often it ends in a sack.",
     "Pressure is mostly on the blockers. What happens next is mostly on him: some quarterbacks get the ball out or slide away, and some go down. This is the cleanest free number for telling the two apart.",
     "sacks ÷ pressures charted against him")
_e('hitpct', "How often he gets hit as he throws.",
     "A hit is pressure that arrived. It is here as background on what his pocket was like, not as a grade on him.",
     "times hit ÷ dropbacks")
_e('hurrypct', "How often he is rushed into throwing early.",
     "A hurry is pressure that got close enough to change the throw without touching him.",
     "times hurried ÷ dropbacks")
_e('ucrate', "How often he takes the snap from under center instead of the shotgun.",
     "It describes the offense he is in. Under-center teams lean on the run and play-action; shotgun teams spread the field. Neither is better, but his other numbers read differently depending on which he plays in.",
     "dropbacks from under center ÷ charted dropbacks")
_e('yacshr', "The share of his passing yards that his receivers gained after the catch.",
     "Two quarterbacks can both throw for 4,000 yards. One drove the ball downfield; the other threw short and watched his receivers run. A high number here means more of the yardage was their work.",
     "passing yards gained after the catch ÷ passing yards")
_e('airdist', "How far his average throw actually travels through the air, in a straight line.",
     "Depth of target only counts yards downfield. This counts the whole flight, so a deep out to the far sideline shows up as the long throw it really is. It is the closest thing here to a measure of arm.",
     "measured by tracking chips, release point to arrival")
_e('maxair', "The longest throw he has made this season, measured through the air.",
     "How far he can really push it. One throw, so it says what his arm can do, not what it usually does.")
_e('ngscpoe', "Completion percentage over expected, worked out from player tracking.",
     "The CPOE above grades a throw on how deep and where it went. This one also knows how open the receiver was and how close the rush was, because cameras tracked all 22 players. Two honest answers to the same question, which is why both are here.",
     "his completion % − the completion % tracking says those throws should produce")
_e('intluck', "Throws that should have been intercepted, minus the ones that were.",
     "Defenders drop interceptions all the time. A positive number means he has been getting away with it and his interception total is flattering him; a negative one means the ball has bounced the wrong way.",
     "interception-worthy throw rate − interception rate, in percentage points")
_e('cmpsh', "The share of his short throws that are caught.",
     "Short is 0 to 9 yards past the line. These are the easy ones, so the gaps between quarterbacks are small and a low number stands out.",
     "completions ÷ attempts travelling 0–9 yards in the air")
_e('cmpmd', "The share of his intermediate throws that are caught.",
     "Ten to 19 yards downfield is where most quarterbacks are sorted. The windows are tight and the throws have to be on time.",
     "completions ÷ attempts travelling 10–19 yards in the air")
_e('cmpdp', "The share of his deep throws that are caught.",
     "Twenty yards or more in the air. Nobody completes many of these, and a season is a small sample, so read it loosely.",
     "completions ÷ attempts travelling 20+ yards in the air")
_e('ypadp', "Yards gained per deep throw.",
     "Deep balls are low-percentage and high-reward. This puts the two together: what a shot downfield has actually been worth.",
     "yards on throws of 20+ air yards ÷ those attempts")
_e('epang', "Points added per dropback while the game was still in doubt.",
     "Late in a blowout the defense gives up short throws on purpose and everybody's numbers look better than they were. This throws those plays out.",
     "expected points added ÷ dropbacks, counting only plays where either team's win probability was between 10% and 90%")
_e('wpadb', "How much he moves his team's chance of winning, per 100 dropbacks.",
     "EPA treats a third-quarter first down in a blowout the same as one on the final drive. This does not: every play is weighed by how much the game hung on it.",
     "win probability added on his dropbacks ÷ dropbacks × 100, in wins")
_e('ppd', "Points his offense scores on an average drive he leads.",
     "The whole point of a drive is to end with points. This is the bottom line, though it belongs to the whole offense and not just to him.",
     "(7 × touchdowns + 3 × field goals) ÷ drives. A drive is his if he took the most dropbacks on it")
_e('scorepct', "How often a drive he leads ends in a touchdown or a field goal.",
     "Points per drive can be carried by a few long touchdowns. This asks how often the offense comes away with anything at all.",
     "scoring drives ÷ drives")
_e('toopct', "How often a drive he leads goes three plays and a punt.",
     "The worst thing an offense can do short of a turnover. It hands the ball back and leaves its own defense on the field.",
     "drives that punted without a first down ÷ drives")

# ---------------------------------------------------------------- rushing
_e('carshr', "Out of every carry his team hands out, the share that goes to him.",
     "Whether he is the back or one of the backs. A committee shows up here before it shows up anywhere else.",
     "his carries ÷ his team's carries, in the games he played")
_e('desg', "Runs called for him per game, not counting scrambles.",
     "A designed run is the coach's decision; a scramble is his. Adding them together, as the box score does, hides how much each offense actually builds around his legs.",
     "(carries − scrambles) ÷ games")
_e('scrg', "How many times a game a pass play turns into him running.",
     "Scrambles are improvisation. Some quarterbacks do it five times a game and some never do.",
     "scrambles ÷ games")
_e('roepct', "How often his run gains more than the blocking in front of him said it should.",
     "Yards over expected per carry can be swung by one 60-yard run. This counts how often he beats the expectation instead of by how much, so it settles down faster.",
     "carries that gained more than expected ÷ carries, from player tracking")
_e('ngseff', "How far he actually runs for each yard he gains.",
     "A back who hits the hole and goes scores near 3. One who dances sideways scores 4 or more. Lower is more north-and-south.",
     "total distance covered on his carries ÷ rushing yards, from player tracking")
_e('epades', "Points added on an average run that was called for him.",
     "This is his value as a planned part of the run game, with the scrambles taken out.",
     "expected points added on designed runs ÷ designed runs")
_e('epascr', "Points added on an average scramble.",
     "Scrambles are worth a lot because they come on plays that were already broken. This shows how much he makes of them.",
     "expected points added on scrambles ÷ scrambles")
_e('ypscr', "Yards gained per scramble.", "How far he gets when he takes off.", "scramble yards ÷ scrambles")
_e('ypclight', "Yards per carry when the defense had six or fewer men near the line.",
     "A light box is an invitation to run. A good back is supposed to cash it in, so this is the bar his other numbers should clear.",
     "yards ÷ carries against six or fewer defenders in the box")
_e('ypcstack', "Yards per carry when the defense had eight or more men near the line.",
     "These are the hard yards. Everybody knows the run is coming and there are more defenders than blockers.",
     "yards ÷ carries against eight or more defenders in the box")
_e('insidepct', "The share of his carries that go between the tackles.",
     "It describes the back and the scheme. A power runner lives inside; a speed back gets the ball on the edge.",
     "carries through the guard gaps or up the middle ÷ carries with a charted gap")
_e('ypcin', "Yards per carry on runs between the tackles.",
     "Inside runs are crowded and rarely break long, so a good average here is hard-earned.",
     "yards ÷ carries through the guard gaps or up the middle")
_e('ypcout', "Yards per carry on runs to the outside.",
     "Outside runs are boom or bust: more losses, more long gains. Speed shows up here.",
     "yards ÷ carries off tackle or around the end")
_e('i10shr', "His share of his team's carries inside the opponent's 10-yard line.",
     "These are the carries that turn into touchdowns. A back can lead his team in yards and still be taken out near the goal line.",
     "his carries inside the 10 ÷ his team's, in the games he played")
_e('i5shr', "His share of his team's carries inside the opponent's 5-yard line.",
     "The most valuable touches in football. Whoever gets these gets the touchdowns.",
     "his carries inside the 5 ÷ his team's, in the games he played")
_e('gltd', "How often a carry from inside the 5 ends in the end zone.",
     "Getting the carry is one thing. Finishing it is the other.",
     "touchdowns on carries inside the 5 ÷ carries inside the 5")
_e('syconv', "How often he gets it when there are two yards or fewer to go.",
     "Third-and-one is a different game from first-and-ten. The defense knows what is coming and the only question is whether he moves the pile.",
     "third- and fourth-down carries with 2 or fewer yards to go that got the first down or scored ÷ those carries")
_e('sneakconv', "How often his quarterback sneaks work.",
     "The sneak is the highest-percentage short-yardage play there is, and a few teams have turned it into a weapon.",
     "sneaks that got the first down or scored ÷ sneaks")

# ---------------------------------------------------------------- receiving
_e('tpps', "How often he is thrown to, per pass play he is on the field for.",
     "This is as close as open data gets to targets per route run. The row above it counts every snap, including the ones where he was blocking for a run. This counts only pass plays.",
     "targets ÷ pass plays he was on the field for. For a season still being played the count is an estimate from his snaps and his team's pass rate, shown for receivers only")
_e('ypps', "Receiving yards per pass play he is on the field for.",
     "The closest free stand-in for yards per route run, the best single receiver number there is. It judges him by his chances to get open, not by how often the quarterback looked his way.",
     "receiving yards ÷ pass plays he was on the field for. A tight end or a back who stays in to block is still counted as on the field, so theirs run a little low")
_e('frshr', "Out of every throw that went to his quarterback's first read, the share that went to him.",
     "A first read is the man the play was drawn up for. This says how much of the passing game is designed to go to him, before any scrambling or checking down.",
     "his first-read targets ÷ his team's first-read targets, in the games he played")
_e('recyshr', "His share of all his team's receiving yards.",
     "Yards per game depends on how much his team throws. This does not: it is how much of the passing game is him.",
     "his receiving yards ÷ his team's, in the games he played")
_e('rectdshr', "His share of his team's receiving touchdowns.",
     "Who the offense looks for when it gets close.",
     "his receiving touchdowns ÷ his team's, in the games he played")
_e('recfdshr', "His share of his team's first downs through the air.",
     "The receiver who moves the chains, whether or not he piles up the yards.",
     "his receiving first downs ÷ his team's, in the games he played")
_e('croe', "How much more often he catches the ball than the throws said he should.",
     "A screen is easy to catch and a deep ball into coverage is not, so plain catch rate rewards short routes. This grades each target on its own difficulty first.",
     "his catch rate − the completion probability of the throws to him, in percentage points")
_e('frpct', "The share of his targets that came as the quarterback's first read.",
     "Not all targets are the same. These are the ones the play was built to produce.",
     "first-read targets ÷ charted targets")
_e('despct', "The share of his targets that came on plays designed to get him the ball.",
     "Screens, shovel passes and the like, where there is no progression at all. Manufactured touches.",
     "designed targets ÷ charted targets")
_e('chkpct', "The share of his targets that were checkdowns.",
     "A checkdown goes to him because nobody else was open. A back with a high number here is catching what is left over; one with a low number is a real part of the passing plan.",
     "checkdown targets ÷ charted targets")
_e('scrnpct', "The share of his targets that were screens.",
     "A screen is a run play that happens to be thrown. It pads the catch total and says little about getting open.",
     "screen targets ÷ charted targets")
_e('crsh', "The share of his short targets that he catches.", "Short is 0 to 9 yards past the line: slants, hitches, quick outs.",
     "catches ÷ targets travelling 0–9 yards in the air")
_e('crmd', "The share of his intermediate targets that he catches.", "Ten to 19 yards downfield, where most contested throws live.",
     "catches ÷ targets travelling 10–19 yards in the air")
_e('crdp', "The share of his deep targets that he catches.", "Twenty yards or more in the air. Small samples, big swings.",
     "catches ÷ targets travelling 20+ yards in the air")
_e('yptdp', "Yards gained per deep target.", "What throwing it deep to him has actually been worth.",
     "yards on targets of 20+ air yards ÷ those targets")
_e('yacoex', "Yards after the catch beyond what the situation said to expect, worked out from play-by-play.",
     "The tracking version above only covers about a hundred receivers a year. This one covers everybody who catches a pass, backs included, using a model of how far a catch at that depth and spot usually goes. The two do not always agree, which is why they are separate rows.",
     "(yards after catch − expected yards after catch) ÷ receptions")
_e('eztgt', "Throws to him that travel into the end zone, per game.",
     "A red-zone target can be a screen at the 18. This is the real thing: the ball was thrown to him in the end zone.",
     "targets where the ball travelled at least as far as the goal line ÷ games")
_e('ezshr', "His share of his team's throws into the end zone.",
     "The best single hint at who catches the touchdowns from here.",
     "his end-zone targets ÷ his team's, in the games he played")
_e('c3conv', "How often a third- or fourth-down throw to him moves the chains.",
     "The down everybody in the building knows is a pass.",
     "third- and fourth-down targets that got the first down ÷ third- and fourth-down targets")
_e('dpiyds', "Pass-interference yards he draws per game.",
     "When a defender grabs him downfield the flag wipes the play off the stat sheet: no target, no catch, no yards. But the offense still moved, sometimes forty yards, and he is why.",
     "yards on accepted defensive pass interference flags thrown on passes to him ÷ games")

# ---------------------------------------------------------------- blocking
_e('pensnap', "Flags thrown on him for every 100 snaps he plays.",
     "Per game punishes the man who plays every down. This is the fair version.",
     "penalties ÷ offensive snaps × 100")
_e('penydsg', "Penalty yards he costs his team per game.", "A holding call is ten yards and a false start is five.",
     "penalty yards ÷ games")
_e('penepag', "How many expected points his flags cost his team per game.",
     "Ten yards is not always ten yards. A hold that wipes out a touchdown costs far more than one on first down at midfield, and this counts the difference.",
     "expected points lost on plays where he was flagged ÷ games")
_e('hitallow', "How often the quarterback was hit or sacked while he was on the field.",
     "Like the rows around it, this is the whole line's number on his snaps, not a count of the men he let through.",
     "dropbacks where the quarterback was hit or sacked ÷ dropbacks, weighted by the share of each game he played")
_e('prsqb', "How often his quarterback was charted as pressured while he was on the field.",
     "This comes from a different set of charters than the pressure row above, and it is the one that exists during the season. They count pressure more strictly, so the number runs lower and should not be compared with the other one.",
     "pressures charted against his quarterbacks ÷ their dropbacks, weighted by the share of each game he played")
_e('gapsr', "How often a run aimed at his spot on the line stays on schedule.",
     "Every run in the play-by-play is tagged with the gap it went through. These are the ones that went behind him. It is still a unit number, since the back and the man next to him matter too, but it is closer to his own work than the team's total.",
     "successful designed runs through his gap ÷ designed runs through his gap, weighted by the share of each game he played. A tackle gets the tackle and end gaps on his side, a guard his guard gap, a center the middle")
_e('gapypc', "Yards per carry on runs aimed at his spot on the line.",
     "The same runs as the row above, measured in yards.",
     "yards ÷ designed runs through his gap")
_e('gapstf', "How often a run aimed at his spot is stopped for no gain or a loss.",
     "A stuffed run usually means somebody on that side lost at the snap.",
     "runs through his gap that gained zero or less ÷ runs through his gap")
_e('wosack', "His team's sack rate in the games he played, minus the games he missed.",
     "The on/off rows above compare snaps inside a game. This compares whole games, so it exists during the season. It is a rough cut: the opponent and the quarterback change from week to week too.",
     "sack rate allowed in games he played − sack rate allowed in games he missed, in percentage points")
_e('worun', "His team's rushing success in the games he played, minus the games he missed.",
     "Rough for the same reason as the row above, but it is the only with-and-without number a season in progress can offer.",
     "rush success rate in games he played − in games he missed, in percentage points")

# ---------------------------------------------------------------- pass rush
_e('prsspass', "How often he pressures the quarterback, per pass play he is on the field for.",
     "The row above divides by every snap, which punishes a man who also plays the run. This divides by his chances to rush.",
     "pressures ÷ pass plays he was on the field for. During a season the count of pass plays is an estimate")
_e('prsshr', "His share of all the pressure his defense creates.",
     "Is the pass rush him, or is he one of four?",
     "his pressures ÷ his team's pressures, in the games he played")
_e('blitzrate', "How often he is sent after the quarterback, per pass play he is on the field for.",
     "This is the coaches' choice more than his. It tells you what he is asked to do before you judge how he does it.",
     "blitzes ÷ pass plays he was on the field for")
_e('skpass', "Sacks per pass play he is on the field for.",
     "The fair denominator for a sack: he cannot get one on a run.",
     "sacks ÷ pass plays he was on the field for")
_e('skepa', "How many expected points an average sack of his takes off the board.",
     "A sack on third-and-six ends a drive. A sack on first-and-ten after a holding call barely matters. This weighs each one by what it did.",
     "expected points the offense lost on his sacks ÷ his sacks, with half-sacks counted as half")
_e('skyds', "Yards the offense loses on an average sack of his.", "A sack that chases the quarterback back fifteen yards is worth more than one at the line.",
     "sack yards ÷ sacks")
_e('sk3pct', "The share of his sacks that came on third or fourth down.",
     "Those are the ones that get the defense off the field.",
     "sacks on third or fourth down ÷ sacks")
_e('havoc', "How often he blows a play up.",
     "A tackle for loss, a forced fumble, a batted pass or an interception. These are the plays that swing a drive, added together and set against his playing time.",
     "(tackles for loss, which include sacks, + forced fumbles + passes defended + interceptions) ÷ defensive snaps")
_e('jumpg', "Flags for lining up or moving early, per game.",
     "Offside, neutral zone infraction and encroachment. Five free yards each, and usually the price of trying to time the snap.",
     "pre-snap penalties ÷ games")
_e('roughg', "Roughing-the-passer flags per game.", "Fifteen yards and a first down. The most expensive flag a pass rusher can draw.",
     "roughing-the-passer penalties ÷ games")

# ---------------------------------------------------------------- run defense
_e('rstopg', "Tackles he makes on running plays that failed for the offense, per game.",
     "A tackle eight yards downfield is still a tackle in the box score. A stop is a tackle that actually won the down.",
     "tackles on designed runs that left the offense behind schedule ÷ games. Solo tackles and assists both count")
_e('rstoprate', "How often he makes a run stop, per run play he is on the field for.",
     "Stops per game favours whoever faces the most runs. This sets his stops against his chances.",
     "run stops ÷ run plays he was on the field for. During a season the count of run plays is an estimate")
_e('rstopshr', "The share of his run tackles that were stops.",
     "Two linebackers can both make 60 tackles against the run. This says which one made them at the line and which one made them after the damage was done.",
     "run stops ÷ tackles on designed runs")
_e('tkldepth', "How far past the line of scrimmage his run tackles are made, on average.",
     "Where he meets the runner. It depends on position first: a defensive tackle averages about two and a half yards, a linebacker three and a half, a safety nearly six. So it is ranked only against men who play his spot.",
     "yards gained on the designed runs he tackled ÷ those tackles")
_e('dpepaoo', "What opposing passers do with him on the field, minus what they do when he is off it.",
     "Eleven men share every play, so this is his defense's number and not a grade on him. But it is the only place open data even tries to show what changes when he leaves. A negative number means the defense is better with him.",
     "EPA per dropback allowed with him on the field − EPA per dropback allowed without him, same team, same season")
_e('drsroo', "How often runs succeed with him on the field, minus when he is off it.",
     "The same idea for the run game. A negative number means runs work less often when he is out there.",
     "rush success rate allowed with him on the field − without him, in percentage points")

# ---------------------------------------------------------------- coverage
_e('ctgtpass', "How often he is thrown at, per pass play he is on the field for.",
     "The row above divides by every snap, which flatters a corner who spends downs playing the run. This divides only by the plays where there was a pass to cover.",
     "targets ÷ pass plays he was on the field for. During a season the count of pass plays is an estimate")
_e('ycpass', "Receiving yards he gives up per pass play he is on the field for.",
     "Yards per coverage snap is the standard way to grade coverage: it rewards the man who is never thrown at as well as the one who breaks passes up.",
     "yards allowed in coverage ÷ pass plays he was on the field for")
_e('tdallrate', "How often a throw at him ends in a touchdown.", "The most costly thing that can happen in coverage.",
     "touchdowns allowed in coverage ÷ targets")
_e('airall', "How far downfield the catches against him are made, on average.",
     "Yards allowed are part air and part run-after-catch. This is the air half. A high number means he is being beaten deep; a low one means he is giving up the short stuff and rallying.",
     "air yards on completions against him ÷ completions")
_e('ptkgain', "How much the offense had gained by the time he tackled the man who caught it.",
     "Low means he is closing on short throws. High means he is the last man making the tackle after a long gain, which is a safety's job more often than a fault.",
     "yards gained on the completions he made the tackle on ÷ those tackles")
_e('covpeng', "Coverage flags thrown on him per game.",
     "Pass interference, defensive holding and illegal contact. None of them shows up as a completion allowed, and all of them move the offense.",
     "coverage penalties ÷ games")
_e('covpenyds', "Yards his coverage flags give away per game.",
     "Pass interference is a spot foul, so one flag can be worth forty yards. A corner's numbers can look clean while this says otherwise.",
     "yards on his coverage penalties ÷ games")

# ---------------------------------------------------------------- kicking
_e('fgoeout', "Field goals over expected, counting only kicks made outdoors.",
     "No wind and perfect footing make every kick easier. A man who plays ten games a year under a roof is not doing the same job as one who kicks outside in December, and this takes the roof away.",
     "the same sum as the row above, over kicks in open-air stadiums only")
_e('kwpa', "How many wins his kicks have added or cost.",
     "A chip shot in the second quarter barely moves a game. A 54-yarder at the gun decides it. This adds up how much each of his kicks, made or missed, changed his team's chance of winning.",
     "win probability added on his field goals and extra points, summed")
_e('kotb', "The share of his kickoffs that end in a touchback.",
     "Read this one with the rulebook open. Before 2024 a touchback was a win for the kicker. Under the new kickoff it puts the ball at the 30 or 35, and teams often want it landed short on purpose.",
     "touchbacks ÷ kickoffs")
_e('kodist', "How far his average kickoff travels.", "Leg strength, though under the current rules where it lands matters more than how far it goes.",
     "kickoff yards ÷ kickoffs")
_e('kooob', "How often he kicks it out of bounds.", "A free 40-yard line for the other team.",
     "kickoffs out of bounds ÷ kickoffs")
_e('pnoe', "Net yards per punt compared with what the league nets from the same spot on the field.",
     "A punt from your own 10 has room to fly 55 yards. A punt from midfield has to be dropped inside the 20. Raw averages reward the first job and punish the second. This compares each punt with the league's average net from the same yard line.",
     "(his net yards − the league's average net from that field position) ÷ punts")
_e('pin10', "How often he pins the other team inside its own 10.", "Inside the 20 is good. Inside the 10 changes how the other offense has to call plays.",
     "punts that left the opponent inside its own 10 ÷ punts")

# ---------------------------------------------------------------- value
_e('xfpg', "The fantasy points an average player would have scored with exactly his chances.",
     "Every target and carry is worth something before anyone knows how it turned out: a goal-line carry is worth more than one at midfield. This adds up what his chances were worth. It is the steadiest fantasy number there is, because chances carry over from week to week and results do not.",
     "expected PPR points on his targets, carries and passes ÷ games, from the ffopportunity model")
_e('fpoeg', "The fantasy points he has scored beyond what his chances were worth.",
     "Some of this is skill and some of it is luck, mostly touchdown luck. A big positive number early in a season usually comes back down.",
     "(his PPR points − his expected PPR points) ÷ games")
_e('tdoeg', "Touchdowns he has scored beyond what his chances said to expect.",
     "The noisiest part of fantasy scoring. Players well above zero tend to score less from here; players well below tend to score more.",
     "(touchdowns − expected touchdowns) ÷ games")

# ---------------------------------------------------------------- special teams
_e('stshr', "The share of his team's special-teams plays he is on the field for.",
     "Kick coverage, punt protection, the return units. For a backup this is often the whole reason he is on the roster.",
     "his special-teams snaps ÷ his team's")
_e('sttklg', "Tackles he makes covering kicks and punts, per game.", "The one stat a core special-teamer can call his own.",
     "tackles on kickoffs and punts ÷ games")
_e('kravg', "Yards per kickoff return.", "Only returns he actually ran back count; touchbacks do not.",
     "kick return yards ÷ kick returns")
_e('krepa', "Points added on an average kickoff return.",
     "Yards are not the whole story: a return to the 20 is worse than a touchback. This scores each return by where it left the offense.",
     "expected points added, from his team's side ÷ kick returns")
_e('pravg', "Yards per punt return.", "Only punts he actually returned count; fair catches do not.",
     "punt return yards ÷ punt returns")
_e('prepa', "Points added on an average punt return.", "Field position, turned into points.",
     "expected points added, from his team's side ÷ punt returns")
