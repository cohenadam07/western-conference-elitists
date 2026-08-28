# -*- coding: utf-8 -*-
"""The coaching tree — hand-curated, because no open dataset records who assisted whom.

Everything else in Coaching Savant is computed from nflverse. This file is not: it is
written down from the public record of who worked for whom, and it is the one part of the
feature that can simply be wrong. It is deliberately a single flat, editable file so a
correction is a one-line change.

Two honest caveats, both surfaced in the UI:

  A tree has one parent per node; a career doesn't. Most coaches were shaped by several
  people, so each entry carries a primary `mentor` — normally the man he first coordinated
  under — and an optional `also` list for the other major influence. The drawn tree follows
  the primary; a coach's own page shows both.

  Coaches with no entry are shown as roots of their own. That means "not recorded here",
  not "self-taught".

`role` describes the job he held under that mentor. Years are given only where they are
firmly established.
"""

TREE_NOTE = (
    "Who coached under whom is not in any open dataset — this lineage is hand-curated from "
    "the public record and is the one part of Coaching Savant that can be wrong. A tree "
    "allows one parent per coach, but a career has several; each man is placed under the "
    "coach he first coordinated for, with other major influences listed on his own page. "
    "A coach shown as a root is one whose mentor simply isn't recorded here."
)

# The founders. Everything below eventually hangs off one of these.
ROOTS = [
    'Paul Brown', 'Sid Gillman', 'Vince Lombardi', 'Tom Landry', 'Don Shula',
    'Bud Grant', 'Don Coryell', 'Bill Parcells', 'Marty Schottenheimer',
    'Jimmy Johnson', 'Dick Vermeil', 'Bum Phillips', 'Chuck Knox',
]

def _t(mentor, role, also=None):
    d = dict(mentor=mentor, role=role)
    if also:
        d['also'] = also
    return d

TREE = {
    # ── the founding generation ────────────────────────────────────────────────
    'Weeb Ewbank':      _t('Paul Brown', 'assistant, Cleveland Browns'),
    'Bill Walsh':       _t('Paul Brown', 'offensive coordinator, Cincinnati Bengals, 1968–75'),
    'Chuck Noll':       _t('Sid Gillman', 'assistant, San Diego Chargers',
                           [dict(mentor='Don Shula', role='defensive coordinator, Baltimore Colts')]),
    'Dan Reeves':       _t('Tom Landry', 'assistant and offensive coordinator, Dallas Cowboys'),
    'Mike Ditka':       _t('Tom Landry', 'assistant, Dallas Cowboys'),
    'Joe Gibbs':        _t('Don Coryell', 'offensive coordinator, San Diego Chargers'),
    'Buddy Ryan':       _t('Weeb Ewbank', 'defensive line, New York Jets'),
    'Wade Phillips':    _t('Bum Phillips', 'assistant, Houston Oilers and New Orleans Saints'),
    'Bill Cowher':      _t('Marty Schottenheimer', 'defensive coordinator, Kansas City Chiefs'),
    'Tony Dungy':       _t('Chuck Noll', 'defensive coordinator, Pittsburgh Steelers, 1984–88'),
    'Dave Wannstedt':   _t('Jimmy Johnson', 'defensive coordinator, Dallas Cowboys'),
    'Butch Davis':      _t('Jimmy Johnson', 'defensive coordinator, Dallas Cowboys'),
    'Norv Turner':      _t('Jimmy Johnson', 'offensive coordinator, Dallas Cowboys, 1991–93'),
    'Bobby Ross':       _t('Chuck Knox', 'assistant'),
    'Jim Mora':         _t('Bum Phillips', 'assistant'),

    # ── the Walsh branch ───────────────────────────────────────────────────────
    'George Seifert':   _t('Bill Walsh', 'defensive coordinator, San Francisco 49ers'),
    'Mike Holmgren':    _t('Bill Walsh', 'quarterbacks then offensive coordinator, San Francisco 49ers'),
    'Dennis Green':     _t('Bill Walsh', 'assistant, San Francisco 49ers'),
    'Ray Rhodes':       _t('Bill Walsh', 'defensive backs and coordinator, San Francisco 49ers'),
    'Pete Carroll':     _t('George Seifert', 'defensive coordinator, San Francisco 49ers, 1995'),
    'Mike Shanahan':    _t('Dan Reeves', 'offensive coordinator, Denver Broncos, 1984–87',
                           [dict(mentor='George Seifert', role='offensive coordinator, San Francisco 49ers, 1992–94')]),
    'Brian Billick':    _t('Dennis Green', 'offensive coordinator, Minnesota Vikings'),
    'Steve Mariucci':   _t('Mike Holmgren', 'quarterbacks, Green Bay Packers'),
    'Andy Reid':        _t('Mike Holmgren', 'quarterbacks and assistant head coach, Green Bay Packers, 1992–98'),
    'Jon Gruden':       _t('Mike Holmgren', 'offensive assistant, Green Bay Packers'),
    'Mike Sherman':     _t('Mike Holmgren', 'assistant, Green Bay Packers and Seattle Seahawks'),
    'Marty Mornhinweg': _t('Mike Holmgren', 'offensive coordinator, Green Bay Packers'),
    'Dick Jauron':      _t('Ray Rhodes', 'defensive coordinator, Philadelphia Eagles'),
    'Jim Haslett':      _t('Bill Cowher', 'assistant, Pittsburgh Steelers'),

    # ── Andy Reid's own branch ─────────────────────────────────────────────────
    'John Harbaugh':    _t('Andy Reid', 'special teams and defensive backs, Philadelphia Eagles, 1998–2007'),
    'Brad Childress':   _t('Andy Reid', 'offensive coordinator, Philadelphia Eagles'),
    'Sean McDermott':   _t('Andy Reid', 'defensive backs and coordinator, Philadelphia Eagles'),
    'Doug Pederson':    _t('Andy Reid', 'offensive coordinator, Kansas City Chiefs'),
    'Pat Shurmur':      _t('Andy Reid', 'assistant, Philadelphia Eagles'),
    'Matt Nagy':        _t('Andy Reid', 'offensive coordinator, Kansas City Chiefs'),
    'Todd Bowles':      _t('Andy Reid', 'defensive backs, Philadelphia Eagles',
                           [dict(mentor='Bruce Arians', role='defensive coordinator, Arizona Cardinals')]),
    'Ron Rivera':       _t('Andy Reid', 'linebackers, Philadelphia Eagles',
                           [dict(mentor='Lovie Smith', role='defensive coordinator, Chicago Bears')]),
    'Frank Reich':      _t('Doug Pederson', 'offensive coordinator, Philadelphia Eagles'),
    'Nick Sirianni':    _t('Frank Reich', 'offensive coordinator, Indianapolis Colts'),
    'Shane Steichen':   _t('Nick Sirianni', 'offensive coordinator, Philadelphia Eagles'),
    'Jonathan Gannon':  _t('Nick Sirianni', 'defensive coordinator, Philadelphia Eagles'),
    'Kellen Moore':     _t('Nick Sirianni', 'offensive coordinator, Philadelphia Eagles'),
    'Jay Gruden':       _t('Jon Gruden', 'assistant, Tampa Bay Buccaneers'),
    'Raheem Morris':    _t('Jon Gruden', 'defensive backs, Tampa Bay Buccaneers',
                           [dict(mentor='Sean McVay', role='defensive coordinator, Los Angeles Rams')]),

    # ── the Shanahan branch ────────────────────────────────────────────────────
    'Gary Kubiak':      _t('Mike Shanahan', 'offensive coordinator, Denver Broncos, 1995–2005'),
    'Kyle Shanahan':    _t('Mike Shanahan', 'offensive coordinator, Washington, 2010–13',
                           [dict(mentor='Gary Kubiak', role='offensive coordinator, Houston Texans')]),
    'Sean McVay':       _t('Kyle Shanahan', 'tight ends under him in Washington, then offensive coordinator',
                           [dict(mentor='Jon Gruden', role='assistant, Tampa Bay Buccaneers')]),
    'Matt LaFleur':     _t('Sean McVay', 'offensive coordinator, Los Angeles Rams',
                           [dict(mentor='Kyle Shanahan', role='quarterbacks, Atlanta Falcons')]),
    'Mike McDaniel':    _t('Kyle Shanahan', 'offensive coordinator, San Francisco 49ers'),
    'Zac Taylor':       _t('Sean McVay', 'quarterbacks, Los Angeles Rams'),
    'Kevin O\'Connell': _t('Sean McVay', 'offensive coordinator, Los Angeles Rams'),
    'Liam Coen':        _t('Sean McVay', 'offensive coordinator, Los Angeles Rams'),
    'Robert Saleh':     _t('Kyle Shanahan', 'defensive coordinator, San Francisco 49ers',
                           [dict(mentor='Pete Carroll', role='assistant, Seattle Seahawks')]),
    'DeMeco Ryans':     _t('Robert Saleh', 'linebackers then defensive coordinator, San Francisco 49ers'),
    'Mike McCoy':       _t('Mike Shanahan', 'assistant, Denver Broncos'),
    'Nathaniel Hackett':_t('Matt LaFleur', 'offensive coordinator, Green Bay Packers'),
    'Klint Kubiak':     _t('Gary Kubiak', 'assistant, Minnesota Vikings'),
    'Kevin Stefanski':  _t('Gary Kubiak', 'offensive coordinator under him, Minnesota Vikings'),
    'Arthur Smith':     _t('Mike Vrabel', 'offensive coordinator, Tennessee Titans'),
    'Dave Canales':     _t('Pete Carroll', 'quarterbacks, Seattle Seahawks'),
    'Darrell Bevell':   _t('Pete Carroll', 'offensive coordinator, Seattle Seahawks'),
    'Gus Bradley':      _t('Pete Carroll', 'defensive coordinator, Seattle Seahawks'),
    'Dan Quinn':        _t('Pete Carroll', 'defensive coordinator, Seattle Seahawks, 2013–14'),
    'Mike Macdonald':   _t('John Harbaugh', 'linebackers then defensive coordinator, Baltimore Ravens'),

    # ── Parcells and Belichick ─────────────────────────────────────────────────
    'Bill Belichick':   _t('Bill Parcells', 'defensive coordinator, New York Giants, 1985–90'),
    'Tom Coughlin':     _t('Bill Parcells', 'wide receivers, New York Giants'),
    'Sean Payton':      _t('Bill Parcells', 'assistant head coach, Dallas Cowboys',
                           [dict(mentor='Jim Fassel', role='offensive coordinator, New York Giants')]),
    'Todd Haley':       _t('Bill Parcells', 'assistant, Dallas Cowboys'),
    'Al Groh':          _t('Bill Parcells', 'assistant, New York Giants and New England Patriots'),
    'Mike Zimmer':      _t('Bill Parcells', 'defensive coordinator, Dallas Cowboys'),
    'Romeo Crennel':    _t('Bill Belichick', 'defensive coordinator, New England Patriots'),
    'Eric Mangini':     _t('Bill Belichick', 'defensive coordinator, New England Patriots'),
    'Josh McDaniels':   _t('Bill Belichick', 'offensive coordinator, New England Patriots'),
    'Bill O\'Brien':    _t('Bill Belichick', 'offensive coordinator, New England Patriots'),
    'Matt Patricia':    _t('Bill Belichick', 'defensive coordinator, New England Patriots'),
    'Brian Flores':     _t('Bill Belichick', 'defensive play-caller, New England Patriots'),
    'Joe Judge':        _t('Bill Belichick', 'special teams coordinator, New England Patriots'),
    'Jerod Mayo':       _t('Bill Belichick', 'linebackers, New England Patriots'),
    'Nick Saban':       _t('Bill Belichick', 'defensive coordinator, Cleveland Browns, 1991–94'),
    'Jim Schwartz':     _t('Bill Belichick', 'scout and assistant, Cleveland Browns'),
    'Brian Daboll':     _t('Bill Belichick', 'assistant and coordinator, New England Patriots'),
    'Mike Vrabel':      _t('Bill O\'Brien', 'linebackers then defensive coordinator, Houston Texans'),
    'Jason Garrett':    _t('Wade Phillips', 'offensive coordinator, Dallas Cowboys'),
    'Dan Campbell':     _t('Sean Payton', 'tight ends, New Orleans Saints'),
    'Dennis Allen':     _t('Sean Payton', 'defensive coordinator, New Orleans Saints'),
    'Aaron Glenn':      _t('Dan Campbell', 'defensive coordinator, Detroit Lions'),
    'Ben Johnson':      _t('Dan Campbell', 'offensive coordinator, Detroit Lions'),
    'Joe Vitt':         _t('Sean Payton', 'assistant head coach, New Orleans Saints'),
    'Doug Marrone':     _t('Sean Payton', 'offensive coordinator, New Orleans Saints'),
    'Steve Spagnuolo':  _t('Jim Johnson', 'assistant under him, Philadelphia Eagles'),
    'Jim Johnson':      _t('Ray Rhodes', 'defensive coordinator, Philadelphia Eagles'),

    # ── Dungy and the Tampa 2 ──────────────────────────────────────────────────
    'Lovie Smith':      _t('Tony Dungy', 'linebackers, Tampa Bay Buccaneers'),
    'Herm Edwards':     _t('Tony Dungy', 'assistant head coach, Tampa Bay Buccaneers'),
    'Mike Tomlin':      _t('Tony Dungy', 'defensive backs, Tampa Bay Buccaneers',
                           [dict(mentor='Bill Cowher', role='succeeded him in Pittsburgh')]),
    'Rod Marinelli':    _t('Tony Dungy', 'defensive line, Tampa Bay Buccaneers'),
    'Jim Caldwell':     _t('Tony Dungy', 'assistant head coach, Indianapolis Colts'),
    'Leslie Frazier':   _t('Tony Dungy', 'defensive backs, Indianapolis Colts'),
    'Monte Kiffin':     _t('Tony Dungy', 'defensive coordinator, Tampa Bay Buccaneers'),
    'Mike Smith':       _t('Jack Del Rio', 'defensive coordinator, Jacksonville Jaguars'),
    'Marvin Lewis':     _t('Brian Billick', 'defensive coordinator, Baltimore Ravens'),
    'Jack Del Rio':     _t('Brian Billick', 'assistant, Baltimore Ravens'),
    'Rex Ryan':         _t('Buddy Ryan', 'his father; defensive coordinator, Baltimore Ravens'),
    'Rob Ryan':         _t('Buddy Ryan', 'his father'),
    'Jeff Fisher':      _t('Buddy Ryan', 'defensive coordinator, Philadelphia Eagles'),
    'Dom Capers':       _t('Bill Cowher', 'defensive coordinator, Pittsburgh Steelers'),
    'Vic Fangio':       _t('Dom Capers', 'defensive coordinator under him, Carolina Panthers'),
    'Brandon Staley':   _t('Vic Fangio', 'outside linebackers, Chicago Bears and Denver Broncos'),
    'Chuck Pagano':     _t('John Harbaugh', 'defensive coordinator, Baltimore Ravens'),
    'Bruce Arians':     _t('Mike Tomlin', 'offensive coordinator, Pittsburgh Steelers'),
    'Ken Whisenhunt':   _t('Bill Cowher', 'offensive coordinator, Pittsburgh Steelers'),
    'Mike Mularkey':    _t('Bill Cowher', 'offensive coordinator, Pittsburgh Steelers'),
    'Matt Eberflus':    _t('Rod Marinelli', 'assistant, Dallas Cowboys'),
    'Steve Wilks':      _t('Ron Rivera', 'defensive coordinator, Carolina Panthers'),
    'Vance Joseph':     _t('Gary Kubiak', 'defensive backs, Houston Texans'),
    'Mike Pettine':     _t('Rex Ryan', 'defensive coordinator, New York Jets and Buffalo Bills'),
    'Anthony Lynn':     _t('Rex Ryan', 'assistant, New York Jets and Buffalo Bills'),
    'Adam Gase':        _t('Mike McCoy', 'quarterbacks under him, Denver Broncos'),
    'Brian Callahan':   _t('Zac Taylor', 'offensive coordinator, Cincinnati Bengals'),
    'Mike McCarthy':    _t('Marty Schottenheimer', 'quarterbacks, Kansas City Chiefs'),
    'Brian Schottenheimer': _t('Marty Schottenheimer', 'his father; assistant, Washington'),
    'Gunther Cunningham': _t('Marty Schottenheimer', 'defensive coordinator, Kansas City Chiefs'),
    'Bill Callahan':    _t('Jon Gruden', 'offensive coordinator, Oakland Raiders'),
    'Tom Cable':        _t('Bill Callahan', 'assistant'),
    'Mike Tice':        _t('Dennis Green', 'assistant, Minnesota Vikings'),
    'Scott Linehan':    _t('Mike Tice', 'offensive coordinator, Minnesota Vikings'),
    'Mike Martz':       _t('Dick Vermeil', 'offensive coordinator, St. Louis Rams'),
    'Joe Philbin':      _t('Mike McCarthy', 'offensive coordinator, Green Bay Packers'),
    'Dirk Koetter':     _t('Lovie Smith', 'offensive coordinator, Tampa Bay Buccaneers'),
    'Freddie Kitchens': _t('Hue Jackson', 'assistant, Cleveland Browns'),
    'Rob Chudzinski':   _t('Norv Turner', 'offensive coordinator, San Diego Chargers'),
    'Cam Cameron':      _t('Norv Turner', 'offensive coordinator, San Diego Chargers'),
    'Hue Jackson':      _t('Marvin Lewis', 'offensive coordinator, Cincinnati Bengals'),
    'Mike Nolan':       _t('Mike Shanahan', 'defensive coordinator, Denver Broncos'),
    'Mike Singletary':  _t('Mike Nolan', 'assistant head coach, San Francisco 49ers'),
    'Jim Tomsula':      _t('Mike Singletary', 'defensive line, San Francisco 49ers'),
    'Perry Fewell':     _t('Tom Coughlin', 'defensive coordinator, New York Giants'),
    'Ben McAdoo':       _t('Tom Coughlin', 'offensive coordinator, New York Giants'),
    'Terry Robiskie':   _t('Norv Turner', 'assistant, Washington'),
    'Aaron Kromer':     _t('Sean Payton', 'offensive line, New Orleans Saints'),
    'Eric Studesville': _t('Josh McDaniels', 'running backs, Denver Broncos'),
    'Rich Bisaccia':    _t('Jon Gruden', 'special teams, Tampa Bay Buccaneers'),
    'Chris Tabor':      _t('Pat Shurmur', 'special teams, Cleveland Browns'),
    'Jay Rosburg':      _t('John Harbaugh', 'special teams, Baltimore Ravens'),
    'Giff Smith':       _t('Brandon Staley', 'defensive line, Los Angeles Chargers'),
    'Antonio Pierce':   _t('Josh McDaniels', 'linebackers, Las Vegas Raiders'),
    'Mel Tucker':       _t('Nick Saban', 'assistant, Michigan State and NFL'),
    'Gregg Williams':   _t('Jeff Fisher', 'defensive coordinator, Tennessee Titans'),
    'Dave McGinnis':    _t('Vince Tobin', 'defensive coordinator, Arizona Cardinals'),
    'Vince Tobin':      _t('Mike Ditka', 'defensive coordinator, Chicago Bears'),
    'Jim Fassel':       _t('Dan Reeves', 'offensive coordinator, Denver Broncos'),
    'Dave Campo':       _t('Jimmy Johnson', 'defensive backs, Dallas Cowboys'),
    'Tony Sparano':     _t('Bill Parcells', 'assistant, Dallas Cowboys'),
    'Bruce Coslet':     _t('Sam Wyche', 'offensive coordinator, Cincinnati Bengals'),
    'Sam Wyche':        _t('Bill Walsh', 'quarterbacks, San Francisco 49ers'),
    'Chris Palmer':     _t('Bill Parcells', 'assistant, New England Patriots'),
    'Art Shell':        _t('Tom Flores', 'assistant, Los Angeles Raiders'),
    'Tom Flores':       _t('John Madden', 'assistant, Oakland Raiders'),
    'John Madden':      _t('Sid Gillman', 'assistant'),
    'Mike Munchak':     _t('Jeff Fisher', 'offensive line, Tennessee Titans'),
    'Jim Bates':        _t('Dave Wannstedt', 'defensive coordinator, Miami Dolphins'),
    'Jim Zorn':         _t('Mike Holmgren', 'quarterbacks, Seattle Seahawks'),
    'Marc Trestman':    _t('Steve Mariucci', 'offensive coordinator, San Francisco 49ers'),
}

# entries above that exist only as a named ancestor, never as a head coach in the data
# named only as an ancestor here — never a head coach inside the 1999+ window
BRIDGE = ['Jim Johnson', 'Monte Kiffin', 'Rob Ryan', 'Sam Wyche', 'Tom Flores',
          'John Madden', 'Klint Kubiak']
