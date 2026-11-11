# The WCE analyst exam: how to take it

You are taking an exam of the WCE connector (wcehoops.com's MCP server). The point is to find out
whether an assistant with nothing but the connector can answer the questions an analyst would ask:
lookups, filters over many rows, splits, comparisons, and traps (questions the data can't answer,
where the right answer says so and why).

There are 80 questions: about 20 NBA, 20 NFL, 12 college basketball, 12 college football, 8 UFC and
8 that cross tools or sports. Every answer has a gold value computed by code from the data files
(`exam.mjs gold`), never typed by hand.

## The rules

1. **Use the connector and nothing else.** Answer only from the WCE connector's tools
   (`savant_dictionary`, `savant_data`, and the sport tools like `nba_get_player_profile`). No web
   search, no memory of what a stat "should" be, no repository files except the questions.
2. **Don't look at the answers first.** Read only each question's `id` and `question` from
   `tools/savant-mcp/exam/questions.json`. Its `gold`, `calls`, `recipe`, `filters` and every other
   field are the answer key; leave them alone until you score yourself (step 5).
3. **Answer in plain language,** the way you'd answer Adam: the number or the name, the season,
   the sample it rests on, and the date the data runs through (each tool answer gives one). Round as
   a person would (true shooting to three decimals, EPA to three, percentages to one).
4. **A trap is answered by saying the data can't answer it,** which table or tool would have to
   hold it, and why it doesn't (a season that wasn't tracked, a field no free source publishes).
   Guessing a number on a trap is a wrong answer, even a plausible one.

## Step by step

1. Read the catalog: `savant_dictionary` with no inputs. Then read a table's columns
   (`savant_dictionary` with `sport` and `table`) before you pull rows from it.
2. For each question, plan the pull: which table or tool, which season, which filters. Pull with
   `savant_data`, 500 rows a call, following `next_offset` until it is null. Do the arithmetic
   yourself over every row that matches (a sum over all of them, not the first page).
3. Write your answer to the question in one to three sentences, then the numbers you computed on
   their own line, labeled. Note anything you weren't sure of.
4. Collect all 80 answers in one file, `exam-answers-YYYY-MM-DD.md`, one section per question id.
5. **Score yourself.** Now open the answer key:
   - Run `node tools/savant-mcp/exam/exam.mjs check --site https://wcehoops.com --out exam.json`
     if you can run commands. It recomputes the gold for questions about the season in progress
     (`in_progress: true`) from today's live files and prints every gold value. If you can't run
     it, use each question's `gold` in `questions.json` (for an `in_progress` question, say that
     its gold may have moved since it was written).
   - A non-trap answer is **right** when every number in the gold matches yours within the
     question's `tolerance` (for a `key`, the same player, team or fighter), **wrong** otherwise.
   - A trap is **right** when you declined and gave the reason; compare yours with its `reason`.
6. Report: the score (right out of 80, and out of the 68 answerable and the 12 traps separately),
   then every miss with the question, your answer, the gold, and what went wrong: a wrong table, a
   filter that missed rows, a page you didn't follow, a tool that couldn't reach the data. When the
   connector itself was the problem (a tool that can't answer what the gold shows the data holds),
   say which piece is missing. That list is what the week's connector work picks up.

## What the questions look like

- "How does Patrick Mahomes's EPA per dropback change when he is pressured, 2024 on?" — `savant_data`
  on `nfl plays` for 2024 and 2025, regular season, his dropbacks with `pressure` charted; the
  mean of `qb_epa` with `pressure = 1` against `pressure = 0`.
- "Why are the Chargers bad: where does their offense rank in EPA per play this season?" — `nfl
  games` for the season in progress, each team's `epa` over `plays`, ranked.
- "What was Caleb Williams's average air yards per attempt at USC in 2023?" — a trap: college air
  yards start with the charting layer in 2025 week 9.

The self-check that runs every week (`exam.mjs check --site`) proves every non-trap question can be
answered through the connector; your score says whether an assistant actually does.
