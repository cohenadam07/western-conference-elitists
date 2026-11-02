---
name: wce-house-style
description: WCE's visual and editorial house style for every wcehoops.com page and data product (Savant pages, player and team cards, charts, explainers). Use before designing or changing any page, card, chart or explainer on wcehoops.com. Its brand rules override generic design guidance, including Taste Skill and Impeccable.
---

# WCE house style

## Precedence
This file is the brief. When Taste Skill, Impeccable or any other guidance disagrees, this file wins.

- WCE's cream background, gold underline rule, mono labels and serif display type are the brand, not template tells.
- Use Taste Skill's app-screen rules for craft: layout, hierarchy, density, empty and error states, focus states, motion restraint, plain copy.
- Use Impeccable as the last check before shipping, not as a source of style.

## Tokens
These are the values on the live pages; read `:root` in `public/basketball-coaching-savant.html` for the current exact set.

- Background and cream `#ECEBE8`, surface `#FFFFFF`, sunk `#F6F5F2`
- Ink `#191B1F`, muted `#4E535B`, faint `#8B9099`, line `#E1E0DC`, track `#E9E8E4`
- Navy `#22395A` (accent), gold `#C2A263`, red `#BC3A2C`
- Percentile scale, diverging: low `#1C4E86` → mid `#C2C0B6` → high `#BC3A2C`
- Hatching below settle points: `rgba(20,26,32,.22)`
- Type: display Newsreader (serif); body IBM Plex Sans; labels and numbers IBM Plex Mono
- Breakpoints 840px and 640px. Honor `prefers-reduced-motion`.
- Motif: the gold underline rule.

## Data rules
1. Every percentile names its pool ("vs D1 wings, opponent-adjusted, 2026-27"). A percentile without its pool is a bug.
2. Percentile bars are thick, filled to the percentile and coloured by it, with the number on the bar, as on Basketball Savant. "How much" rows (volume, tendencies, style) use the same bars and are labelled CONTEXT so the colour reads as volume, not quality.
3. A higher percentile is always better. "Lower is better" stats are flipped and say so.
4. Below a stat's settle point, hatch the bar and say "likely to settle at …".
5. "Not tracked" is not zero: show "not tracked" with the season it starts.
6. In text, say "Xth percentile" and state units (per 70, per 100).
7. Every stat has an explainer: what it is, formula, source, sample.
8. Every section shows its start year.

## Components: reuse, don't reinvent
- Percentile bars and stat cells: `public/basketball-savant.html`.
- Tiles, tabs, pills, legends, scroll panels, leader rows: `public/basketball-coaching-savant.html`.
- Court and shot maps: Basketball Savant's heatmaps.
- Headshots from ESPN where they exist; the initials badge in team colors where they don't. Never a broken image.

## Charts
1. One question per chart, and the title states it.
2. Show uncertainty: hatching, intervals on small samples.
3. Everything drills down: career → season → game.
4. Wide charts scroll inside their own panel with names pinned. Never page-level horizontal scroll. Matrices collapse to ranked lists on phones.
5. No radar, no 3D, no pie charts. No raw small-sample table as the main view.
6. Colour goes on data, not chrome, and never alone: values are always labelled.

## Voice
- Editorial magazine voice, not an analytics dump.
- Plain words. Limitations carry an expiration ("not tracked before 2019-20").
- No buy/sell language.
- Model outputs are framed as "the model's view, not a verdict".

## Every product page
- A version number, bumped only on real releases.
- A What's New line.
- A credit line naming sources.
- A link to the AI connector.

## Before shipping a page
- Pools named everywhere; hatching works; "not tracked" kept apart from zero.
- At 375px wide: no horizontal page scroll, tap targets at least 40px, visible focus.
- Text contrast at least 4.5:1 on cream; percentile colors always paired with labels.
- No JS errors; reduced motion respected.
