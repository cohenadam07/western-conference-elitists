# -*- coding: utf-8 -*-
"""The coaching tree's editorial layer.

Unlike football's, the NBA tree is computed first: Basketball-Reference records assistant
stints for every man who later became a head coach, and the NBA's staff tables name whole
staffs from the 2000s on, so modules.suggest_mentors proposes each coach's mentor as the head
coach he served under for the most seasons (ties go to the last one before his first head
job). This file is where a suggestion is corrected or completed by hand: a coach whose real
influence was someone he never worked for on an NBA staff (a college coach, a father, an
international mentor), or a tie the data cannot break.

Every override names its source. Rows marked unconfirmed show on the page as such and on the
review list. An override replaces the suggestion; `also` is added to the "also shaped by" list.
"""

TREE_NOTE = (
    "Each coach's mentor is suggested from the record: the head coach he served under for the most "
    "seasons on an NBA staff (Basketball-Reference's assistant stints and the NBA's staff tables), "
    "with ties going to the last one before his first head job. A tree allows one parent and a career "
    "has several, so the others he served under are listed on his page. Hand corrections, each with its "
    "source, are in pipeline/basketball/coaching/coach_tree_nba.py. A coach shown as a root is one with "
    "no recorded NBA assistant stint, not one who learned nothing from anyone."
)

# slug -> dict(mentor=slug or None, role=text, also=[(slug, role)], source=url, unconfirmed=bool)
OVERRIDES = {
    # Gregg Popovich: an assistant under Larry Brown in San Antonio (1988-92) and Don Nelson at Golden
    # State (1992-94); the record has both, Brown is the one he names.
    "popovgr99c": dict(mentor="brownla01c", role="assistant coach, San Antonio Spurs, 1988-92",
                       also=[("nelsodo01c", "assistant coach, Golden State Warriors, 1992-94")],
                       source="https://www.basketball-reference.com/coaches/popovgr99c.html", unconfirmed=False),
    # Phil Jackson: the record shows only his Bulls assistant years under Doug Collins; the triangle came
    # from Tex Winter and his playing career under Red Holzman, neither a head coach he assisted.
    "jacksph01c": dict(mentor="collido01c", role="assistant coach, Chicago Bulls, 1987-89",
                       also=[("holzmre01c", "played for him with the Knicks, 1967-78")],
                       source="https://www.basketball-reference.com/coaches/jacksph01c.html", unconfirmed=False),
}

# Named only as mentors, never head coaches of record in the window (shown without a page)
BRIDGE = []
