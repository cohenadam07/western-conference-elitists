# NBA GM Savant: salary slots (1.0.0 ships without salaries; 1.1.0 drops them in)

Every salary field already exists in 1.0.0, set to null, in every place a reader can see NBA GM Savant: the page's files, the Data Room and the connector. When salaries arrive, the 1.1.0 job is to:
- fill in one module;
- move the numbers listed under "What will move";
- delete the "salaries coming" badges.

Nothing downstream changes shape.

The Contract tab's Module 6 must deliver the inputs below. The field names match its Module 3 outputs (branch `contract-tab`, commit 3714f5e, `pipeline/basketball/contracts/data/`). If Module 6 renames a field, this file and `salary_slots.py` change together.

## 1. The one reader: `pipeline/basketball/gm/salary_slots.py`

Everything goes through this module; nothing else opens a contract file. It reads only `CONTRACTS_DATA` (default `pipeline/basketball/contracts/data`) and never Front Office. That rules out `cap_engine`, `contracts_2026_27.json` and the rest.

| function | returns | 1.0.0 | 1.1.0 reads |
|---|---|---|---|
| `decision(d)` | `salary_cost, cap_hit, value_per_dollar, dead_money, years_of_control` | all null | see section 2 |
| `season(team, y)` | `payroll, tax_paid, apron_status, dead_money, value_per_dollar` | all null | `team_payroll_history.json` |
| `spell(row)` | `payroll_per_season, tax_paid, dead_money, value_per_dollar, cap_outlook` | all null | season() over the spell, by share |
| `asset(asset_id, day)` | years of control left | null | `years_of_control.json.gz` |
| `meta()` | `{available, arrives, changes[], note}` | available false | available true |

`AVAILABLE = ENABLED and FILES_PRESENT`. `ENABLED` is set by hand in 1.1.0, so the files merely appearing (say, the contract-tab branch merging first) cannot tell the page that salaries are in while every field is still null.

## 2. Exactly what each field reads

| field (where it lands) | from file | Contract tab fields | rule |
|---|---|---|---|
| `cap_hit` (decision) | `salaries_history.json` rows | `br_id, season, team, cap_hit` | cap hit, in the decision's season, of the players who came in, less those who went out. A player is matched by `br_id` through `grade.canonical_id`. |
| `salary_cost` (decision) | `salaries_history.json`; `contracts_current.json` for 2026-27 on | `cap_hit` by season; `seasons`, `years` | salary committed by the deal over the seasons it runs |
| `value_per_dollar` (decision) | derived | — | `turned_out` ÷ (`salary_cost` / $1M), in Savant points per $1M |
| `dead_money` (decision) | `team_payroll_history.json` | `dead_money_rows` | what is still owed to a player the decision waived or stretched |
| `years_of_control` (decision) | `years_of_control.json.gz` | `br_id, team, date, season, seasons_left_with_salary` | seasons under contract on the decision's date. Options are marked only for current contracts; before 2026-27 the page says "option history not available". |
| `payroll` (season) | `team_payroll_history.json` `teams["YYYY-YY|TEAM"]` | `team_salary` | × the GM's share of that season |
| `tax_paid` (season) | same | `tax_owed` | × share |
| `apron_status` (season) | same | `line` (`under the cap`, `over the cap`, `taxpayer`, `apron`) | mapped to `salary_slots.APRON_STATUS`. Second-apron seasons need Module 6 to split `apron`. |
| `dead_money` (season) | same | `dead_money_rows` | summed, × share |
| `value_per_dollar` (season) | derived | — | `produced_margin` ÷ (`payroll` / $1M) |
| `cap_outlook` (active spells) | `team_payroll_2026_27.json` `teams[TEAM]`, then `contracts_current.json` | `team_salary, dead_money, line`; `seasons` per contract | `{payroll, cap_space, tax, apron_status}`, this season and the seasons after |
| `years_of_control` (Inherited and Left behind rows) | `years_of_control.json.gz` | `seasons_left_with_salary` at the spell's first or last day | shown beside each asset |

## 3. Where the fields already sit (null today)

| reader | place | fields |
|---|---|---|
| page files | `public/gms/g/<gm>.json` → `spells[]` | `payroll_per_season, tax_paid, dead_money, value_per_dollar, cap_outlook` |
| | `spells[].inherited_list[]`, `left_list[]` | `years_of_control` |
| | `decisions[]` | `salary_cost, cap_hit, value_per_dollar, dead_money, years_of_control` |
| | `public/gms/index.json` → `meta.salaries` | `available, arrives, changes, note` |
| Data Room | `gm_decisions` (last five columns) | `salary_cost, cap_hit, value_per_dollar, dead_money, years_of_control` |
| | `gm_seasons` (last five columns) | `payroll, tax_paid, apron_status, dead_money, value_per_dollar` |
| | `public/gms/data/dictionary.json` | each column's unit (dollars, points per $1M, seasons, text) and "null until 1.1.0" |
| connector | `nba_get_gm_profile` → `spells[].salaries` and `salaries` | as the spell fields; meta |
| | `nba_gm_decisions` → `decisions[]` | as the decision fields |
| | the answers' text | a "Salaries: not in NBA GM Savant yet" line, dropped when `available` |

The upfront tool text is unchanged (89,881 of the 90,000-character cap): the fields ride in the structured outputs, not in the schemas.

## 4. How the page renders them (`page/app.js`)

- **The banner** (`#salaries`): shown while `meta.salaries.available` is false. Its list is `meta.salaries.changes`, the same list as section 5.
- **Badges** (`soon(key)`): each opens the banner at its own line.
  - **Free agency** (`fa`): the skill row and its Leaders board.
  - **Re-signing and extensions** (`resign`): the skill row and its board.
  - **Trades** (`trades`): the "as they turned out" row and its board.
  - **Inherited and Left behind** (`lists`): both list headers.
  - **Left in free agency** (`left_fa`): the "not counted in what he left" line, and the log when filtered to that type.
  - **Cap outlook** (`cap`): the "coming soon" card in Today's roster.
- **When values are present** the badges vanish (`SALON()`), and:
  - the card's GM Value Added tiles add value per dollar, payroll, tax paid and dead money;
  - the decision log adds five columns (cost, cap hit, value per $1M, dead money, years of control);
  - list rows show "n yrs of control";
  - the cap outlook card shows payroll, apron status and cap space.

## 5. What will move in 1.1.0

| number | why | code |
|---|---|---|
| **Inherited, Left behind**, and so **GM Value Added**, its percentiles and ranks, **expected titles added**, the **blend** | Only seasons under contract (plus the rights a team holds: restricted free agency, rookie scale) count, instead of ten seasons for every player. A star about to walk stops counting as left (Shaq 1996 for Pat Williams). | `gm5.pv_rates`, `gm5.realized_rates`, `build_page.value_of` and `value_to`: cap each player's seasons at `salary_slots.asset()`. `titlecurve.rate_level_*` follow the value. |
| The walks-first rule | Replaced by contract expiry dates; today it infers "left in free agency before a game for the next GM". | `gm5.walks_first` |
| **"Left in free agency" decisions** (4,702) | Dated by the contract's end instead of inferred from the last game played (`ledger.py` "lapsed (inferred)"), so some move a season and their grades with them. Ids are unchanged (`grade.stable_id`). | `ledger.py` lapse rule, `grade.py` lines that handle `lapsed (inferred)` |
| **Free agency, Re-signing, Trades** skills | Value per dollar beside the value. The value grades themselves stay value-only, unless Adam decides otherwise. | `gm5_detail` skills; `repeat6.py` re-tests re-signing on value against cost |
| **Re-signing percentile** | Withheld today ("may reflect the stars he had"); it can be tested once value is set against cost. | `gm5.py` (`repeats` and `note` for re-signing), `build_page.py` |
| **Cap outlook** | New. | `build_page.py` card, `salary_slots.spell` |

**What will not move:** produced (margin), the title model, at-the-time grades already frozen (`GM_FREEZE`), draft grades, holding, and lottery and playoff luck.

## 6. Text to change with it

Explainers in `page/explainers.json`:
- **Rewrite:** `cap`, `fa`, `resign`, `left`, `left_fa`, `trades_out`, `style` (its "Value per dollar … arrive with salaries"), and `gva`'s limits ("Salaries are not in it yet").
- **Add:** a value-per-dollar explainer.

Elsewhere:
- **Notes:** `build_page.NOTES` "Salaries" and "Re-signing".
- **Changelog:** `build_page.CHANGELOG` 1.1.0 (from 'coming' to a date).
- **Site What's New:** `src/data/updates.json`.
- **Docs:** the "Salaries" line in the connector's answers, and `README.md`.

## 7. Checks to add with it

- **`tools/savant-gm/check.mjs`:** with `available` false, every salary field is null. With it true, the fields are numbers or null, never strings. `value_per_dollar` matches `turned_out / (salary_cost / 1e6)` to one decimal.
- **`tools/savant-gm/tap.mjs`:** badges are present when `available` is false and absent when it is true. The banner opens at the tapped badge's line.
- **`conserve.py`:** conservation still holds after the control-year cap. Left and inherited both shrink, so team-season totals keep adding up.
- **`test_gm.py`:** the incremental night still equals the full rebuild with salaries in.
