"""The WCE line: one constrained sentence per item, from a local LLM (Ollama).

Provider-agnostic. `get_generator()` returns an object with `.available()` and
`.generate(system, user) -> str | None`; a hosted provider can be swapped in
later by implementing the same two methods and pointing WCE_LLM_PROVIDER at it.

Every generated line passes a hard validation gate before publishing. A line is
rejected (wce_line set to null) and the reason logged if it: exceeds 30 words or
is under 8; contains a number not present in the prompt context; contains a
question mark; or repeats more than 5 consecutive words from the headline. If
more than 30% of a run's items are rejected, a warning is logged. If Ollama is
unreachable, every line is null and the run continues — it never fails.
"""
import re

import requests

from . import config

# Validation-gate word bounds (the prompt itself targets 15-30 words).
MIN_WORDS, MAX_WORDS = 8, 30
MAX_HEADLINE_RUN = 5  # max consecutive headline words a line may repeat

_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_WORD = re.compile(r"[a-z0-9]+")

_SYSTEM = """You write ONE short, factual sentence for Western Conference Elitists (WCE), a basketball site. It appears BELOW an already-shown headline and adds context the headline does not state.

Hard rules:
- Output exactly one plain declarative sentence, 15 to 30 words. No preamble, no quotes, no emoji, no rhetorical questions, no hype.
- Do NOT restate or paraphrase the headline. Add a different angle drawn from the article text.
- Base the sentence ONLY on the context below. Never add facts, names, teams, quotes, dates, or events that are not present in the provided text.
- Use only numbers that appear in the context below. Never state a statistic from your own knowledge — no season averages, shooting splits, standings, records, salaries, or dates. If no numbers are supplied, use none.
- No injury timelines, return dates, or prognoses. You may note an injury occurred; stop there.
- No trade predictions or speculation about future moves. No betting or fantasy framing.
Respond with only the sentence."""

_ANALYTICS_EXTRA = "\nThis item is a research paper or analytics article: in plain language a non-statistician can follow, say what it tested or found, drawn only from the supplied abstract."


# --------------------------------------------------------------------------- #
# Providers
# --------------------------------------------------------------------------- #
class OllamaGenerator:
    """Local generation via the Ollama HTTP API (/api/generate)."""

    def __init__(self, url, model, timeout, log):
        self.url = url
        self.model = model
        self.timeout = timeout
        self.log = log

    def available(self):
        base = self.url.split("/api/")[0]
        try:
            r = requests.get(f"{base}/api/tags", timeout=5)
            return r.status_code == 200
        except requests.RequestException as exc:
            self.log.warning("Ollama unreachable at %s (%s)", base, exc)
            return False

    def generate(self, system, user):
        payload = {
            "model": self.model,
            "system": system,
            "prompt": user,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 160},
        }
        try:
            r = requests.post(self.url, json=payload, timeout=self.timeout)
            r.raise_for_status()
            return (r.json().get("response") or "").strip()
        except (requests.RequestException, ValueError) as exc:
            self.log.warning("  WCE line generation error: %s", exc)
            return None


def get_generator(log):
    if config.LLM_PROVIDER == "ollama":
        return OllamaGenerator(config.OLLAMA_URL, config.OLLAMA_MODEL,
                               config.OLLAMA_TIMEOUT, log)
    log.warning("Unknown WCE_LLM_PROVIDER %r — no line generation", config.LLM_PROVIDER)
    return None


# --------------------------------------------------------------------------- #
# Validation gate
# --------------------------------------------------------------------------- #
def _max_headline_run(line, headline):
    """Longest run of consecutive words in `line` that also appears, in order, in `headline`."""
    lw = _WORD.findall(line.lower())
    hay = " " + " ".join(_WORD.findall(headline.lower())) + " "
    best = 0
    for i in range(len(lw)):
        run = []
        for j in range(i, len(lw)):
            run.append(lw[j])
            if f" {' '.join(run)} " in hay:
                best = max(best, len(run))
            else:
                break
    return best


def validate(raw, headline, context):
    """Return (clean_line, None) if the line passes, else (None, reason)."""
    if not raw:
        return None, "empty"
    line = " ".join(raw.split())
    if "?" in line:
        return None, "contains question mark"
    n = len(line.split())
    if n < MIN_WORDS:
        return None, f"too short ({n} words)"
    if n > MAX_WORDS:
        return None, f"too long ({n} words)"
    for num in _NUMBER.findall(line):
        if num not in context:
            return None, f"unsupported number {num!r}"
    run = _max_headline_run(line, headline)
    if run > MAX_HEADLINE_RUN:
        return None, f"repeats {run} consecutive headline words"
    return line, None


# --------------------------------------------------------------------------- #
# Context builders
# --------------------------------------------------------------------------- #
def _headline_context(item, stats):
    lines = [
        f"Headline: {item['title']}",
        f"Outlet: {item['outlet']}",
    ]
    body = (item.get("article_text") or item.get("summary") or "").strip()
    if body:
        lines.append(f"Article text (summarize ONLY from this — do not add outside facts): {body}")
    facts = []
    for p in item.get("players", []):
        rows = stats.rows_for_from_url(p.get("savant_url")) if stats else []
        if rows:
            pct = "; ".join(f"{r['label']} {r['pct']}th percentile" for r in rows[:6])
            facts.append(f"{p['name']} — this season, league percentiles: {pct}.")
    if facts:
        lines.append("Savant percentile context (the ONLY numbers you may cite):")
        lines.extend(facts)
    else:
        lines.append("No statistics are supplied — write a sentence with no numbers.")
    return "\n".join(lines)


def _analytics_context(item):
    is_paper = item.get("source_type") == "paper"
    body = (item.get("article_text") if not is_paper else None) or item.get("summary") or "(none provided)"
    label = "Abstract" if is_paper else "Article text (summarize ONLY from this)"
    return "\n".join([
        f"Title: {item['title']}",
        f"Outlet: {item['outlet']}",
        f"{label}: {body}",
    ])


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def annotate(headlines, analytics, stats, log):
    """Fill wce_line on each item in place. Null everything if provider is down."""
    items = headlines + analytics
    gen = get_generator(log)
    if gen is None or not gen.available():
        log.warning("WCE line: provider unavailable — publishing all items with null lines")
        for it in items:
            it["wce_line"] = None
        return

    total = len(items)
    ok = rejected = errored = 0

    def run_one(system, context, headline):
        nonlocal ok, rejected, errored
        raw = gen.generate(system, context)
        if raw is None:
            errored += 1
            return None
        line, reason = validate(raw, headline, context)
        if line is None:
            rejected += 1
            log.info("  reject [%s]: %s | %r", reason, headline[:50], raw[:80])
            return None
        ok += 1
        return line

    for it in headlines:
        it["wce_line"] = run_one(_SYSTEM, _headline_context(it, stats), it["title"])
    for it in analytics:
        it["wce_line"] = run_one(_SYSTEM + _ANALYTICS_EXTRA, _analytics_context(it), it["title"])

    log.info("WCE line: %d published, %d rejected, %d errored of %d (model=%s)",
             ok, rejected, errored, total, config.OLLAMA_MODEL)
    if total and rejected / total > config.LINE_REJECT_WARN_RATIO:
        log.warning("WCE line: rejection rate %.0f%% exceeds %.0f%% — review model/prompt",
                    100 * rejected / total, 100 * config.LINE_REJECT_WARN_RATIO)
