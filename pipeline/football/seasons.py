"""Which seasons a pipeline stage works on.

Every stage used to carry its own `range(1999, 2026)`, which meant a new season needed
five edits and a full 27-season rebuild to appear. Now they all read the same thing:

  NFL_SEASONS   "2026"  |  "2024,2025"  |  "1999-2026"      (unset: 1999 .. current season)

The current season is the calendar year from August on, and the previous year before that,
because the NFL's year straddles New Year's — January 2027 is still the 2026 season.

A stage asked for a season whose source files don't exist yet (the first days of September,
before nflverse has posted anything for the new year) just skips it; that is not an error.
"""
import datetime
import os

FIRST = 1999


def current_season(today=None):
    today = today or datetime.date.today()
    return today.year if today.month >= 8 else today.year - 1


def seasons(first=FIRST, key='NFL_SEASONS'):
    spec = (os.environ.get(key) or '').strip()
    if not spec:
        return list(range(first, current_season() + 1))
    out = []
    for part in spec.split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return sorted(set(out))
