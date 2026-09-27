# -*- coding: utf-8 -*-
"""Who called the plays — hand-curated, like the coaching tree, because no open dataset has it.

Scheme belongs to the play-caller, not the head coach. Minnesota blitzed on 51% of 2025
dropbacks; that is Brian Flores's defence, and crediting it to Kevin O'Connell is wrong.
So every offensive and defensive snap from 2018 on is credited to the man who called it,
read from the table below.

FORMAT — one line per team-season:

    TEAM SEASON | O: caller[, caller from WEEK...] | D: caller[, caller from WEEK...]

  * "Name from 8" means he called it from week 8 on (the NFL schedule's week number).
  * A trailing "?" marks a row that is not confirmed by a source. The page shows those with
    an "unconfirmed" tag rather than stating them as fact.
  * "(shared with X)" is a note for readers of this file; the named man is credited.

Seasons before 2018 have no play-caller recorded, and a team-season missing from the table
falls back to its head coach, labelled as such on the page.

Sources: team sites, ESPN, NFL.com, PFT, beat reporting, checked Sept 2026. Rows without a
"?" were confirmed against at least one report naming the caller; the others are the
standing arrangement (the coordinator with the title) where nothing contradicts it.

HEAD-COACH FIXES
----------------
The nflverse schedule's coach columns stopped following in-season changes in 2024 and still
carry three 2025 head coaches into 2026. Before these fixes, Coaching Savant credited
Buffalo's 2026 to Sean McDermott and Tennessee's last eleven games of 2025 to Brian
Callahan. Each fix names the team, the first day the new man was in charge (the day after
the firing), and the man; every game on or after that date is his. Checked against Pro
Football Rumors' list of interim coaches since 2000 and the 2026 hires.
"""
import datetime

# (season, team, first_date_in_charge, coach) — games on/after the date go to `coach`
HC_FIXES = [
    (2015, 'MIA', '2015-10-06', 'Dan Campbell'),      # Joe Philbin fired Oct 5
    (2015, 'TEN', '2015-11-04', 'Mike Mularkey'),     # Ken Whisenhunt fired Nov 3
    (2016, 'LA',  '2016-12-13', 'John Fassel'),       # Jeff Fisher fired Dec 12
    (2019, 'CAR', '2019-12-04', 'Perry Fewell'),      # Ron Rivera fired Dec 3
    (2024, 'NYJ', '2024-10-09', 'Jeff Ulbrich'),      # Robert Saleh fired Oct 8
    (2024, 'NO',  '2024-11-05', 'Darren Rizzi'),      # Dennis Allen fired Nov 4
    (2024, 'CHI', '2024-11-30', 'Thomas Brown'),      # Matt Eberflus fired Nov 29
    (2025, 'TEN', '2025-10-14', 'Mike McCoy'),        # Brian Callahan fired Oct 13
    (2025, 'NYG', '2025-11-11', 'Mike Kafka'),        # Brian Daboll fired Nov 10
    (2026, 'ARI', '2026-01-01', 'Mike LaFleur'),      # 2026 hires the schedule missed
    (2026, 'ATL', '2026-01-01', 'Kevin Stefanski'),
    (2026, 'BUF', '2026-01-01', 'Joe Brady'),
]
# Spelling slips in the source
NAME_FIXES = {'Jay Rosburg': 'Jerry Rosburg', 'Klint Kubliak': 'Klint Kubiak'}


def fix_head_coaches(g):
    """Apply NAME_FIXES and HC_FIXES to a schedules frame in place-safe fashion."""
    g = g.copy()
    for col in ('home_coach', 'away_coach'):
        g[col] = g[col].replace(NAME_FIXES)
    for season, team, since, coach in HC_FIXES:
        for side in ('home', 'away'):
            m = (g.season == season) & (g[side + '_team'] == team) & (g.gameday >= since)
            g.loc[m, side + '_coach'] = coach
    return g


CALLERS_TEXT = """
ARI 2018 | O: Mike McCoy, Byron Leftwich from 8 | D: Al Holcomb
ARI 2019 | O: Kliff Kingsbury | D: Vance Joseph
ARI 2020 | O: Kliff Kingsbury | D: Vance Joseph
ARI 2021 | O: Kliff Kingsbury | D: Vance Joseph
ARI 2022 | O: Kliff Kingsbury | D: Vance Joseph
ARI 2023 | O: Drew Petzing | D: Nick Rallis
ARI 2024 | O: Drew Petzing | D: Nick Rallis
ARI 2025 | O: Drew Petzing | D: Nick Rallis
ARI 2026 | O: Mike LaFleur | D: Nick Rallis

ATL 2018 | O: Steve Sarkisian | D: Marquand Manuel
ATL 2019 | O: Dirk Koetter | D: Dan Quinn, Jeff Ulbrich from 6 (shared with Raheem Morris from 10)
ATL 2020 | O: Dirk Koetter | D: Raheem Morris, Jeff Ulbrich from 6
ATL 2021 | O: Arthur Smith | D: Dean Pees
ATL 2022 | O: Arthur Smith | D: Dean Pees
ATL 2023 | O: Arthur Smith | D: Ryan Nielsen
ATL 2024 | O: Zac Robinson | D: Jimmy Lake
ATL 2025 | O: Zac Robinson | D: Jeff Ulbrich
ATL 2026 | O: Tommy Rees | D: Jeff Ulbrich

BAL 2018 | O: Marty Mornhinweg | D: Don Martindale
BAL 2019 | O: Greg Roman | D: Don Martindale
BAL 2020 | O: Greg Roman | D: Don Martindale
BAL 2021 | O: Greg Roman | D: Don Martindale
BAL 2022 | O: Greg Roman | D: Mike Macdonald
BAL 2023 | O: Todd Monken | D: Mike Macdonald
BAL 2024 | O: Todd Monken | D: Zach Orr
BAL 2025 | O: Todd Monken | D: Zach Orr
BAL 2026 | O: Declan Doyle | D: Jesse Minter

BUF 2018 | O: Brian Daboll | D: Leslie Frazier
BUF 2019 | O: Brian Daboll | D: Leslie Frazier
BUF 2020 | O: Brian Daboll | D: Leslie Frazier
BUF 2021 | O: Brian Daboll | D: Leslie Frazier
BUF 2022 | O: Ken Dorsey | D: Leslie Frazier
BUF 2023 | O: Ken Dorsey, Joe Brady from 11 | D: Sean McDermott
BUF 2024 | O: Joe Brady | D: Bobby Babich
BUF 2025 | O: Joe Brady | D: Bobby Babich, Sean McDermott from 8 (shared with Babich)
BUF 2026 | O: Joe Brady | D: Jim Leonhard

CAR 2018 | O: Norv Turner | D: Eric Washington, Ron Rivera from 14
CAR 2019 | O: Norv Turner, Scott Turner from 14 | D: Ron Rivera, Perry Fewell from 14 (shared with Eric Washington)
CAR 2020 | O: Joe Brady | D: Phil Snow
CAR 2021 | O: Joe Brady, Jeff Nixon from 14 | D: Phil Snow
CAR 2022 | O: Ben McAdoo | D: Phil Snow, Al Holcomb from 6
CAR 2023 | O: Frank Reich, Thomas Brown from 8, Frank Reich from 11, Thomas Brown from 13 | D: Ejiro Evero
CAR 2024 | O: Dave Canales | D: Ejiro Evero
CAR 2025 | O: Dave Canales | D: Ejiro Evero
CAR 2026 | O: Brad Idzik | D: Ejiro Evero

CHI 2018 | O: Matt Nagy | D: Vic Fangio
CHI 2019 | O: Matt Nagy | D: Chuck Pagano
CHI 2020 | O: Matt Nagy, Bill Lazor from 10 | D: Chuck Pagano
CHI 2021 | O: Matt Nagy, Bill Lazor from 4 | D: Sean Desai
CHI 2022 | O: Luke Getsy | D: Alan Williams
CHI 2023 | O: Luke Getsy | D: Alan Williams, Matt Eberflus from 2
CHI 2024 | O: Shane Waldron, Thomas Brown from 11 | D: Eric Washington
CHI 2025 | O: Ben Johnson | D: Dennis Allen
CHI 2026 | O: Ben Johnson | D: Dennis Allen

CIN 2018 | O: Bill Lazor | D: Teryl Austin, Marvin Lewis from 11
CIN 2019 | O: Zac Taylor | D: Lou Anarumo
CIN 2020 | O: Zac Taylor | D: Lou Anarumo
CIN 2021 | O: Zac Taylor | D: Lou Anarumo
CIN 2022 | O: Zac Taylor | D: Lou Anarumo
CIN 2023 | O: Zac Taylor | D: Lou Anarumo
CIN 2024 | O: Zac Taylor | D: Lou Anarumo
CIN 2025 | O: Zac Taylor | D: Al Golden
CIN 2026 | O: Zac Taylor | D: Al Golden

CLE 2018 | O: Todd Haley, Freddie Kitchens from 9 | D: Gregg Williams
CLE 2019 | O: Freddie Kitchens | D: Steve Wilks
CLE 2020 | O: Kevin Stefanski | D: Joe Woods
CLE 2021 | O: Kevin Stefanski | D: Joe Woods
CLE 2022 | O: Kevin Stefanski | D: Joe Woods
CLE 2023 | O: Kevin Stefanski | D: Jim Schwartz
CLE 2024 | O: Kevin Stefanski, Ken Dorsey from 8 | D: Jim Schwartz
CLE 2025 | O: Kevin Stefanski, Tommy Rees from 10 | D: Jim Schwartz
CLE 2026 | O: Todd Monken | D: Mike Rutenberg

DAL 2018 | O: Scott Linehan | D: Kris Richard
DAL 2019 | O: Kellen Moore | D: Kris Richard
DAL 2020 | O: Kellen Moore | D: Mike Nolan
DAL 2021 | O: Kellen Moore | D: Dan Quinn
DAL 2022 | O: Kellen Moore | D: Dan Quinn
DAL 2023 | O: Mike McCarthy | D: Dan Quinn
DAL 2024 | O: Mike McCarthy | D: Mike Zimmer
DAL 2025 | O: Brian Schottenheimer | D: Matt Eberflus
DAL 2026 | O: Brian Schottenheimer | D: Christian Parker

DEN 2018 | O: Bill Musgrave | D: Joe Woods (shared with Vance Joseph)
DEN 2019 | O: Rich Scangarello | D: Vic Fangio
DEN 2020 | O: Pat Shurmur | D: Vic Fangio
DEN 2021 | O: Pat Shurmur | D: Vic Fangio
DEN 2022 | O: Nathaniel Hackett, Klint Kubiak from 11 | D: Ejiro Evero
DEN 2023 | O: Sean Payton | D: Vance Joseph
DEN 2024 | O: Sean Payton | D: Vance Joseph
DEN 2025 | O: Sean Payton | D: Vance Joseph
DEN 2026 | O: Davis Webb | D: Vance Joseph

DET 2018 | O: Jim Bob Cooter | D: Paul Pasqualoni? (reports split: some credit Matt Patricia)
DET 2019 | O: Darrell Bevell | D: Paul Pasqualoni
DET 2020 | O: Darrell Bevell | D: Cory Undlin
DET 2021 | O: Anthony Lynn, Dan Campbell from 10 | D: Aaron Glenn
DET 2022 | O: Ben Johnson | D: Aaron Glenn
DET 2023 | O: Ben Johnson | D: Aaron Glenn
DET 2024 | O: Ben Johnson | D: Aaron Glenn
DET 2025 | O: John Morton, Dan Campbell from 10 | D: Kelvin Sheppard
DET 2026 | O: Drew Petzing | D: Kelvin Sheppard

GB 2018 | O: Mike McCarthy, Joe Philbin from 14 | D: Mike Pettine
GB 2019 | O: Matt LaFleur | D: Mike Pettine
GB 2020 | O: Matt LaFleur | D: Mike Pettine
GB 2021 | O: Matt LaFleur | D: Joe Barry
GB 2022 | O: Matt LaFleur | D: Joe Barry
GB 2023 | O: Matt LaFleur | D: Joe Barry
GB 2024 | O: Matt LaFleur | D: Jeff Hafley
GB 2025 | O: Matt LaFleur | D: Jeff Hafley
GB 2026 | O: Matt LaFleur | D: Jonathan Gannon?

HOU 2018 | O: Bill O'Brien | D: Romeo Crennel
HOU 2019 | O: Bill O'Brien | D: Romeo Crennel?
HOU 2020 | O: Tim Kelly | D: Anthony Weaver
HOU 2021 | O: Tim Kelly | D: Lovie Smith
HOU 2022 | O: Pep Hamilton | D: Lovie Smith
HOU 2023 | O: Bobby Slowik | D: DeMeco Ryans
HOU 2024 | O: Bobby Slowik | D: DeMeco Ryans
HOU 2025 | O: Nick Caley | D: DeMeco Ryans, Matt Burke from 4
HOU 2026 | O: Nick Caley | D: Matt Burke

IND 2018 | O: Frank Reich | D: Matt Eberflus
IND 2019 | O: Frank Reich | D: Matt Eberflus
IND 2020 | O: Frank Reich | D: Matt Eberflus
IND 2021 | O: Frank Reich | D: Matt Eberflus
IND 2022 | O: Frank Reich, Parks Frazier from 10 | D: Gus Bradley
IND 2023 | O: Shane Steichen | D: Gus Bradley
IND 2024 | O: Shane Steichen | D: Gus Bradley
IND 2025 | O: Shane Steichen | D: Lou Anarumo
IND 2026 | O: Shane Steichen | D: Lou Anarumo

JAX 2018 | O: Nathaniel Hackett, Scott Milanovich from 13 | D: Todd Wash
JAX 2019 | O: John DeFilippo | D: Todd Wash
JAX 2020 | O: Jay Gruden | D: Todd Wash
JAX 2021 | O: Darrell Bevell | D: Joe Cullen
JAX 2022 | O: Doug Pederson (shared with Press Taylor) | D: Mike Caldwell
JAX 2023 | O: Press Taylor | D: Mike Caldwell
JAX 2024 | O: Press Taylor | D: Ryan Nielsen
JAX 2025 | O: Liam Coen | D: Anthony Campanile
JAX 2026 | O: Liam Coen | D: Anthony Campanile

KC 2018 | O: Andy Reid | D: Bob Sutton
KC 2019 | O: Andy Reid | D: Steve Spagnuolo
KC 2020 | O: Andy Reid | D: Steve Spagnuolo
KC 2021 | O: Andy Reid | D: Steve Spagnuolo
KC 2022 | O: Andy Reid | D: Steve Spagnuolo
KC 2023 | O: Andy Reid | D: Steve Spagnuolo
KC 2024 | O: Andy Reid | D: Steve Spagnuolo
KC 2025 | O: Andy Reid | D: Steve Spagnuolo
KC 2026 | O: Andy Reid | D: Steve Spagnuolo

LA 2018 | O: Sean McVay | D: Wade Phillips
LA 2019 | O: Sean McVay | D: Wade Phillips
LA 2020 | O: Sean McVay | D: Brandon Staley
LA 2021 | O: Sean McVay | D: Raheem Morris
LA 2022 | O: Sean McVay | D: Raheem Morris
LA 2023 | O: Sean McVay | D: Raheem Morris
LA 2024 | O: Sean McVay | D: Chris Shula
LA 2025 | O: Sean McVay | D: Chris Shula
LA 2026 | O: Sean McVay | D: Chris Shula

LAC 2018 | O: Ken Whisenhunt | D: Gus Bradley
LAC 2019 | O: Ken Whisenhunt, Shane Steichen from 9 | D: Gus Bradley
LAC 2020 | O: Shane Steichen | D: Gus Bradley
LAC 2021 | O: Joe Lombardi | D: Brandon Staley
LAC 2022 | O: Joe Lombardi | D: Brandon Staley
LAC 2023 | O: Kellen Moore | D: Brandon Staley, Derrick Ansley from 16
LAC 2024 | O: Greg Roman | D: Jesse Minter
LAC 2025 | O: Greg Roman | D: Jesse Minter
LAC 2026 | O: Mike McDaniel | D: Chris O'Leary

LV 2018 | O: Jon Gruden | D: Paul Guenther
LV 2019 | O: Jon Gruden | D: Paul Guenther
LV 2020 | O: Jon Gruden | D: Paul Guenther, Rod Marinelli from 15
LV 2021 | O: Jon Gruden, Greg Olson from 6 | D: Gus Bradley
LV 2022 | O: Josh McDaniels | D: Patrick Graham
LV 2023 | O: Josh McDaniels, Bo Hardegree from 9 | D: Patrick Graham
LV 2024 | O: Luke Getsy, Scott Turner from 11 | D: Patrick Graham
LV 2025 | O: Chip Kelly, Greg Olson from 13 | D: Patrick Graham
LV 2026 | O: Klint Kubiak | D: Rob Leonard

MIA 2018 | O: Adam Gase | D: Matt Burke
MIA 2019 | O: Chad O'Shea | D: Patrick Graham
MIA 2020 | O: Chan Gailey | D: Josh Boyer
MIA 2021 | O: George Godsey? (shared with Eric Studesville) | D: Josh Boyer?
MIA 2022 | O: Mike McDaniel | D: Josh Boyer
MIA 2023 | O: Mike McDaniel | D: Vic Fangio
MIA 2024 | O: Mike McDaniel | D: Anthony Weaver
MIA 2025 | O: Mike McDaniel | D: Anthony Weaver
MIA 2026 | O: Bobby Slowik | D: Jeff Hafley

MIN 2018 | O: John DeFilippo, Kevin Stefanski from 15 | D: Mike Zimmer
MIN 2019 | O: Kevin Stefanski | D: Mike Zimmer
MIN 2020 | O: Gary Kubiak | D: Mike Zimmer
MIN 2021 | O: Klint Kubiak | D: Mike Zimmer
MIN 2022 | O: Kevin O'Connell | D: Ed Donatell
MIN 2023 | O: Kevin O'Connell | D: Brian Flores
MIN 2024 | O: Kevin O'Connell | D: Brian Flores
MIN 2025 | O: Kevin O'Connell | D: Brian Flores
MIN 2026 | O: Kevin O'Connell | D: Brian Flores

NE 2018 | O: Josh McDaniels | D: Brian Flores
NE 2019 | O: Josh McDaniels | D: Steve Belichick
NE 2020 | O: Josh McDaniels | D: Steve Belichick
NE 2021 | O: Josh McDaniels | D: Steve Belichick
NE 2022 | O: Matt Patricia | D: Steve Belichick?
NE 2023 | O: Bill O'Brien | D: Steve Belichick
NE 2024 | O: Alex Van Pelt | D: DeMarcus Covington
NE 2025 | O: Josh McDaniels | D: Terrell Williams, Zak Kuhr from 2
NE 2026 | O: Josh McDaniels | D: Zak Kuhr

NO 2018 | O: Sean Payton | D: Dennis Allen
NO 2019 | O: Sean Payton | D: Dennis Allen
NO 2020 | O: Sean Payton | D: Dennis Allen
NO 2021 | O: Sean Payton | D: Dennis Allen
NO 2022 | O: Pete Carmichael | D: Dennis Allen
NO 2023 | O: Pete Carmichael | D: Dennis Allen
NO 2024 | O: Klint Kubiak | D: Dennis Allen, Joe Woods from 10
NO 2025 | O: Kellen Moore | D: Brandon Staley
NO 2026 | O: Kellen Moore | D: Brandon Staley

NYG 2018 | O: Pat Shurmur | D: James Bettcher
NYG 2019 | O: Pat Shurmur | D: James Bettcher
NYG 2020 | O: Jason Garrett | D: Patrick Graham
NYG 2021 | O: Jason Garrett, Freddie Kitchens from 12 | D: Patrick Graham
NYG 2022 | O: Mike Kafka | D: Don Martindale
NYG 2023 | O: Mike Kafka | D: Don Martindale
NYG 2024 | O: Brian Daboll | D: Shane Bowen
NYG 2025 | O: Mike Kafka | D: Shane Bowen, Charlie Bullen from 13
NYG 2026 | O: Matt Nagy | D: Dennard Wilson?

NYJ 2018 | O: Jeremy Bates | D: Kacy Rodgers
NYJ 2019 | O: Adam Gase | D: Gregg Williams
NYJ 2020 | O: Adam Gase, Dowell Loggains from 7, Adam Gase from 11? | D: Gregg Williams, Frank Bush from 14
NYJ 2021 | O: Mike LaFleur | D: Jeff Ulbrich
NYJ 2022 | O: Mike LaFleur | D: Jeff Ulbrich
NYJ 2023 | O: Nathaniel Hackett | D: Jeff Ulbrich
NYJ 2024 | O: Nathaniel Hackett, Todd Downing from 6 | D: Jeff Ulbrich
NYJ 2025 | O: Tanner Engstrand | D: Steve Wilks, Chris Harris from 16
NYJ 2026 | O: Frank Reich | D: Aaron Glenn

PHI 2018 | O: Doug Pederson | D: Jim Schwartz
PHI 2019 | O: Doug Pederson | D: Jim Schwartz
PHI 2020 | O: Doug Pederson | D: Jim Schwartz
PHI 2021 | O: Nick Sirianni? (Shane Steichen took over at some point in the season; week not found) | D: Jonathan Gannon
PHI 2022 | O: Shane Steichen | D: Jonathan Gannon
PHI 2023 | O: Brian Johnson | D: Sean Desai, Matt Patricia from 15
PHI 2024 | O: Kellen Moore | D: Vic Fangio
PHI 2025 | O: Kevin Patullo | D: Vic Fangio
PHI 2026 | O: Sean Mannion | D: Vic Fangio

PIT 2018 | O: Randy Fichtner | D: Mike Tomlin
PIT 2019 | O: Randy Fichtner | D: Mike Tomlin
PIT 2020 | O: Randy Fichtner | D: Mike Tomlin
PIT 2021 | O: Matt Canada | D: Mike Tomlin
PIT 2022 | O: Matt Canada | D: Teryl Austin
PIT 2023 | O: Matt Canada, Mike Sullivan from 12 | D: Teryl Austin
PIT 2024 | O: Arthur Smith | D: Teryl Austin
PIT 2025 | O: Arthur Smith | D: Teryl Austin
PIT 2026 | O: Mike McCarthy | D: Patrick Graham

SEA 2018 | O: Brian Schottenheimer | D: Ken Norton Jr.
SEA 2019 | O: Brian Schottenheimer | D: Ken Norton Jr.
SEA 2020 | O: Brian Schottenheimer | D: Ken Norton Jr.
SEA 2021 | O: Shane Waldron | D: Ken Norton Jr.
SEA 2022 | O: Shane Waldron | D: Clint Hurtt
SEA 2023 | O: Shane Waldron | D: Clint Hurtt
SEA 2024 | O: Ryan Grubb | D: Mike Macdonald
SEA 2025 | O: Klint Kubiak | D: Mike Macdonald
SEA 2026 | O: Brian Fleury | D: Mike Macdonald

SF 2018 | O: Kyle Shanahan | D: Robert Saleh
SF 2019 | O: Kyle Shanahan | D: Robert Saleh
SF 2020 | O: Kyle Shanahan | D: Robert Saleh
SF 2021 | O: Kyle Shanahan | D: DeMeco Ryans
SF 2022 | O: Kyle Shanahan | D: DeMeco Ryans
SF 2023 | O: Kyle Shanahan | D: Steve Wilks
SF 2024 | O: Kyle Shanahan | D: Nick Sorensen
SF 2025 | O: Kyle Shanahan | D: Robert Saleh
SF 2026 | O: Kyle Shanahan | D: Raheem Morris

TB 2018 | O: Todd Monken, Dirk Koetter from 10, Todd Monken from 11 | D: Mike Smith, Mark Duffner from 7
TB 2019 | O: Byron Leftwich | D: Todd Bowles
TB 2020 | O: Byron Leftwich | D: Todd Bowles
TB 2021 | O: Byron Leftwich | D: Todd Bowles
TB 2022 | O: Byron Leftwich | D: Todd Bowles
TB 2023 | O: Dave Canales | D: Todd Bowles
TB 2024 | O: Liam Coen | D: Todd Bowles
TB 2025 | O: Josh Grizzard | D: Todd Bowles
TB 2026 | O: Zac Robinson | D: Todd Bowles

TEN 2018 | O: Matt LaFleur | D: Dean Pees
TEN 2019 | O: Arthur Smith | D: Dean Pees
TEN 2020 | O: Arthur Smith | D: Shane Bowen
TEN 2021 | O: Todd Downing | D: Shane Bowen
TEN 2022 | O: Todd Downing | D: Shane Bowen
TEN 2023 | O: Tim Kelly | D: Shane Bowen
TEN 2024 | O: Brian Callahan | D: Dennard Wilson
TEN 2025 | O: Brian Callahan, Bo Hardegree from 4 | D: Dennard Wilson
TEN 2026 | O: Brian Daboll | D: Robert Saleh

WAS 2018 | O: Jay Gruden | D: Greg Manusky
WAS 2019 | O: Jay Gruden, Kevin O'Connell from 6 | D: Greg Manusky
WAS 2020 | O: Scott Turner | D: Jack Del Rio
WAS 2021 | O: Scott Turner | D: Jack Del Rio
WAS 2022 | O: Scott Turner | D: Jack Del Rio
WAS 2023 | O: Eric Bieniemy | D: Jack Del Rio, Ron Rivera from 13
WAS 2024 | O: Kliff Kingsbury | D: Joe Whitt Jr.
WAS 2025 | O: Kliff Kingsbury | D: Joe Whitt Jr., Dan Quinn from 11
WAS 2026 | O: David Blough | D: Daronte Jones
"""


def _parse():
    """-> {(season, team, side): [(first_week, name, confirmed), ...]} in week order."""
    out = {}
    for raw in CALLERS_TEXT.strip().splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        head, *parts = [p.strip() for p in line.split('|')]
        team, season = head.split()
        for part in parts:
            side, spec = part.split(':', 1)
            spell = []
            for i, chunk in enumerate(spec.split(',')):
                chunk = chunk.split('(')[0].strip()      # drop reader notes
                sure = not chunk.endswith('?')
                chunk = chunk.rstrip('?').strip()
                wk = 1
                if ' from ' in chunk:
                    chunk, w = chunk.rsplit(' from ', 1)
                    wk = int(w.rstrip('?').strip())
                    chunk = chunk.strip()
                if i and wk == 1:
                    raise ValueError('later caller needs "from WEEK": ' + line)
                spell.append((wk, chunk, sure))
            out[(int(season), team, side.strip())] = spell
    return out


CALLERS = _parse()
FIRST_SEASON = min(k[0] for k in CALLERS)


def caller(season, team, side, week):
    """The man who called `side` ('O' or 'D') for `team` in that week, and whether that is
    confirmed. None when the table has no row (the page then falls back to the head coach)."""
    spell = CALLERS.get((season, team, side))
    if not spell:
        return None
    pick = spell[0]
    for s in spell:
        if week >= s[0]:
            pick = s
    return pick[1], pick[2]


if __name__ == '__main__':
    import collections
    seasons = collections.Counter(k[0] for k in CALLERS)
    unsure = sum(1 for v in CALLERS.values() for s in v if not s[2])
    print('rows by season:', dict(sorted(seasons.items())))
    print('caller spells:', sum(len(v) for v in CALLERS.values()), '— unconfirmed:', unsure)
    for k, v in sorted(CALLERS.items()):
        for wk, name, sure in v:
            if not sure:
                print('  ?', k[0], k[1], k[2], name, ('from %d' % wk) if wk > 1 else '')
