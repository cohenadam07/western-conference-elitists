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

# The full Basketball Savant player universe (per-season). Overridable via env
# so the scheduled job can point at the model output wherever it lives.
SAVANT_PLAYERS_JSON = os.environ.get(
    "SAVANT_PLAYERS_JSON",
    "/Users/adamcohen/Basketball-Savant/out/players.json",
)
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
