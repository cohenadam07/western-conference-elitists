# WCE News Pipeline

Aggregates NBA / college-basketball headlines and basketball analytics, adds a
short Claude-written WCE line to each item, and writes `public/news.json` — which
the `/news` React page (`src/pages/News.jsx`) reads at runtime.

## Layout

| File | Role |
|---|---|
| `sources.py` | **Config** — feed URLs, arXiv categories, relevance terms, quality-filter terms. Edit here to add/remove sources. |
| `feeds.py` | Pull + parse headline RSS/Atom feeds; apply quality filter. |
| `dedupe.py` | Group near-duplicate headlines (token overlap) and rank clusters. |
| `players.py` | Exact full-name matcher against the Savant player index (no fuzzy; ambiguous names skipped). |
| `analytics.py` | arXiv API + analytics RSS feeds, 6-month window. |
| `savant_stats.py` | League percentiles for matched players (the only numbers the WCE line may cite). |
| `wce_line.py` | The WCE line via a local LLM (Ollama). Provider-agnostic + a hard validation gate. Provider down → lines stay `null`. |
| `build_news.py` | Orchestrator; writes `public/news.json`. |
| `run.sh` | launchd runner: pull → build → commit → push. |
| `com.wcehoops.news.plist` | launchd job, runs 3×/day (08:00, 14:00, 23:30 local). |

## Run manually

```sh
cd /Users/adamcohen/nba_prospect_model/website
python3 -m pipeline.news.build_news        # writes public/news.json
python3 -m pipeline.news.console           # step-1 headlines diagnostic (no page)
```

## Dependencies

```sh
python3 -m pip install --user feedparser requests
```

## The WCE line (local LLM via Ollama)

Runs against Ollama — no API key, nothing leaves the machine. Install the model:

```sh
ollama pull qwen2.5:7b     # default; Ollama must be running (localhost:11434)
```

Endpoint and model are **config, not code** — override with env vars (set them
in `~/.wce-news.env`, which the runner sources):

| Env var | Default |
|---|---|
| `WCE_LLM_PROVIDER` | `ollama` |
| `WCE_OLLAMA_URL` | `http://localhost:11434/api/generate` |
| `WCE_OLLAMA_MODEL` | `qwen2.5:7b` |
| `WCE_OLLAMA_TIMEOUT` | `60` |

The generator sits behind a small interface (`available()` + `generate()`), so a
hosted provider can be swapped in later without touching the rest of the pipeline.

**Validation gate.** Every generated line is checked before publishing and set to
`null` (with the reason logged) if it: is >30 or <8 words, cites a number not in
the prompt context, contains a `?`, or repeats >5 consecutive headline words. If
more than 30% of a run is rejected, a warning is logged. If Ollama is unreachable
the run still completes with all lines `null` — it never fails. The model may cite
**only** the Savant percentiles it is handed; all constraints live in the
`wce_line.py` system prompt + gate.

## Player index

Read from `SAVANT_PLAYERS_JSON` (default
`/Users/adamcohen/Basketball-Savant/out/players.json`), current season. Chips
link to `/basketball-savant.html?p=<id>`.

## Scheduling (launchd)

```sh
cp pipeline/news/com.wcehoops.news.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.wcehoops.news.plist   # enable
launchctl start com.wcehoops.news                               # run once now
launchctl unload ~/Library/LaunchAgents/com.wcehoops.news.plist # disable
```

Each run appends to `pipeline/news/logs/run.log` (gitignored): feeds pulled,
items kept, items dropped by filter, API failures, and whether it pushed.
Deploy is automatic — a changed `public/news.json` is committed and pushed to
`main`, and Vercel redeploys wcehoops.com.
```
