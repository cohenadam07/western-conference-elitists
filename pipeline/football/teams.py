"""Team identity. Primary colour, secondary, and a display name.

Includes the franchises that moved inside the 1999+ window (STL, SD, OAK) so a 2003 card
doesn't come up blank. Colours are the team's primary mark, used only as a thin accent on
the page — the palette that carries the design is the tool's own, not the team's.
"""
TEAMS = {
 'ARI': ['Arizona Cardinals', '#97233F', '#000000'],
 'ATL': ['Atlanta Falcons', '#A71930', '#000000'],
 'BAL': ['Baltimore Ravens', '#241773', '#9E7C0C'],
 'BUF': ['Buffalo Bills', '#00338D', '#C60C30'],
 'CAR': ['Carolina Panthers', '#0085CA', '#101820'],
 'CHI': ['Chicago Bears', '#0B162A', '#C83803'],
 'CIN': ['Cincinnati Bengals', '#FB4F14', '#000000'],
 'CLE': ['Cleveland Browns', '#311D00', '#FF3C00'],
 'DAL': ['Dallas Cowboys', '#041E42', '#869397'],
 'DEN': ['Denver Broncos', '#FB4F14', '#002244'],
 'DET': ['Detroit Lions', '#0076B6', '#B0B7BC'],
 'GB':  ['Green Bay Packers', '#203731', '#FFB612'],
 'HOU': ['Houston Texans', '#03202F', '#A71930'],
 'IND': ['Indianapolis Colts', '#002C5F', '#A2AAAD'],
 'JAX': ['Jacksonville Jaguars', '#006778', '#D7A22A'],
 'KC':  ['Kansas City Chiefs', '#E31837', '#FFB81C'],
 'LA':  ['Los Angeles Rams', '#003594', '#FFA300'],
 'LAC': ['Los Angeles Chargers', '#0080C6', '#FFC20E'],
 'LV':  ['Las Vegas Raiders', '#000000', '#A5ACAF'],
 'MIA': ['Miami Dolphins', '#008E97', '#FC4C02'],
 'MIN': ['Minnesota Vikings', '#4F2683', '#FFC62F'],
 'NE':  ['New England Patriots', '#002244', '#C60C30'],
 'NO':  ['New Orleans Saints', '#101820', '#D3BC8D'],
 'NYG': ['New York Giants', '#0B2265', '#A71930'],
 'NYJ': ['New York Jets', '#125740', '#000000'],
 'PHI': ['Philadelphia Eagles', '#004C54', '#A5ACAF'],
 'PIT': ['Pittsburgh Steelers', '#101820', '#FFB612'],
 'SEA': ['Seattle Seahawks', '#002244', '#69BE28'],
 'SF':  ['San Francisco 49ers', '#AA0000', '#B3995D'],
 'TB':  ['Tampa Bay Buccaneers', '#D50A0A', '#34302B'],
 'TEN': ['Tennessee Titans', '#0C2340', '#4B92DB'],
 'WAS': ['Washington Commanders', '#5A1414', '#FFB612'],
 # franchises that moved or rebranded inside the window
 'STL': ['St. Louis Rams', '#002244', '#B3995D'],
 'SD':  ['San Diego Chargers', '#002A5E', '#FFC20E'],
 'OAK': ['Oakland Raiders', '#000000', '#A5ACAF'],
 'LAR': ['Los Angeles Rams', '#003594', '#FFA300'],
}


# One code per franchise. The sources disagree about the clubs that moved: the stat tables
# and the play-by-play call the 2003 Raiders LV, while the schedule, the snap counts and
# PFR's charting call them OAK. Matched as written, a pre-move Raider had no team record,
# no coach and no team totals, and a 2015 Raider's season read LV -> OAK -> LV -> OAK.
# Everything is joined on the play-by-play's code; the page prints the name the club had
# in the season on screen (ERA below).
CANON = {'OAK': 'LV', 'SD': 'LAC', 'STL': 'LA', 'LAR': 'LA', 'SL': 'LA', 'JAC': 'JAX',
         'WSH': 'WAS', 'HST': 'HOU', 'BLT': 'BAL', 'CLV': 'CLE', 'ARZ': 'ARI'}


def canon(t):
    return CANON.get(t, t) if isinstance(t, str) else t


# What a franchise was called before it moved: code -> (last season under the old name,
# old code, old name). The page shows these for the seasons they apply to.
ERA = {'LV': (2019, 'OAK', 'Oakland Raiders'),
       'LAC': (2016, 'SD', 'San Diego Chargers'),
       'LA': (2015, 'STL', 'St. Louis Rams')}

