"""
teams.py — who the thirty franchises are across sources and seasons, and where they played.

Three sources name teams three ways. stats.nba.com keys a franchise by one TEAM_ID for its
whole life (the Nets are 1610612751 in New Jersey and Brooklyn) and changes the abbreviation
with the city; ESPN uses its own abbreviations ("GS", "NO", "UTAH", "NJ"); Basketball-
Reference uses a third set ("PHO", "BRK", "CHO", "NOH"). Everything here maps onto the NBA's
TEAM_ID and the NBA's abbreviation for that season.

The arena table is hand-made, one row per home arena with the seasons it was in use, its
coordinates, time zone (standard-time offset from UTC) and altitude. Moves inside a season
(the Wizards' MCI Center opened Dec 2, 1997) are dated. Games away from the home arena
(London, Mexico City, the 2020 bubble, the Raptors' Tampa season, the Hornets' two Oklahoma
City seasons) are placed from ESPN's venue city when the game is in ESPN's data, so travel,
time zones and altitude follow where the game actually was. Sources: each arena's Wikipedia
page for coordinates and opening dates; city elevations from the USGS Geographic Names
Information System via Wikipedia's city pages.
"""
import math

# NBA TEAM_ID -> franchise key (the current abbreviation), and the abbreviations each source uses
FRANCHISES = {
    1610612737: "ATL", 1610612738: "BOS", 1610612751: "BKN", 1610612766: "CHA", 1610612741: "CHI",
    1610612739: "CLE", 1610612742: "DAL", 1610612743: "DEN", 1610612765: "DET", 1610612744: "GSW",
    1610612745: "HOU", 1610612754: "IND", 1610612746: "LAC", 1610612747: "LAL", 1610612763: "MEM",
    1610612748: "MIA", 1610612749: "MIL", 1610612750: "MIN", 1610612740: "NOP", 1610612752: "NYK",
    1610612760: "OKC", 1610612753: "ORL", 1610612755: "PHI", 1610612756: "PHX", 1610612757: "POR",
    1610612758: "SAC", 1610612759: "SAS", 1610612761: "TOR", 1610612762: "UTA", 1610612764: "WAS",
}
ID_OF = {v: k for k, v in FRANCHISES.items()}

# any abbreviation any source uses -> franchise key
ALIASES = {
    "NJ": "BKN", "NJN": "BKN", "BRK": "BKN", "BKN": "BKN",
    "SEA": "OKC", "OKC": "OKC",
    "NO": "NOP", "NOH": "NOP", "NOK": "NOP", "NOP": "NOP",
    "CHA": "CHA", "CHO": "CHA", "CHH": "CHA",   # the 1988-2002 Charlotte Hornets belong to Charlotte in the NBA's books (since the 2014 name deal) and on Basketball-Reference
    "WSB": "WAS",                               # Basketball-Reference's Washington Bullets
    "GS": "GSW", "GSW": "GSW", "NY": "NYK", "NYK": "NYK", "SA": "SAS", "SAS": "SAS",
    "UTAH": "UTA", "UTA": "UTA", "WSH": "WAS", "WAS": "WAS", "PHO": "PHX", "PHX": "PHX",
    "VAN": "MEM", "MEM": "MEM",
}
for k in FRANCHISES.values():
    ALIASES.setdefault(k, k)

# the NBA's abbreviation for a franchise in a season (start year), where it differs from the key
HISTORY = {
    "BKN": [(0, 2011, "NJN")], "OKC": [(0, 2007, "SEA")], "MEM": [(0, 2000, "VAN")],
    "NOP": [(2002, 2004, "NOH"), (2005, 2006, "NOK"), (2007, 2012, "NOH")], "CHA": [(0, 2001, "CHH")],
}
# Basketball-Reference's abbreviation where it differs from the NBA's for the same season
BR_ABBR = {"BKN": "BRK", "CHA": "CHO", "PHX": "PHO", "NOP": "NOP"}
BR_HISTORY = {"CHA": [(0, 2001, "CHH"), (2004, 2013, "CHA")], "BKN": [(0, 2011, "NJN")], "NOP": [(2002, 2004, "NOH"), (2005, 2006, "NOK"), (2007, 2012, "NOH")],
              "OKC": [(0, 2007, "SEA")], "MEM": [(0, 2000, "VAN")], "WAS": [(0, 1996, "WSB")]}


def franchise(abbr):
    return ALIASES.get(str(abbr).upper())


def nba_abbr(key, year):
    for a, b, ab in HISTORY.get(key, []):
        if a <= year <= b:
            return ab
    return key


def br_abbr(key, year):
    for a, b, ab in BR_HISTORY.get(key, []):
        if a <= year <= b:
            return ab
    return BR_ABBR.get(key, key)


def br_franchise(abbr, year):
    """Basketball-Reference's team abbreviation in a season -> franchise key."""
    return ALIASES.get(str(abbr).upper())


TZ = {"ET": -5, "CT": -6, "MT": -7, "AZ": -7, "PT": -8, "GMT": 0, "CET": 1, "JST": 9, "GST": 4}

# (franchise, first season start year, last season start year, arena, city, lat, lon, tz, altitude m, note)
ARENAS = [
    ("ATL", 1996, 1996, "Omni Coliseum", "Atlanta", 33.7573, -84.3963, "ET", 320, None),
    ("ATL", 1997, 1998, "Georgia Dome / Alexander Memorial Coliseum", "Atlanta", 33.7577, -84.4008, "ET", 320, "home split between the two buildings while Philips Arena was built"),
    ("ATL", 1999, 2099, "State Farm Arena (Philips Arena)", "Atlanta", 33.7573, -84.3963, "ET", 320, None),
    ("BOS", 1996, 2099, "TD Garden (FleetCenter)", "Boston", 42.3662, -71.0621, "ET", 6, None),
    ("BKN", 1996, 2009, "Izod Center (Continental Airlines Arena)", "East Rutherford", 40.8117, -74.0675, "ET", 5, None),
    ("BKN", 2010, 2011, "Prudential Center", "Newark", 40.7334, -74.1711, "ET", 5, None),
    ("BKN", 2012, 2099, "Barclays Center", "Brooklyn", 40.6826, -73.9754, "ET", 5, None),
    ("CHA", 2004, 2004, "Charlotte Coliseum", "Charlotte", 35.1773, -80.9064, "ET", 229, None),
    ("CHA", 2005, 2099, "Spectrum Center (Charlotte Bobcats Arena, Time Warner Cable Arena)", "Charlotte", 35.2251, -80.8392, "ET", 229, None),
    ("CHI", 1996, 2099, "United Center", "Chicago", 41.8807, -87.6742, "CT", 181, None),
    ("CLE", 1996, 2099, "Rocket Arena (Gund Arena, Quicken Loans Arena)", "Cleveland", 41.4965, -81.6882, "ET", 199, None),
    ("DAL", 1996, 2000, "Reunion Arena", "Dallas", 32.7738, -96.8103, "CT", 131, None),
    ("DAL", 2001, 2099, "American Airlines Center", "Dallas", 32.7905, -96.8103, "CT", 131, None),
    ("DEN", 1996, 1998, "McNichols Sports Arena", "Denver", 39.7433, -105.0203, "MT", 1609, None),
    ("DEN", 1999, 2099, "Ball Arena (Pepsi Center)", "Denver", 39.7487, -105.0077, "MT", 1609, None),
    ("DET", 1996, 2016, "The Palace of Auburn Hills", "Auburn Hills", 42.6968, -83.2455, "ET", 290, None),
    ("DET", 2017, 2099, "Little Caesars Arena", "Detroit", 42.3410, -83.0552, "ET", 190, None),
    ("GSW", 1996, 1996, "San Jose Arena", "San Jose", 37.3327, -121.9012, "PT", 25, "Oakland Arena under renovation"),
    ("GSW", 1997, 2018, "Oracle Arena (The Arena in Oakland)", "Oakland", 37.7503, -122.2030, "PT", 5, None),
    ("GSW", 2019, 2099, "Chase Center", "San Francisco", 37.7680, -122.3878, "PT", 5, None),
    ("HOU", 1996, 2002, "Compaq Center (The Summit)", "Houston", 29.7333, -95.4411, "CT", 15, None),
    ("HOU", 2003, 2099, "Toyota Center", "Houston", 29.7508, -95.3621, "CT", 15, None),
    ("IND", 1996, 1998, "Market Square Arena", "Indianapolis", 39.7690, -86.1530, "ET", 218, None),
    ("IND", 1999, 2099, "Gainbridge Fieldhouse (Conseco Fieldhouse)", "Indianapolis", 39.7640, -86.1555, "ET", 218, None),
    ("LAC", 1996, 1998, "Los Angeles Memorial Sports Arena", "Los Angeles", 34.0160, -118.2829, "PT", 70, "with some home games at the Arrowhead Pond in Anaheim"),
    ("LAC", 1999, 2023, "Crypto.com Arena (Staples Center)", "Los Angeles", 34.0430, -118.2673, "PT", 70, None),
    ("LAC", 2024, 2099, "Intuit Dome", "Inglewood", 33.9452, -118.3410, "PT", 40, None),
    ("LAL", 1996, 1998, "Great Western Forum", "Inglewood", 33.9583, -118.3418, "PT", 40, None),
    ("LAL", 1999, 2099, "Crypto.com Arena (Staples Center)", "Los Angeles", 34.0430, -118.2673, "PT", 70, None),
    ("MEM", 1996, 2000, "General Motors Place", "Vancouver", 49.2778, -123.1089, "PT", 2, None),
    ("MEM", 2001, 2003, "Pyramid Arena", "Memphis", 35.1554, -90.0509, "CT", 80, None),
    ("MEM", 2004, 2099, "FedExForum", "Memphis", 35.1382, -90.0506, "CT", 80, None),
    ("MIA", 1996, 1998, "Miami Arena", "Miami", 25.7817, -80.1953, "ET", 2, None),
    ("MIA", 1999, 2099, "Kaseya Center (AmericanAirlines Arena)", "Miami", 25.7814, -80.1870, "ET", 2, None),
    ("MIL", 1996, 2017, "Bradley Center", "Milwaukee", 43.0435, -87.9169, "CT", 188, None),
    ("MIL", 2018, 2099, "Fiserv Forum", "Milwaukee", 43.0451, -87.9174, "CT", 188, None),
    ("MIN", 1996, 2099, "Target Center", "Minneapolis", 44.9795, -93.2760, "CT", 253, None),
    ("CHA", 1996, 2001, "Charlotte Coliseum", "Charlotte", 35.1773, -80.9064, "ET", 229, "the original Hornets, before the move to New Orleans"),
    ("NOP", 2002, 2004, "Smoothie King Center (New Orleans Arena)", "New Orleans", 29.9490, -90.0821, "CT", 1, None),
    ("NOP", 2005, 2006, "Ford Center", "Oklahoma City", 35.4634, -97.5151, "CT", 366, "after Hurricane Katrina; a few games each season back in New Orleans, placed by ESPN's venue"),
    ("NOP", 2007, 2099, "Smoothie King Center (New Orleans Arena)", "New Orleans", 29.9490, -90.0821, "CT", 1, None),
    ("NYK", 1996, 2099, "Madison Square Garden", "New York", 40.7505, -73.9934, "ET", 10, None),
    ("OKC", 1996, 2007, "KeyArena", "Seattle", 47.6221, -122.3540, "PT", 50, None),
    ("OKC", 2008, 2099, "Paycom Center (Ford Center, Chesapeake Energy Arena)", "Oklahoma City", 35.4634, -97.5151, "CT", 366, None),
    ("ORL", 1996, 2009, "Amway Arena (Orlando Arena, TD Waterhouse Centre)", "Orlando", 28.5494, -81.3843, "ET", 30, None),
    ("ORL", 2010, 2099, "Kia Center (Amway Center)", "Orlando", 28.5392, -81.3839, "ET", 30, None),
    ("PHI", 1996, 2099, "Xfinity Mobile Arena (CoreStates Center, Wells Fargo Center)", "Philadelphia", 39.9012, -75.1720, "ET", 5, None),
    ("PHX", 1996, 2099, "Mortgage Matchup Center (America West Arena, Footprint Center)", "Phoenix", 33.4457, -112.0712, "AZ", 331, None),
    ("POR", 1996, 2099, "Moda Center (Rose Garden)", "Portland", 45.5316, -122.6668, "PT", 15, None),
    ("SAC", 1996, 2015, "Sleep Train Arena (ARCO Arena)", "Sacramento", 38.6491, -121.5181, "PT", 8, None),
    ("SAC", 2016, 2099, "Golden 1 Center", "Sacramento", 38.5802, -121.4997, "PT", 8, None),
    ("SAS", 1996, 2001, "Alamodome", "San Antonio", 29.4169, -98.4789, "CT", 198, None),
    ("SAS", 2002, 2099, "Frost Bank Center (SBC Center, AT&T Center)", "San Antonio", 29.4270, -98.4375, "CT", 198, None),
    ("TOR", 1996, 1998, "SkyDome", "Toronto", 43.6414, -79.3894, "ET", 76, "Air Canada Centre opened February 1999"),
    ("TOR", 1999, 2099, "Scotiabank Arena (Air Canada Centre)", "Toronto", 43.6435, -79.3791, "ET", 76, None),
    ("TOR", 2020, 2020, "Amalie Arena", "Tampa", 27.9427, -82.4518, "ET", 15, "the 2020-21 season, with the border closed"),
    ("UTA", 1996, 2099, "Delta Center (EnergySolutions Arena, Vivint Arena)", "Salt Lake City", 40.7683, -111.9011, "MT", 1288, None),
    ("WAS", 1996, 1996, "USAir Arena", "Landover", 38.9030, -76.8684, "ET", 50, "through November 1997 of the next season"),
    ("WAS", 1997, 2099, "Capital One Arena (MCI Center, Verizon Center)", "Washington", 38.8981, -77.0209, "ET", 10, "opened December 2, 1997"),
]

# Cities games are played in away from a home arena (neutral sites, relocations inside a season)
CITIES = {
    "london": ("London", 51.5030, -0.0032, "GMT", 11), "paris": ("Paris", 48.8386, 2.3783, "CET", 35),
    "mexico city": ("Mexico City", 19.4305, -99.1332, "CT", 2240), "tokyo": ("Tokyo", 35.6764, 139.6500, "JST", 40),
    "saitama": ("Saitama", 35.9060, 139.6340, "JST", 15), "abu dhabi": ("Abu Dhabi", 24.4200, 54.4500, "GST", 5),
    "berlin": ("Berlin", 52.5075, 13.4430, "CET", 34), "las vegas": ("Las Vegas", 36.0909, -115.1783, "PT", 610),
    "kissimmee": ("Kissimmee (the 2020 bubble)", 28.3370, -81.5560, "ET", 30), "lake buena vista": ("Lake Buena Vista (the 2020 bubble)", 28.3370, -81.5560, "ET", 30),
    "orlando": ("Orlando", 28.5392, -81.3839, "ET", 30), "tampa": ("Tampa", 27.9427, -82.4518, "ET", 15),
    "new orleans": ("New Orleans", 29.9490, -90.0821, "CT", 1), "baton rouge": ("Baton Rouge", 30.4120, -91.1830, "CT", 17),
    "oklahoma city": ("Oklahoma City", 35.4634, -97.5151, "CT", 366), "seattle": ("Seattle", 47.6221, -122.3540, "PT", 50),
    "anaheim": ("Anaheim", 33.8078, -117.8765, "PT", 48), "san diego": ("San Diego", 32.7157, -117.1611, "PT", 20),
    "st. louis": ("St. Louis", 38.6270, -90.1994, "CT", 142), "kansas city": ("Kansas City", 39.0975, -94.5807, "CT", 277),
    "newark": ("Newark", 40.7334, -74.1711, "ET", 5), "uniondale": ("Uniondale", 40.7228, -73.5907, "ET", 20),
    "austin": ("Austin", 30.2810, -97.7315, "CT", 149), "san jose": ("San Jose", 37.3327, -121.9012, "PT", 25),
    "brooklyn": ("Brooklyn", 40.6826, -73.9754, "ET", 5), "inglewood": ("Inglewood", 33.9452, -118.3410, "PT", 40),
    "cincinnati": ("Cincinnati", 39.0975, -84.5160, "ET", 150), "honolulu": ("Honolulu", 21.3069, -157.8583, "PT", 5),
    "manchester": ("Manchester", 53.4839, -2.2446, "GMT", 38), "shanghai": ("Shanghai", 31.2304, 121.4737, "JST", 4),
    "macau": ("Macau", 22.1987, 113.5439, "JST", 5), "milan": ("Milan", 45.4642, 9.1900, "CET", 120),
}


def home_arena(key, year, date=None):
    """The franchise's home arena for a season (start year); the Wizards' 1997-98 is dated."""
    if key == "WAS" and year == 1997 and date and str(date) < "1997-12-02":
        return _row(ARENAS[[i for i, r in enumerate(ARENAS) if r[0] == "WAS"][0]])
    rows = [r for r in ARENAS if r[0] == key and r[1] <= year <= r[2]]
    if not rows:
        return None
    # a one-season special (Tampa) outranks the long row it overlaps
    rows.sort(key=lambda r: r[2] - r[1])
    return _row(rows[0])


def _row(r):
    return dict(arena=r[3], city=r[4], lat=r[5], lon=r[6], tz=TZ[r[7]], alt=r[8])


def place(key, year, date=None, venue_city=None):
    """Where a game was played: the home arena, unless ESPN puts it in another city."""
    home = home_arena(key, year, date)
    if venue_city:
        c = str(venue_city).strip().lower()
        if home and c == home["city"].lower():
            return dict(home, neutral=False)
        if c in CITIES:
            n, lat, lon, tz, alt = CITIES[c]
            return dict(arena=None, city=n, lat=lat, lon=lon, tz=TZ[tz], alt=alt, neutral=True)
    return dict(home, neutral=False) if home else None


def miles(a, b):
    """Great-circle distance between two places, in miles."""
    if not a or not b:
        return None
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


# For the Rotation Map, standings and the page: a franchise's colours and names by season
NAMES = {
    "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets", "CHA": "Charlotte Hornets", "CHI": "Chicago Bulls",
    "CLE": "Cleveland Cavaliers", "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons", "GSW": "Golden State Warriors",
    "HOU": "Houston Rockets", "IND": "Indiana Pacers", "LAC": "LA Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
    "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves", "NOP": "New Orleans Pelicans", "NYK": "New York Knicks",
    "OKC": "Oklahoma City Thunder", "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns", "POR": "Portland Trail Blazers",
    "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs", "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
}
OLD_NAMES = {"NJN": "New Jersey Nets", "SEA": "Seattle SuperSonics", "VAN": "Vancouver Grizzlies", "CHH": "Charlotte Hornets",
             "NOH": "New Orleans Hornets", "NOK": "New Orleans/Oklahoma City Hornets"}
BOBCATS = (2004, 2013)


def name(key, year):
    ab = nba_abbr(key, year)
    if ab in OLD_NAMES:
        return OLD_NAMES[ab]
    if key == "CHA" and BOBCATS[0] <= year <= BOBCATS[1]:
        return "Charlotte Bobcats"
    if key == "WAS" and year <= 1996:
        return "Washington Bullets"
    return NAMES[key]


COLORS = {
    "ATL": "#C8102E", "BOS": "#007A33", "BKN": "#000000", "CHA": "#1D1160", "CHI": "#CE1141", "CLE": "#860038", "DAL": "#00538C",
    "DEN": "#0E2240", "DET": "#C8102E", "GSW": "#1D428A", "HOU": "#CE1141", "IND": "#002D62", "LAC": "#C8102E", "LAL": "#552583",
    "MEM": "#5D76A9", "MIA": "#98002E", "MIL": "#00471B", "MIN": "#0C2340", "NOP": "#0C2340", "NYK": "#F58426", "OKC": "#007AC1",
    "ORL": "#0077C0", "PHI": "#006BB6", "PHX": "#1D1160", "POR": "#E03A3E", "SAC": "#5A2D81", "SAS": "#C4CED4", "TOR": "#CE1141",
    "UTA": "#002B5C", "WAS": "#002B5C",
}
