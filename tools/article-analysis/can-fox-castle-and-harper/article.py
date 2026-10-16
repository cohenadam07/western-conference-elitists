"""Builds the Spurs article body (blocks) from the verified analysis outputs.
Numbers come from /home/claude/spurs-article/out and data/, computed in the analysis scripts."""
import json, math

YT = 'svBxJqochlg'
B = []
def p(md): B.append({'t': 'p', 'md': md})
def h2(id, text, kicker=None): B.append({'t': 'h2', 'id': id, 'text': text, **({'kicker': kicker} if kicker else {})})
def h3(text): B.append({'t': 'h3', 'text': text})
def argue(side, title, *blocks): B.append({'t': 'argue', 'side': side, 'title': title, 'blocks': list(blocks)})
def P(md): return {'t': 'p', 'md': md}
def TEX(tex): return {'t': 'tex', 'tex': tex}
def LI(*items, ordered=False): return {'t': 'list', 'ordered': ordered, 'items': list(items)}
def math_box(title, *blocks): B.append({'t': 'math', 'title': title, 'blocks': list(blocks)})
def clip(start, end, caption): B.append({'t': 'clip', 'youtube': YT, 'start': start, 'end': end, 'caption': caption})
def chart(kind, title, caption=None, source=None, **props): B.append({'t': 'chart', 'kind': kind, 'title': title, 'caption': caption, 'source': source, 'props': props})
def table(caption, cols, rows, note=None, source=None, sortable=False, highlight=None):
    B.append({'t': 'table', 'caption': caption, 'cols': cols, 'rows': rows, 'note': note, 'source': source, 'sortable': sortable, 'highlight': highlight})
def stats(*items): B.append({'t': 'stats', 'items': list(items)})
def quote(md): B.append({'t': 'quote', 'md': md})

SAV = 'Basketball Savant, 2025-26 regular season'
NBA = 'NBA.com stats (stats.nba.com), pulled Oct 16, 2026'

B.append({'t': 'video', 'youtube': YT, 'title': 'Watch the film session'})
B.append({'t': 'howto'})
B.append({'t': 'toc'})

# ------------------------------------------------------------------ 1. The question
h2('question', 'The question', 'Part 1')
p("On October 14, Mitch Johnson started De'Aaron Fox, Stephon Castle and Dylan Harper together for the first time. The Spurs beat Phoenix 123-103 in a preseason game, and the three guards were +10 in the 12 minutes they shared. The fifth starter was Devin Vassell, not Julian Champagnie, who did not play that night. That detail matters later.")
p("Johnson's case is simple. All three of them can dribble, pass, shoot and defend, and in his words they are three of the team's better players. This piece tests every part of that, the same way the video does, but with room to show the math, every split worth looking at, and the strongest argument against each conclusion before deciding which side wins.")
stats({'label': 'Shared minutes last season', 'value': '69', 'sub': '25 regular season, 44 playoffs'},
      {'label': 'Point margin in those minutes', 'value': '-47', 'sub': '159 possessions'},
      {'label': 'Preseason start vs. Phoenix', 'value': '+10', 'sub': '12 minutes, 25 possessions'},
      {'label': 'Best estimate of the trio', 'value': '+3.9', 'sub': 'per 100, after luck and sample adjustment'})
clip(0, 22.6, "The first three-guard start: Harper finishing off a Castle feed, then Fox cutting for a Wembanyama assist (Oct 14 vs. Phoenix).")
p("Two samples, two opposite stories, and neither one is big enough to mean much. Last season the trio shared 25 minutes in the regular season (65 possessions, outscored by 21) and 44 in the playoffs (94 possessions, outscored by 26), including the Finals. The preseason start went the other way. The honest starting point is that the trio's own record tells you almost nothing, so the rest of this piece builds the answer from the parts.")
math_box("Why 69 minutes tells you almost nothing",
    P("A lineup's net rating is points scored minus points allowed per 100 possessions. Over a small number of possessions it is mostly noise. Basketball Savant measures how much noise by splitting each season at January 15 and checking how well a unit's rating before the split predicts its rating after. For five-man units the true spread between lineups is about 5.7 points per 100, and the noise is large enough that a unit needs about 843 possessions before its own record counts as much as the team's rating."),
    TEX(r"\hat{\theta} = \frac{n \cdot \text{NetRtg}_{\text{adj}} + k \cdot \text{Team}_{\text{adj}}}{n + k}"),
    P("Here n is the unit's possessions, k is that break-even point, and both ratings are luck-adjusted: opponents' three-point and free-throw shooting are reset to league average, because a lineup has almost no control over whether the other team hits its open threes or its free throws."),
    P("For the trio, n = 159 possessions across the regular season and playoffs. Their raw net rating was -24.7 per 100, -21.3 after the luck adjustment. The Spurs as a team were +7.6 luck-adjusted. Savant fits k for pairs (1,221) and five-man units (843); for a three-man group I interpolate between them, which gives about 1,079."),
    TEX(r"\hat{\theta}_{\text{trio}} = \frac{159 \times (-21.3) + 1079 \times 7.6}{159 + 1079} \approx +3.9"),
    P("So the best estimate from last season is a trio about 4 points per 100 worse than the Spurs' average (+3.9 against +7.6), not the 29 to 33 points worse that the luck-adjusted and raw numbers show. The lineup explorer in Part 8 lists the two samples separately (+6.2 for the regular season, +5.1 for the playoffs); pooled, the bigger sample earns less pull toward the team, so the combined estimate sits below both. Most of those possessions also came in the playoffs against the best teams in the league, which makes the raw number even less informative."))

h3('The bar they have to clear')
p("The lineup this replaces was very good. Fox, Vassell, Champagnie, Wembanyama and Castle were the Spurs' most-used five last season: 284 minutes, +17.6 per 100, +16.1 after the luck adjustment and +11.2 after the sample adjustment. That last number is the one to beat. Every argument below is about whether swapping a 38% shooter for Harper costs more than Harper adds.")

# ------------------------------------------------------------------ 2. One ball
h2('one-ball', 'One ball', 'Part 2')
p("Usage rate is the share of a team's possessions a player ends, with a shot, a trip to the free-throw line or a turnover, while he is on the floor. Five players are out there at once and every possession ends exactly once, so across the five the shares add up to 100% on average.")
math_box("The usage formula",
    TEX(r"\text{USG\%} = 100 \times \frac{(\text{FGA} + 0.44\,\text{FTA} + \text{TOV}) \times (\text{Team MIN}/5)}{\text{MIN} \times (\text{Team FGA} + 0.44\,\text{Team FTA} + \text{Team TOV})}"),
    P("The 0.44 turns free-throw attempts into possessions (two shots, three shots and and-ones average out to about 0.44 possessions per attempt). Each player's season usage is measured against everyone he shared the floor with, so a lineup of five season usages is a forecast, not an identity. Across 5,669 five-man units from 2018-19 to 2025-26, the season usages of the five players summed to 99.0% on average, with a standard deviation of 8.9."))
table("Usage and creation, 2025-26",
      [{'k': 'p', 'label': 'Player'}, {'k': 'usg', 'label': 'Usage %', 'align': 'r'}, {'k': 'ast', 'label': 'Assist %', 'align': 'r'}, {'k': 'tov', 'label': 'Turnover %', 'align': 'r'}, {'k': 'uast', 'label': 'Unassisted makes %', 'align': 'r'}, {'k': 'drv', 'label': 'Drives / 75', 'align': 'r'}],
      [{'p': 'Wembanyama', 'usg': '31.6', 'ast': '17.0', 'tov': '10.8', 'uast': '29.8', 'drv': '7.1'},
       {'p': 'Castle', 'usg': '24.3', 'ast': '34.4', 'tov': '18.0', 'uast': '50.9', 'drv': '15.2'},
       {'p': 'Fox', 'usg': '24.2', 'ast': '28.6', 'tov': '12.4', 'uast': '59.5', 'drv': '13.6'},
       {'p': 'Harper', 'usg': '21.1', 'ast': '24.6', 'tov': '12.3', 'uast': '55.3', 'drv': '13.6'},
       {'p': 'Vassell', 'usg': '17.6', 'ast': '10.7', 'tov': '6.9', 'uast': '18.2', 'drv': '4.1'},
       {'p': 'Champagnie', 'usg': '14.6', 'ast': '7.1', 'tov': '8.4', 'uast': '12.3', 'drv': '3.0'}],
      source=SAV)
chart('usage', 'Build a starting five', caption="Pick any five. The bar stacks each player's 2025-26 usage; anything past the gold line is usage someone has to give up. The Phoenix starting five comes to 118.8%. Swap Champagnie in for Vassell and it is 115.8%, the 116% from the video.", source=SAV, data='roster.json', initial=['Wemby', 'Castle', 'Fox', 'Harper', 'Vassell'])
argue('case', 'Somebody has to shrink, and nobody wants to',
    P("Wembanyama scored 30.2 points per 75 possessions and the Spurs were 16.4 points per 100 better with him on the floor, both at or near the 99th percentile. The guards are there to feed him, not the other way around. Fox is the most proven creator: 59.5% of his made shots were unassisted (94th percentile) with a 2.71 assist-to-turnover ratio. Harper, at 19, already drives exactly as often as Fox does. Three ball-dominant guards plus a 31.6% usage center is 101% before the fifth starter touches the ball."))
argue('counter', "Usage isn't a fixed budget, and giving some up costs almost nothing",
    P("Usage adjusts. Players on the floor with other creators simply shoot less, and the efficiency cost is small. Across 3,658 pairs of back-to-back seasons since 2010-11 in which the player logged real minutes both years, each point of usage he gave up raised his true shooting by about 0.1 points (controlling for age). The 481 cases in which a player's usage fell by three points or more, about 4.4 on average, gained 0.56 points of true shooting. Fox already did this: his usage went from 30.0% in his last full Sacramento season to 24.2%, and his true shooting went up, from .567 to .578."),
    P("The game-level splits say the same thing. Fox used 19.9 possessions per 36 minutes in games Castle played and 26.7 in the 14 games Castle missed. With Wembanyama in the lineup it was 19.8; without him, 25.4. Fox has already shown he can scale down next to other creators."))
argue('answer', "The cost isn't efficiency. It shows up in the lineup data, depending on how you measure talent",
    P("The real question is whether stacking usage costs the lineup, not the individual. I tested it on all 5,669 five-man units from 2018-19 to 2025-26: a unit's offensive rating against the summed box-score talent of its five players (offensive Box Plus/Minus), the number of weak shooters, and how far its summed usage runs past 100, comparing units within the same team and season and controlling for how much each unit played."),
    P("Measured that way, every point of usage past 100 costs about 0.16 points of offensive rating (standard error 0.03). Units whose usage summed to 112% or more scored about 1 point per 100 worse than their talent predicted. A 118.8% lineup would give back roughly 3 points per 100."),
    P("But that result depends on the talent measure. Box Plus/Minus rewards usage, so five high-usage players add up to more box-score talent than the floor can hold, and the negative usage term may only be correcting that. When I measure talent with luck-adjusted on/off instead, which knows nothing about usage, the penalty on offense disappears (-0.006 per point, standard error 0.019). It survives on overall net rating (-0.12 per point), but that version is noisier."))
argue('verdict', 'Where it lands',
    P("The one-ball problem is smaller than it sounds. Players shrink their usage, and the efficiency cost of doing it is close to zero. What the data can't rule out is a cost of about 1 to 3 points per 100 from having three creators on the floor at once, and it depends on whose measuring stick you trust. The real question is who gives the ball up, and that answer points at Castle."))
math_box("The lineup usage regressions",
    P("Weighted least squares on 5,669 five-man units (Basketball Savant lineup files, 2018-19 to 2025-26), weighted by possessions. Talent is the sum of the five players' season values. Weak shooters are players under 34.5% from three or with fewer than 50 attempts."),
    {'t': 'table', 'cols': [{'k': 'm', 'label': 'Outcome and talent measure'}, {'k': 'u', 'label': 'Per point of usage over 100', 'align': 'r'}, {'k': 'se', 'label': 'Std. error', 'align': 'r'}],
     'rows': [{'m': 'Offense, OBPM, no team controls', 'u': '-0.131', 'se': '0.021'},
              {'m': 'Offense, OBPM, team-season effects + minutes', 'u': '-0.162', 'se': '0.026'},
              {'m': 'Offense, total BPM, team-season effects', 'u': '-0.050', 'se': '0.022'},
              {'m': 'Offense, luck-adjusted on/off, team-season effects', 'u': '-0.006', 'se': '0.019'},
              {'m': 'Net rating, luck-adjusted on/off, team-season effects', 'u': '-0.119', 'se': '0.023'}]},
    P("Without any talent control the sign flips (+0.09): high-usage lineups are better, because high-usage players are usually the best players. That's the confound every version above is trying to remove."),
    TEX(r"\text{ORtg}_u = \alpha_{\text{team-season}} + \beta_1 \sum_{i \in u} \text{OBPM}_i + \beta_2 \cdot \#\text{weak shooters}_u + \beta_3 \Big(\sum_{i \in u} \text{USG}_i - 100\Big) + \beta_4 \ln(\text{MIN}_u) + \varepsilon_u"))

# ------------------------------------------------------------------ 3. Castle's turnovers
h2('turnovers', "Castle's turnovers", 'Part 3')
p("When Castle's assist rate jumped from 23.1% as a rookie to 34.4% last season, his turnover rate climbed from 13.4% to 18.0%, 5th percentile. Some of that comes with the job. Guards who create more for others turn it over more.")
chart('scatter', 'Assist rate vs. turnover rate, every qualified guard', caption="Each dot is a guard who qualified for Basketball Savant's 2025-26 percentiles (177 of them). The line is the league trend. Castle sits well above it, and the arrow shows where he came from as a rookie.", source=SAV,
      data='asttov.json', preset='asttov')
math_box("How many of Castle's turnovers are the job, and how many are him",
    P("Fitting turnover rate on assist rate and usage across the 177 qualified guards:"),
    TEX(r"\widehat{\text{TOV\%}} = 12.13 + 0.27 \cdot \text{AST\%} - 0.25 \cdot \text{USG\%} \qquad (R^2 = 0.37)"),
    P("At Castle's 34.4% assist rate and 24.3% usage the model expects 15.3%. He was at 18.0, a residual of +2.7, worse than 82% of guards. That residual is sticky: across 1,189 guard seasons since 2015-16, this year's residual predicts about 65% of next year's (r = 0.65). Castle's rookie residual was +1.4."),
    P("So a fair projection carries about 0.65 × 2.7 ≈ 1.8 points of 'him' into next season, on top of whatever the role demands:"),
    LI("Same on-ball role (34.4% assists, 24.3% usage): 15.3 + 1.8 ≈ 17.1%", "Off-ball role (assists back to about 25%, usage about 22%): 13.4 + 1.8 ≈ 15.2%"),
    P("Within-player data agrees. Guards whose assist rate fell by six points or more from one season to the next (136 of them, an 8.7-point average drop) cut their turnover rate by 1.7 points. The 156 whose assist rate jumped by six or more added about 1.5."))
clip(226.5, 266.9, "Three of Castle's bad-pass turnovers from the last month of the regular season.")
argue('case', 'Move Castle off the ball and the turnovers come down',
    P("The fix is built in. At UConn, where Castle rarely started possessions, he turned it over on 10% of his plays, 88th percentile among first-round picks since 2010. In the NBA his turnover rate tracks his on-ball load. Put Fox and Harper on the ball and Castle's turnovers should drop toward 15%. Coming out of the draft he wanted to be a point guard, and the Spurs let him. The turnovers are the reason that experiment should end in the starting lineup."))
argue('counter', "Castle is Wembanyama's best passer",
    P("Taking the ball out of Castle's hands also takes it out of the best Wembanyama connection on the roster. Castle threw Wembanyama 657 passes last season, 129 of which became assists, and Wembanyama shot 56.3% on shots right after a Castle pass. Off Fox's passes he shot 51.2%, off Harper's 50.6%. By my count of the play-by-play, Castle threw him 44 alley-oops in the regular season and 14 more in the playoffs. Fox threw 19 and 9, Harper 6 and 1."),
    P("Per 100 regular-season minutes they shared, that is 3.6 lobs from Castle, 1.7 from Fox and 1.1 from Harper. Making Castle a spot-up shooter turns the Spurs' best pick-and-roll partner for Wembanyama into a decoy in the corner."),
    P("And the turnovers were front-loaded. Castle averaged 5.4 a game in October, then 3.1, 3.5, 2.9, 2.8 and 2.7 from November through March."))
argue('answer', "Off the ball doesn't have to mean out of the action",
    P("The counter is right that the lob game is worth keeping, and the numbers say how much: Castle-to-Wembanyama is the Spurs' highest-volume passing connection, and no one else's passes made Wembanyama more efficient. But it doesn't need Castle to bring the ball up. A second-side role, where Castle catches a swing pass and attacks a defense that's already rotating, keeps the pick-and-roll with Wembanyama and removes the possessions that produced the turnovers: the early-clock pressure and full-court handling. The month-by-month numbers point the same way. He averaged 5.4 turnovers a game in October and between 2.7 and 3.5 in every month after, April included, which says the turnovers come from volume and situation more than from bad decisions."))
argue('verdict', 'Where it lands',
    P("Moving Castle off the primary role should take his turnover rate from about 18% to about 15%, not back to 13%. Some of it is him, and that part travels. The version that works keeps him in the Wembanyama two-man game as a second-side creator, and the version that doesn't is Castle standing in the corner."))

# ------------------------------------------------------------------ 4. Shooting
h2('shooting', 'Can they shoot?', 'Part 4')
p("If Castle moves off the ball, he has to make shots, and so do the other two. All three were between 33% and 35% from three last season. The players they would push out of the lineup, Vassell (38.4% on 6.4 attempts a game) and Champagnie (38.1% on 6.2), were not.")
table("Three-point and free-throw history",
      [{'k': 's', 'label': 'Stage'}, {'k': 'f3', 'label': 'Fox 3P%', 'align': 'r'}, {'k': 'fft', 'label': 'Fox FT%', 'align': 'r'}, {'k': 'c3', 'label': 'Castle 3P%', 'align': 'r'}, {'k': 'cft', 'label': 'Castle FT%', 'align': 'r'}, {'k': 'h3', 'label': 'Harper 3P%', 'align': 'r'}, {'k': 'hft', 'label': 'Harper FT%', 'align': 'r'}],
      [{'s': 'College', 'f3': '24.6', 'fft': '73.9', 'c3': '26.7', 'cft': '75.5', 'h3': '33.3', 'hft': '75.0'},
       {'s': '2023-24 (SAC)', 'f3': '36.9', 'fft': '73.8', 'c3': '', 'cft': '', 'h3': '', 'hft': ''},
       {'s': '2024-25', 'f3': '31.0', 'fft': '82.7', 'c3': '28.5', 'cft': '72.4', 'h3': '', 'hft': ''},
       {'s': '2025-26 regular season', 'f3': '33.2', 'fft': '76.0', 'c3': '33.2', 'cft': '73.4', 'h3': '34.3', 'hft': '75.6'},
       {'s': '2025-26, Oct to Feb', 'f3': '35.1', 'fft': '76.6', 'c3': '29.3', 'cft': '72.5', 'h3': '25.4', 'hft': '72.9'},
       {'s': '2025-26, Mar to Jun incl. playoffs', 'f3': '29.0', 'fft': '75.0', 'c3': '38.2', 'cft': '79.2', 'h3': '42.4', 'hft': '83.7'},
       {'s': '2026 playoffs only', 'f3': '29.4', 'fft': '75.8', 'c3': '35.0', 'cft': '81.6', 'h3': '33.3', 'hft': '82.7'}],
      note="College numbers are from Draft Savant. Split rows are built from NBA.com game logs.", source=f"{SAV}; Draft Savant; {NBA}")
clip(334.4, 356.1, "A 38% shooter at work: Champagnie spotting up off Fox and Harper.")

h3('The case: three 33% shooters')
p("A shooter who makes 38% of his threes forces his defender to stay attached to him, which keeps the driving lanes open. A shooter who makes 33% lets his defender sit in the paint and wait. Put three of them on the floor and the paint gets crowded right where Fox, Harper and Wembanyama want to go.")

argue('counter', "Off the catch, they already shoot what Vassell and Champagnie shoot",
    P("Split the threes by how they were taken and the gap disappears. On catch-and-shoot threes, the shots an off-ball guard actually gets, Fox shot 38.7%, Harper 38.7% and Castle 38.0%. Vassell shot 38.8% and Champagnie 38.5%. The league average was 37.1%."),
    P("What drags the three guards down is pull-ups. Fox made 28.2% of his 195 pull-up threes, Castle 5 of 43, Harper 6 of 35. In a lineup where nobody has to create every possession, a lot of those pull-ups turn into catch-and-shoot looks."))
chart('distance', 'How open they were, and what they did with it', caption="Three-point attempts by distance to the closest defender. Castle and Harper took about three of every four threes with nobody within six feet. Vassell got that kind of space on about one in five.", source=NBA, data='respect.json')
argue('answer', "They shoot the same because they get easier shots",
    P("The catch-and-shoot numbers look equal because the shots aren't. Of Castle's threes, 72.5% came with no defender within six feet, 90th percentile among guards. Harper's share was 76.4% (96th percentile). Vassell's was 21.8%, Champagnie's 33.5%. Defenses guarded Vassell and Champagnie as shooters and left Castle and Harper alone."),
    P("Once you hold the shot constant, the gap comes back. On wide-open threes, the league as a whole shot 38.4%. Castle shot 37.3%, Harper 33.1% and Fox 32.9%. Vassell shot 43.6% and Champagnie 49.7%. Equal catch-and-shoot percentages on very unequal shots mean the guards are the worse shooters."),
    P("That share is also the cleanest measure of spacing there is. Across the league, how often a player is left wide open tracks Basketball Savant's off-ball gravity closely (r = -0.63 over 196 players). The defense is already telling us which players it respects."))

h3("Is Castle's jump real?")
p("Castle went from 26.7% at UConn to 28.5% as a rookie to 33.2% last season, and over the Spurs' last 25 regular-season games (he played 21 of them) he made 32 of 78 (41.0%). The play-by-play has every one of those makes assisted. If that is who he is now, most of this problem goes away.")
clip(372.1, 453.2, "Castle's rookie misses, then the catch-and-shoot threes from his last 25 games.")
math_box("How much a hot stretch is worth",
    P("Three-point percentage is one of the noisiest numbers in basketball. Among players with 100 or more attempts, the true-talent spread is only about 2.5 percentage points, while a season of 300 attempts carries about 2.8 points of luck in either direction. I estimate the break-even sample, where a player's own record and the league average count equally, at about 350 to 370 attempts."),
    TEX(r"k = \frac{\bar{p}(1-\bar{p})}{\sigma^2_{\text{true}}} \approx \frac{0.365 \times 0.635}{0.0254^2} \approx 360 \text{ attempts}"),
    P("Free throws are the opposite. The true spread between players is about 8.5 points and the shot never changes, so the break-even sample is about 24 attempts. A month of free throws tells you more about a player's touch than a season of threes."),
    P("I tested hot finishes directly. Since 2012-13, there are 93 player-seasons in which a player shot at least 6 points better over their last 25 games than over the full season (with 60 or more attempts in that window). As a group they shot 37.0% on the season and 44.4% over the last 25. The next season they shot 37.1%. For the 23 of those seasons by players younger than 23, the next season was 37.4%. The hot finish added almost nothing to what the full season already said."))
argue('counter', "Counting the playoffs, his free throws moved too",
    P("In the video I said Castle's free-throw percentage never really moved, so the jump in his threes probably wasn't real. That used regular-season numbers only. Counting the playoffs, it did move. From October through February he shot 72.5% on 284 free throws. From March through the Finals he shot 79.2% on 236, and 81.6% in the playoffs alone. Free throws settle quickly, so a seven-point jump over 236 attempts is not noise."),
    P("Both numbers moved together: 29.3% from three before March, 38.2% after, on 170 attempts. That is the signature of real improvement. Harper's split is even sharper: 25.4% from three and 72.9% from the line before March, 42.4% and 83.7% after."))
argue('answer', "Late jumps in both haven't carried over",
    P("I checked whether a late free-throw jump predicts the next season beyond the full-season free-throw percentage. It doesn't (coefficient -0.05, standard error 0.03, over 1,015 player seasons). The 17 players whose late free throws and late threes both jumped shot 36.1% over the full season and 35.8% the next one. And Castle's playoff threes (35.0% on 100 attempts) came in below his late regular season."),
    P("The fairest reading is that Castle and Harper both improved, by less than their late numbers say. Free-throw percentage, measured over the whole year, carries most of that information."))
chart('projector', 'Project the three-point percentage yourself', caption="Start from what the player's free throws say about his touch, then add his three-point attempts. The sliders control how much weight the recent stretch and the playoffs get. The model marker is a fitted projection built from two seasons of threes, free throws and age, tested on 2,627 player seasons.", source=f"{SAV}; {NBA}", data='shooting.json')
math_box("The projection model",
    P("Prior from free throws: across 1,598 player seasons since 2019-20 with 100+ three-point attempts, the expected three-point percentage rises 0.17 points for every point of free-throw percentage, and the remaining true-talent spread around that line is 2.3 points, which is worth about 440 attempts of prior weight."),
    TEX(r"\mu_{\text{FT}} = 0.226 + 0.172 \cdot \text{FT\%} \qquad \hat{p} = \frac{k_{\text{FT}}\,\mu_{\text{FT}} + \sum_j w_j\,\text{3PM}_j}{k_{\text{FT}} + \sum_j w_j\,\text{3PA}_j}"),
    P("The fitted model behind the marker regresses next season's percentage on each of the last two seasons (each shrunk by its attempts), free-throw percentage over the same two seasons, age, and how far the last 25 games ran ahead of the season (a term that only carries weight for players under 23). Its projections: Castle 33.3%, Harper 36.0%, Fox 33.9%, Vassell 37.2%, Champagnie 37.8%. The leftover true-talent uncertainty is about 1.8 points, so an 80% range is about ±2.3 points."))
argue('verdict', 'Where it lands',
    P("Off the catch the gap is smaller than the season numbers say, but it's still there. My best estimates have Castle around 33 to 34% and Harper around 36% next season, against about 37 to 38% for Vassell and Champagnie. That is a gap of about 1 to 2 points (Harper) to 4 points (Castle) per shooter, and defenses already play to it."))

h3("Harper and Fox, going opposite ways")
p("Harper is the most interesting case because he is the youngest. He was 18.9 on draft day, younger than almost 80% of first-round picks since 2010. His late-season shooting (.657 true shooting over his last 25 games) came with rising free throws, which is the right signal, but his shot diet is the problem: only 27.1% of his shots were threes, 8th percentile among guards. A shooter the defense ignores doesn't space anything until he lets it fly.")
clip(512.2, 545.0, "Harper's threes from his last 25 games.")
p("Fox is going the other way. In his last full season in Sacramento he hit 36.9% on 7.8 threes a game while taking some of the hardest shots in the league (expected effective field-goal percentage .508, 5th percentile). In San Antonio he gets better looks (.535) and makes fewer. His late-season free throws dropped to 68.2%, which read as an injury flag, but he shot 75.8% from the line in the playoffs. He shot 24.6% from three in college and still had a 36.9% season, so he is proof that shooting can be built. It took him seven years.")
clip(591.4, 626.2, "Fox's step-back threes in Sacramento, then a miss from last April.")
chart('trend', 'Rolling shooting, game by game', caption="Rolling percentages over the chosen number of games, regular season and playoffs. Change the stat and the window to see how much a 25-game stretch can swing on its own.", source=NBA, data='trend.json')

# ------------------------------------------------------------------ 5. Spacing
h2('spacing', 'What spacing actually costs', 'Part 5')
p("Everyone agrees that three non-shooters crowd the paint. The useful question is how many points that costs, and the answer depends on how the defense decides who to leave open.")
chart('spacing', 'Who the defense helps off', caption="A simple help-defense model. When a guard drives, one defender leaves his man to help. The defense picks the man whose open three costs the least. Drag the percentages and watch the help move, and how much each drive is worth.", source="WCE model; wide-open percentages from NBA.com tracking", data='roster.json')
math_box("The help model",
    P("A drive that nobody helps on ends in a layup worth about V0 points. If a defender helps, the driver either finishes through contact (worth V1) or kicks it out, with probability q, to the man who was left open. The defense helps off whichever teammate's open three is worth the least:"),
    TEX(r"E[\text{drive}] = \min\Big(V_0,\; (1-q)\,V_1 + q \cdot 3\,p^{\text{open}}_{\min}\Big)"),
    P("With V0 = 1.25, V1 = 0.95 and q = 0.40 (the defaults), helping is almost always right, so what matters is who the help comes off. In last season's starting five, when Fox drove, the cheapest help came off Castle (37.3% on wide-open threes). Put Harper in for Vassell and it comes off Harper (33.1%), so every helped Fox drive is worth about 0.4 × 3 × 0.042 ≈ 0.05 points less. When Castle or Harper drives, the cheapest help comes off Fox (32.9%) in every version. That's the mechanism, and it shows where the cost lands: on the drives, which are the reason to play three drivers in the first place."))
argue('case', 'The lineup data says weak shooters cost points',
    P("Without controlling for talent, a lineup whose five players shoot one percentage point better from three on average scores 2.7 points per 100 more. (Each player's percentage is first shrunk toward the league average by his attempts, so one hot season doesn't swing it.) Swapping Harper in for Champagnie or Vassell lowers that average by about 0.37 points, which is about 1 point per 100."))
argue('counter', "Most of that is just the shooter's own makes",
    P("Most of that 2.7 is the shooters' own made threes, which their individual numbers already count. Once each player's own production is in the model (summed offensive Box Plus/Minus, with team-season effects), the extra effect of lineup shooting falls to +0.5 points per 100 per point of average three-point percentage, and it isn't statistically different from zero."),
    P("Counting weak shooters tells the same story. Lineups with no player under 34.5% beat their talent by about 1.1 points per 100. Lineups with one to four such players all landed within about a quarter point of their talent. Only the 97 units with five of them fell apart (-1.7)."))
argue('answer', "The cost is real, small on average, and bigger when it matters",
    P("Two things keep the cost from being zero. First, the lineup data is an average over regular-season possessions, where defenses don't scheme for one lineup. Second, the one place this trio did play real minutes was the playoffs, against defenses doing exactly that, and they shot a .414 effective field-goal percentage with an 81.9 offensive rating. Ninety-four possessions prove nothing, but they look exactly the way the model says they would."))
argue('verdict', 'Where it lands',
    P("Over a regular season, expect spacing to cost this lineup somewhere between a fraction of a point and about 1 point per 100 compared with a version that has a real shooter in Harper's spot. That's real, but it isn't a collapse. In a playoff series it can be more, which is the version of this lineup the Spurs care about."))

# ------------------------------------------------------------------ 6. Size and defense
h2('defense', 'Size and defense', 'Part 6')
p("The part people get wrong is size. Castle is 6'6\" and 215 pounds. Harper is 6'5\" and 215 with a 6'10½\" wingspan. Fox is the only small one, and that was already true.")
table("Defense, measured four ways",
      [{'k': 'p', 'label': 'Player'}, {'k': 'size', 'label': 'Height / weight'}, {'k': 'mtch', 'label': 'Matchup difficulty pct.', 'align': 'r'}, {'k': 'opp', 'label': 'Opp. FG% vs. expected', 'align': 'r'}, {'k': 'rim', 'label': 'Rim FG% vs. expected', 'align': 'r'}, {'k': 'pnr', 'label': 'P&R handler PPP allowed', 'align': 'r'}, {'k': 'iso', 'label': 'Isolation PPP allowed', 'align': 'r'}],
      [{'p': 'Castle', 'size': "6'6\" / 215", 'mtch': '99th', 'opp': '-2.2', 'rim': '-2.8', 'pnr': '0.759 (91st)', 'iso': '1.020 (32nd)'},
       {'p': 'Harper', 'size': "6'5\" / 215", 'mtch': '30th', 'opp': '-3.2', 'rim': '-3.9', 'pnr': '0.773 (87th)', 'iso': '0.581 (97th)'},
       {'p': 'Fox', 'size': "6'3\" / 185", 'mtch': '68th', 'opp': '-1.5', 'rim': '+2.0', 'pnr': '0.892 (44th)', 'iso': '0.895 (56th)'},
       {'p': 'Wembanyama', 'size': "7'4\" / 235", 'mtch': '33rd', 'opp': '-6.5', 'rim': '-8.6', 'pnr': '0.802 (80th)', 'iso': '1.245 (7th)'}],
      note="Negative opponent and rim numbers are better. Points per possession allowed are Synergy play types, with the percentile in parentheses; Harper's isolation number is 31 possessions.", source=f"{SAV}; {NBA}")
argue('case', 'Castle takes the hardest assignment, and the rest fall into place',
    P("Castle's matchup difficulty was 99th percentile. More than a third of his matchup possessions (35.9%) came against players with 25% usage or more, and his most frequent assignments were Keyonte George, Shai Gilgeous-Alexander, Luka Dončić and Cade Cunningham. That leaves Fox and Harper guarding guards, which is what they already do: 67% and 68% of their matchups were guards. As the on-ball defender in pick-and-roll, Castle allowed 0.759 points per possession (91st percentile) and Harper 0.773 (87th)."))
clip(662.7, 674.2, "Castle and Harper creating a turnover together.")
argue('counter', "Harper's numbers came against bench players, and Fox will be hunted",
    P("Harper's defensive numbers are phenomenal: opponents shot 3.2 points worse than expected against him, 87th percentile. But only 13.8% of his matchup possessions came against high-usage players, compared with 35.9% for Castle and 19.2% for Fox. His matchup difficulty was 30th percentile. Starting means guarding starters."),
    P("Fox is where teams will go. He weighs 185 pounds (7th percentile), opponents finished 2 points better than expected at the rim against him, and on pick-and-roll defense he allowed 0.892 points per possession, 44th percentile. With two bigger guards beside him, he becomes the obvious target in every switch."))
argue('answer', "The early evidence on both is better than the worry",
    P("Against the high-usage players Harper did face, he allowed 28.8 points per 100 partial possessions on 38.8% shooting. That's 80 shots, too few to settle it, but it isn't the collapse the counter predicts. Castle allowed 26.9 against the same tier and Fox 28.5."),
    P("Teams also didn't hunt Fox in isolation last season. Isolations were 4.6% of the plays he defended, fewer than Castle (6.1%) or Harper (6.1%), and he allowed 0.895 points per possession on them, 56th percentile. The pick-and-roll is where the risk sits, and that's exactly the action Wembanyama erases."))
argue('verdict', 'Where it lands',
    P("This is the strongest part of the case for the lineup. Castle and Harper are big, long and already good at the point of attack, and Fox's weakness is a pick-and-roll problem with the best rim protector in the world behind him. Opponents shot 8.6 points worse than expected at the rim with Wembanyama there, and his block rate was 9.4%, 99th percentile. With him behind them, the guards can gamble."))
clip(740.5, 750.4, "Why the guards can gamble at the point of attack.")

# ------------------------------------------------------------------ 7. Wemby
h2('wemby', 'The Wembanyama unlock', 'Part 7')
p("This is the part of the case that nobody really talks about. Last season the Spurs barely fed the roll man in pick-and-roll: just 4.3% of their plays, against a league average of 5.4%. When they did, they scored 1.263 points per play, 100th percentile. Cuts were the same story: 1.391 points per play (97th percentile) on only 6.0% of plays, against a league average of 6.8%. Their two most efficient plays were both ones they ran less often than the average team.")
chart('playtypes', 'How often the Spurs ran each play, and how well it worked', caption="Each dot is a play type: how often the Spurs used it against how many points it produced. The gray dots are the other 29 teams for the selected play. Roll man and cuts sit at the top, both used less than the league average: rare and elite.", source=NBA, data='playtypes.json')
p("Wembanyama's own mix shows where the points are hiding. Isolations and post-ups were 21.5% of his plays and produced about 0.90 points each (40th and 41st percentile). Rolls and cuts were 18.6% and produced about 1.39.")
math_box("What moving Wembanyama's plays is worth",
    P("Take 10% of Wembanyama's plays out of isolations and post-ups and turn them into rolls and cuts at last season's rates:"),
    TEX(r"\Delta = 0.10 \times (1.391 - 0.897) \approx 0.049 \text{ points per Wembanyama play}"),
    P("He used about 31.6 plays per 100 Spurs possessions, so that is about 31.6 × 0.049 ≈ 1.6 points per 100 possessions with him on the floor, from changing a tenth of his plays."))
argue('counter', 'Rare plays are efficient because they are rare',
    P("Teams run rolls and cuts when the defense gives them up. Run them more often and you start running them into defenses that are ready, and the efficiency falls. Any 1.391 points per play that comes from 6% of possessions would probably fall at 9%."))
argue('answer', "The league data doesn't show the drop",
    P("If that were true, teams that run more rolls and cuts would get less from them. They don't. Across the 30 teams, roll-man frequency and efficiency are unrelated (r = +0.06), and so are cut frequency and efficiency (r = +0.05). Among individual players with 50 or more possessions, the same (roll man r = 0.02 across 83 players; cuts -0.08 across 117). Cross-team data can't prove the drop wouldn't happen for the Spurs, but there's no sign of it."),
    P("And three handlers is how you create more of those looks without forcing them. Every guard who can turn the corner draws the big up, which is the moment Wembanyama rolls."))
clip(807.5, 838.3, "Fox and Castle setting up Wembanyama against Phoenix, and a Fox feed from last April.")
argue('verdict', 'Where it lands',
    P("This is the best argument for the lineup. Wembanyama's weakest numbers come when he has to create: his assist-to-turnover ratio was 1.3, 15th percentile. Three handlers mean he only creates when he wants to. This summer the three guards visited him in France, and his take on starting together was simple: more ball handlers make his job easier. The numbers agree with him."))

# ------------------------------------------------------------------ 8. Lineups
h2('lineups', 'What the lineup data says', 'Part 8')
p("Every pair of these guards was right around the team. Castle and Harper were +11.0 in 533 minutes, Fox and Castle +9.4 in 1,022, Fox and Harper +6.2 in 538, against the Spurs' +8.4 overall. Put any of them next to Wembanyama and it jumps: +16.9 with Fox, +17.0 with Castle and +27.0 with Harper in 560 minutes.")
chart('pairs', 'Two-man pairs, regular season', caption="Net rating per 100 possessions when both players were on the floor. Switch between the raw number, the luck-adjusted number and the sample-adjusted estimate. Hover a cell for the minutes.", source=SAV + '; sample adjustment per Basketball Savant (k = 1,221 for pairs)', data='lineups.json',
      players=['Wemby', 'Fox', 'Castle', 'Harper', 'Vassell', 'Champagnie', 'K. Johnson', 'Barnes'])
p("The guards fit with Wembanyama far better than they fit with each other, and that makes sense. Wembanyama is probably the easiest player in the league to fit next to. The weakest pair is Fox and Harper, the two who most want the ball in the same spots.")
chart('lineups', 'Every Spurs lineup, sortable', caption="Two- to five-man groups from the 2025-26 regular season and playoffs. Filter by player to find the trio, the pairs, or any combination. The sample-adjusted column is the one to trust under a few hundred possessions.", source=SAV + '; ' + NBA, data='lineups.json')
h3('The best lineup the Spurs had')
p("Harper, Castle, Vassell, Champagnie and Wembanyama played 27 minutes together last season and were +98.2 per 100 possessions. That is a tiny sample, but even after you adjust for it, it was the best five-man lineup the Spurs had. Watch what the adjustments do to it.")
chart('shrink', 'From +98.2 to +12.3', caption="Raw net rating, then the luck adjustment, then the pull toward the team's rating. Drag the possessions slider to see how many minutes a lineup needs before its own record outweighs the team's.", source=SAV,
      unit={'name': 'Harper, Castle, Vassell, Champagnie, Wembanyama', 'poss': 56, 'raw': 98.2, 'adj': 82.3, 'team': 7.6, 'k': 843})
argue('counter', 'Shrinking toward the team average is the wrong prior',
    P("Pulling every lineup toward the team's rating treats a unit with Wembanyama and four starters the same as a bench unit. A better prior would start from the five players' individual quality, and these five are better than an average Spurs lineup."))
argue('answer', 'Fair, and it barely changes the answer',
    P("Using a talent-based prior (the lineup model in Part 9) instead of the team's rating puts this unit's prior at about +12 instead of +7.6, and the estimate comes out near +16. Last season's starters get the same treatment and land near +14, so this five stays on top, by a little. What no prior can fix is 56 possessions."))

# ------------------------------------------------------------------ 9. Lab
h2('lab', 'Every possibility', 'Part 9')
p("Here's every reasonable starting five, run through the same model: talent from each player's offensive and defensive Box Plus/Minus, and an optional usage penalty in the spirit of Part 2 (-0.19 per point of usage over 100, fit here on luck-adjusted net rating rather than offense). The model was fit on 5,669 lineups, and among units with 400 or more possessions its predictions correlate with their luck-adjusted ratings at 0.59. Toggle the usage penalty to see how much the answer depends on it.")
chart('lab', 'Lineup lab', caption="Pick five. The estimate is a box-score projection, not a promise: it can't see spacing, fit or development. Where a five actually played together, its real numbers appear underneath.", source='WCE model fit on Basketball Savant lineups, 2018-19 to 2025-26', data='roster.json', lineups='lineups.json',
      presets=[{'label': 'Phoenix start', 'five': ['Fox', 'Castle', 'Harper', 'Vassell', 'Wemby']},
               {'label': 'Three guards + Champagnie', 'five': ['Fox', 'Castle', 'Harper', 'Champagnie', 'Wemby']},
               {'label': "Last season's starters", 'five': ['Fox', 'Castle', 'Vassell', 'Champagnie', 'Wemby']},
               {'label': 'The alternative five', 'five': ['Harper', 'Castle', 'Vassell', 'Champagnie', 'Wemby']},
               {'label': 'Fox and Harper, Castle to the bench', 'five': ['Fox', 'Harper', 'Vassell', 'Champagnie', 'Wemby']}])
p("The headline is how close they are. With the usage penalty on, every one of these fives projects between about +11 and +12 per 100. Turn it off and the three-guard fives move to the top. None of them separates from the others by more than the model's own error. On paper, the decision is a coin flip. It gets decided by who improves, which is why the next section is about development.")

# ------------------------------------------------------------------ 10. Verdict
h2('verdict', 'The verdict', 'Part 10')
p("So what does each player have to change, and can he actually do it?")
argue('verdict', 'Castle: become a catch-and-shoot threat and cut the turnovers',
    P("Needs: about 36% on catch-and-shoot threes with defenders actually closing out, and a turnover rate around 15%. The free throws from March on and the catch-and-shoot numbers say the shot is improving; the wide-open shooting says it isn't there yet. My estimate is a 33 to 34% three-point shooter next season, enough to stay on the floor and not enough to space it. The role that works keeps him in the two-man game with Wembanyama from the second side."))
argue('verdict', 'Harper: shoot more threes and hold up against starters',
    P("Needs: more threes (27.1% of his shots is 8th percentile among guards), more minutes per game, and defense against starters, which I think he's more than capable of. He's the youngest, his touch numbers are rising on both ends of the stat sheet, and he projects as the best shooter of the three. Of the three, he's the best bet to become a true knockdown shooter."))
argue('verdict', 'Fox: give up touches and survive switches',
    P("Needs: fewer pull-ups and a pick-and-roll defense that holds at 185 pounds. His usage already fell from 30% in Sacramento to 24%, and his efficiency went up when it did. He has done most of the adjusting already, even if his contract doesn't read as a player taking a back seat."))
argue('verdict', 'Wembanyama: roll and cut more',
    P("Needs: a different role, not a new skill. Roll and cut more, isolate and post less. He scored 1.246 points per play as a roller and 1.530 on cuts. He's more than capable of it, and probably ecstatic to do it."))
quote("It can work. But only if the fifth starter can really shoot, and only if Castle becomes a real catch-and-shoot threat.")
p("If both happen, this might be the Spurs' best lineup, and one of the best in the NBA. If neither does, the paint gets too crowded and you'll see Vassell come back into the lineup, maybe even for Fox. The numbers above put the downside at up to about 1 point per 100 from spacing and up to about 3 from shared usage, depending on the measuring stick, and the upside is the Wembanyama roll game plus a backcourt with real size. Against Phoenix, Vassell was the fifth starter with Champagnie out. By these numbers Champagnie is the better fit for that spot: fewer touches (14.6% usage), better wide-open shooting (49.7%) and a +11.0 luck-adjusted on/off, 98th percentile.")
p("Maybe down the line they try Harper, Castle, Vassell, Champagnie and Wembanyama, the five with the best sample-adjusted rating of any Spurs lineup last season (+12.3 on 56 possessions). There are contract and roster realities with Fox that make that harder than it looks on a spreadsheet. If they can make the three-guard version work, it's probably the best solution.")

# ------------------------------------------------------------------ 11. Watching
h2('watching', "What we're watching", 'Part 11')
p("Fifteen games is about how long it takes for a new starting lineup to tell you anything, and it tells you some things faster than others. Here's the checklist, with how much each number can actually move in 15 games.")
B.append({'t': 'checklist', 'items': [
    {'metric': "Castle's free-throw percentage", 'target': '78% or better', 'baseline': '73.4% last regular season, 79.2% from March on', 'why': "Free throws settle in about 24 attempts. Fifteen games is about 85 of them, enough to trust. This is the fastest real read on his shot."},
    {'metric': "How often Castle is left wide open", 'target': 'Under 60% of his threes', 'baseline': '72.5% last season', 'why': "If defenses start closing out on him, they believe the shot. That shows up before his percentage does."},
    {'metric': "Castle's catch-and-shoot 3P%", 'target': 'About 36%', 'baseline': '38.0% on mostly open looks', 'why': "About 45 attempts in 15 games, which is ±7 points of noise. Watch it, but don't believe it yet."},
    {'metric': "Share of Harper's shots that are threes", 'target': 'Up from 27%', 'baseline': '27.1% (8th percentile among guards)', 'why': "Shot selection settles much faster than shooting percentage. This one can be read in a few weeks."},
    {'metric': "Fox's free-throw percentage", 'target': 'Back near 76%', 'baseline': '68.2% over his last 25 regular-season games, 75.8% in the playoffs', 'why': "The late-season dip read as an injury flag. The playoffs say it wasn't one."},
    {'metric': 'How often the Spurs feed the roll man', 'target': 'More than 5.4% of plays', 'baseline': '4.3% (league average 5.4%)', 'why': "Their best play relative to the league (100th percentile). If three handlers don't make it more common, the main idea isn't working."},
    {'metric': "Castle's turnover rate", 'target': 'About 15%', 'baseline': '18.0%', 'why': "What the model expects from an off-ball role. Under 15 would mean the role change is doing more than expected."}]})
p("Would you start all three? Let me know in the comments under the video, and drop any other ideas for things we should research. We'll check back on the checklist regularly.")

# ------------------------------------------------------------------ Methods
h2('methods', 'Methods and sources')
B.append({'t': 'list', 'ordered': False, 'items': [
    "**Player and lineup numbers:** [Basketball Savant](https://wcehoops.com/basketball-savant.html) (2025-26, data dated July 13, 2026; regular season unless marked). Pre-draft numbers from [Draft Savant](https://wcehoops.com/draft-savant.html).",
    "**Game logs, lineups, on/off, tracking, play types and play-by-play:** NBA.com stats, pulled October 16, 2026, covering the 2025-26 regular season, the 2026 playoffs and the 2026 preseason. Lob counts are made field goals by Wembanyama tagged as alley-oops in the play-by-play, grouped by the assisting player.",
    "**Luck adjustment:** opponents' three-point and free-throw percentages reset to league average (35.96% and 78.29%). **Sample adjustment:** Basketball Savant's k (843 possessions for five-man units, 1,221 for pairs), interpolated to 1,079 for three-man groups and 954 for four-man groups.",
    "**Shooting studies:** Basketball Savant player seasons: the hot-streak study from 2012-13 on, the projection model from 2010-11 on and the free-throw prior from 2019-20 on. \"Last 25 games\" always means Basketball Savant's window, the team's last 25 regular-season games. The hot-streak study compares that window with the following season, with at least 100 three-point attempts in both seasons and 60 in the window.",
    "**Lineup studies:** every five-man unit in Basketball Savant's lineup files from 2018-19 to 2025-26 with five matched players (5,669 units), weighted by possessions.",
    "**Help-defense model:** a teaching model with stated assumptions, not a fitted one. The inputs you can change are on the chart.",
    "**Film:** [the video](https://youtu.be/svBxJqochlg). Clips play from the matching moment in it."]})

posters = {str(int(b['start']) if float(b['start']).is_integer() else b['start']): f"posters/clip-{int(b['start']) if float(b['start']).is_integer() else b['start']}.jpg" for b in B if b['t'] == 'clip'}
body = {'version': 1, 'posters': posters, 'blocks': B}
json.dump(body, open('/home/claude/spurs-article/export/body.json', 'w'), indent=1, ensure_ascii=False)
# word count of prose
def words(b):
    n = 0
    if isinstance(b, dict):
        for k, v in b.items():
            if k in ('md', 'text', 'title', 'caption', 'why', 'metric', 'target', 'baseline') and isinstance(v, str): n += len(v.split())
            elif isinstance(v, (list, dict)): n += words(v)
    elif isinstance(b, list):
        for x in b: n += words(x)
    return n
print('blocks', len(B), 'words', words(B))
