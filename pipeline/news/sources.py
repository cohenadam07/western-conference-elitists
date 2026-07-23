"""Feed and source configuration for the WCE news pipeline.

Edit this file to add/remove sources without touching pipeline code.
Each headline feed is (outlet_name, rss_url). Analytics sources carry a
``kind`` so the poller knows how to read them.
"""

# ---------------------------------------------------------------------------
# Headlines — RSS feeds for the biggest NBA / NCAA men's basketball stories.
# Verified for valid XML at build time; dead feeds are logged and skipped.
# ---------------------------------------------------------------------------
HEADLINE_FEEDS = [
    ("ESPN NBA", "https://www.espn.com/espn/rss/nba/news"),
    ("ESPN College Basketball", "https://www.espn.com/espn/rss/ncb/news"),
    # NBA.com discontinued its general-news RSS (2024+): the old nba_rss.xml
    # 404s and www.nba.com/news/rss.xml now redirects to the homepage. The only
    # surviving nba.com feed is officiating/pool reports, not news — so it's
    # omitted rather than logging a dead feed every run.
    # ("NBA.com", "https://www.nba.com/rss/nba_rss.xml"),
    ("Hoops Rumors", "https://www.hoopsrumors.com/feed"),
    ("RealGM", "https://basketball.realgm.com/rss/wiretap/0/0.xml"),
    ("Yahoo Sports NBA", "https://sports.yahoo.com/nba/rss.xml"),
    ("CBS Sports NBA", "https://www.cbssports.com/rss/headlines/nba/"),
    ("SB Nation NBA", "https://www.sbnation.com/rss/nba/index.xml"),
]

# ---------------------------------------------------------------------------
# Analytics — basketball research & analytics from the past ~6 months.
# ``kind``:
#   "arxiv"    -> queried via the arXiv API (see arxiv.py); url is ignored.
#   "rss"      -> generic RSS/Atom feed (Substacks, JQAS ToC, stat blogs).
# ``source_type`` labels the item as a formal paper vs an article/post.
# ---------------------------------------------------------------------------
ARXIV = {
    "kind": "arxiv",
    "outlet": "arXiv",
    "source_type": "paper",
    # arXiv categories to search; results are filtered on BASKETBALL_TERMS.
    "categories": ["stat.AP", "stat.ML", "cs.LG"],
}

ANALYTICS_FEEDS = [
    # Journal of Quantitative Analysis in Sports — no longer offers a public RSS
    # feed since De Gruyter migrated to degruyterbrill.com (all jqas/rss.xml
    # paths 404). Left here documented; re-enable if a feed reappears.
    # {
    #     "kind": "rss",
    #     "outlet": "Journal of Quantitative Analysis in Sports",
    #     "source_type": "paper",
    #     "url": "https://www.degruyter.com/journal/key/jqas/rss.xml",
    # },
    # Substack / independent newsletters in the basketball-analytics space.
    {
        "kind": "rss",
        "outlet": "Thinking Basketball",
        "source_type": "article",
        "url": "https://thinkingbasketball.net/feed",
    },
    {
        "kind": "rss",
        "outlet": "The F5 (Owen Phillips)",
        "source_type": "article",
        "url": "https://thef5.substack.com/feed",
    },
    {
        "kind": "rss",
        "outlet": "NBAstuffer",
        "source_type": "article",
        "url": "https://www.nbastuffer.com/feed/",
    },
    # MIT Sloan Sports Analytics Conference publishes no RSS feed, and its
    # research archive is a client-rendered page with no stable static links
    # (the old /research path now 404s). arXiv is the primary paper source and
    # already surfaces most Sloan-adjacent work, so Sloan is omitted until it
    # exposes a machine-readable index.
]

# ---------------------------------------------------------------------------
# Basketball relevance — analytics items must match at least one term.
# ---------------------------------------------------------------------------
BASKETBALL_TERMS = [
    "basketball", "nba", "ncaa", "wnba",
    "shot selection", "shot chart", "player tracking", "tracking data",
    "lineup", "possession", "rebound", "free throw", "three-point",
    "box score", "play-by-play", "expected points", "defensive rating",
    "offensive rating", "usage rate", "assist", "turnover",
]

# ---------------------------------------------------------------------------
# Quality filter — drop items whose title/summary matches any term (both tabs).
# ---------------------------------------------------------------------------
DROP_TERMS = [
    # Betting / odds / sportsbook
    "betting", "odds", "sportsbook", "promo code", "promo codes", "parlay",
    "best bets", "bet365", "draftkings", "fanduel", "point spread",
    "moneyline", "over/under", "prop bet", "prizepicks",
    # Fantasy
    "waiver wire", "waiver-wire", "start/sit", "start 'em", "sit 'em",
    "fantasy basketball", "dfs ", "daily fantasy",
    # Sponsored / affiliate — phrases only, so basketball vocab like a
    # G-League "affiliate" team doesn't trigger a false drop.
    "sponsored content", "sponsored post", "sponsored by",
    "affiliate link", "affiliate marketing", "this is an advertisement",
]

# HTTP settings for feed pulls.
USER_AGENT = "WCEHoopsNewsBot/1.0 (+https://wcehoops.com)"
FEED_TIMEOUT = 20  # seconds
