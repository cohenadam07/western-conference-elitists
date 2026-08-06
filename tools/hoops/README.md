# Flap Hoops tooling

Run everything from this directory (`cd tools/hoops`). No network, no credentials, no browser.

| command | what it does |
|---|---|
| `node solver.mjs` | Beam-search every hole. Prints par and fails loudly on an unsolvable level. **Run this after touching any level or physics constant.** |
| `node audit.mjs` | Asks whether each modifier actually earns its place. See below. |
| `node race_test.mjs` | Drives `api/race.js` end to end against an in-memory Upstash and a controllable clock — party, verified finishes, scoring, a full nine-hole match. |
| `node devserver.mjs` | Serves the built `dist/` plus `/api/race` and `/api/dynasty` on :8811, backed by in-memory Redis. Run `npm run build` first. |

## Reading the audit

`solver.mjs` finds a near-optimal line. `audit.mjs` deletes one modifier at a time and re-solves,
which answers "would anyone notice if this were not here".

Enablers (`gush`, `lasso`, `bronco`, `stepback`) and hazards (`weed`, `cannon`, `dead`) need
**opposite** tests, and getting this wrong is easy — this file took four attempts:

* Deleting an enabler should make the hole **harder**. `+19` means the gusher saves nineteen
  flaps; `DEAD` means the route ignores it.
* Deleting a hazard makes the hole **easier**, so "par went up" is backwards. Nor is "does the
  best line hit it" right — a good line *dodges*, and dodging is the gameplay. Hazards are
  measured in **time**, because waiting for a gap is free in par but decisive in a race.
* Same-type modifiers are usually a **set**. Pull one plank of four and the others cover for it,
  so each looks redundant while the group is the entire hole. The audit reports both.

## Designing a hole that works

A modifier only earns its place if the alternative is genuinely worse:

* **chimney** — walls both sides, the lift inside, no other way up (gusher, measured +19)
* **corridor** — a low roof funnelling onto a pad, and a wall too tall to climb (bronco, +9)
* **tunnel** — a passage too short to duck in, so a hazard cannot be flown over

The recurring trap: in open space, flapping is free and unlimited, so every enabler competes
with "just flap" and loses. Tight corridors are what make footing and lift matter.
