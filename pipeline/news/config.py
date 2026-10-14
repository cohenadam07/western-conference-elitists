"""Filesystem paths and window/limit constants for the news pipeline."""
import os

# Repo root = .../website  (this file is website/pipeline/news/config.py)
HERE = os.path.dirname(os.path.abspath(__file__))
WEBSITE_DIR = os.path.abspath(os.path.join(HERE, "..", ".."))
PUBLIC_DIR = os.path.join(WEBSITE_DIR, "public")
OUTPUT_JSON = os.path.join(PUBLIC_DIR, "news.json")

# Log directory (gitignored: *.log) — one file, appended per run.
LOG_DIR = os.path.join(WEBSITE_DIR, "pipeline", "news", "logs")
LOG_FILE = os.path.join(LOG_DIR, "news.log")

# The Basketball Savant player universe (per-season). By default the site's own published
# data: public/savant-data.json (the archive) with public/savant-current.json (the season in
# progress, refreshed after every slate) laid over it, exactly as the page does. Set
# SAVANT_PLAYERS_JSON to read one file instead (e.g. ~/Basketball-Savant/out/players.json).
SAVANT_PLAYERS_JSON = os.environ.get("SAVANT_PLAYERS_JSON")
SAVANT_ARCHIVE_JSON = os.path.join(PUBLIC_DIR, "savant-data.json")
SAVANT_CURRENT_JSON = os.path.join(PUBLIC_DIR, "savant-current.json")


def load_savant_doc(path=None):
    """{seasons, data, ...} — one file if a path (or SAVANT_PLAYERS_JSON) is given, else the
    archive with the current-season file over it (the newer copy of a season wins; mirrors
    scripts/lib/savant-merge.mjs)."""
    import json
    from datetime import datetime
    path = path or SAVANT_PLAYERS_JSON
    if path:
        with open(path) as fh:
            return json.load(fh)
    with open(SAVANT_ARCHIVE_JSON) as fh:
        doc = json.load(fh)
    try:
        with open(SAVANT_CURRENT_JSON) as fh:
            cur = json.load(fh)
    except (OSError, ValueError):
        return doc
    when = lambda s: datetime.fromisoformat(s).timestamp() if s else 0
    for s in cur.get("seasons", []):
        block = (cur.get("data") or {}).get(s) or {}
        if not block.get("players"):
            continue
        if s in doc["data"] and when(doc.get("generated")) >= when(cur.get("generated")):
            continue
        doc["data"][s] = block
        if s not in doc["seasons"]:
            doc["seasons"].append(s)
    doc["seasons"].sort(key=lambda s: -int(s[:4]))
    return doc


def pick_season(doc, min_pool=30):
    """The newest season with a real qualified pool (30+), the rule the page, the player
    pages and the snapshot all use; early in a new season that is still last season."""
    for s in doc["seasons"]:
        if sum(1 for p in doc["data"][s]["players"] if p.get("qualified")) >= min_pool:
            return s
    return doc["seasons"][0]
# Metric config (labels + lower-is-better flags) used for percentile context.
SAVANT_CONFIG_DIR = os.environ.get(
    "SAVANT_CONFIG_DIR", "/Users/adamcohen/Basketball-Savant"
)

# Public URL players' Savant page. The ?p=<id> param is honored by the deep-link
# handler added to basketball-savant.html.
def savant_url(player_id):
    return f"/basketball-savant.html?p={player_id}"

# --- WCE line generation (local LLM via Ollama) -----------------------------
# Endpoint + model are config so they can change without editing pipeline code.
# WCE_LLM_PROVIDER lets a hosted provider be swapped in later behind the same
# generator interface (see wce_line.py).
LLM_PROVIDER = os.environ.get("WCE_LLM_PROVIDER", "ollama")
OLLAMA_URL = os.environ.get("WCE_OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.environ.get("WCE_OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_TIMEOUT = int(os.environ.get("WCE_OLLAMA_TIMEOUT", "60"))
# Warn if more than this fraction of a run's lines fail the validation gate.
LINE_REJECT_WARN_RATIO = 0.30

# Article fetching — pull the real article body so the model summarizes from
# content, not just the headline. Falls back to the RSS blurb when a page is
# paywalled/JS-rendered and extraction yields too little.
FETCH_ARTICLES = os.environ.get("WCE_FETCH_ARTICLES", "1") != "0"
ARTICLE_TIMEOUT = 12
ARTICLE_MAX_CHARS = 2200
ARTICLE_MIN_WORDS = 60     # below this, treat extraction as failed
FETCH_WORKERS = 8
# A story needs this much grounding text (extracted article, or a substantive RSS
# blurb) before the model may write a line. A bare headline gets no line — the
# validation gate blocks fabricated numbers, this blocks fabricated prose.
MIN_GROUNDING_WORDS = 25

# Windows / limits.
HEADLINES_WINDOW_DAYS = 7
ANALYTICS_WINDOW_DAYS = 182          # ~6 months
HEADLINES_MIN = 20
HEADLINES_MAX = 30
ANALYTICS_MAX = 40
MAX_CHIPS = 3
