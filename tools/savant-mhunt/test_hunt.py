"""
test_hunt.py — hunt.py's expected-value math on a hand-worked example.

    python3 tools/savant-mhunt/test_hunt.py

THE EXAMPLE. One defender D1 guards three offensive players; one of them, O3, is also guarded by
a second defender D2. Partial possessions (the matchup table):
    D1-O1 50   D1-O2 30   D1-O3 20   D2-O3 80
So O1 has 50 possessions in all, O2 30, O3 100. Synergy isolation possessions:
    offense  O1 10, O2 none (under the floor, counts 0), O3 20     -> 30
    defense  D1 12, D2 15                                          -> 27
With K = 0 (no shrinkage) each player's rate is his own:
    O1 10/50 = 0.2    O2 0/30 = 0    O3 20/100 = 0.2
The defensive table holds 27 of the offense's 30, so expected is scaled by 0.9:
    D1 expected = 0.9 × (0.2×50 + 0×30 + 0.2×20) = 0.9 × 14 = 12.6
    D2 expected = 0.9 × (0.2×80)                 = 0.9 × 16 = 14.4
Expected adds up to 27, the actual total, so the season multiplier is 1 and
    mhunt(D1) = 100 × (12 − 12.6) / 100 = −0.60     (avoided)
    mhunt(D2) = 100 × (15 − 14.4) /  80 = +0.75     (targeted)
Then the floor: add D3, guarding O1 for 40 possessions and listed in another Synergy defensive
table but not the isolation one, and D4 in no Synergy table at all.
"""
import os
import sys
import unittest

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "pipeline", "basketball"))
import hunt as H  # noqa: E402


def matchups(rows):
    return pd.DataFrame(rows, columns=["DEF_PLAYER_ID", "OFF_PLAYER_ID", "PARTIAL_POSS"])


PAIRS = [(1, 101, 50), (1, 102, 30), (1, 103, 20), (2, 103, 80)]
ISO_OFF = {101: 10.0, 103: 20.0}
ISO_DEF = {1: 12.0, 2: 15.0}


class HandWorked(unittest.TestCase):
    def setUp(self):
        self.k = H.K
        H.K = 0.0

    def tearDown(self):
        H.K = self.k

    def players(self, ids):
        return [{"id": i, "pos": "Guard", "qualified": True} for i in ids]

    def test_expected_and_mhunt(self):
        pl = self.players([1, 2, 101, 102, 103])
        n, why = H.apply_season("2025-26", pl, matchups(PAIRS), ISO_OFF, ISO_DEF, {1, 2})
        self.assertEqual((n, why), (2, {}))
        by = {p["id"]: p["m"] for p in pl if p.get("m")}
        self.assertAlmostEqual(by[1]["mhunt_exp"]["season"]["v"], 12.6, places=3)
        self.assertAlmostEqual(by[2]["mhunt_exp"]["season"]["v"], 100 * 14.4 / 80, places=3)
        self.assertAlmostEqual(by[1]["mhunt"]["season"]["v"], -0.60, places=3)
        self.assertAlmostEqual(by[2]["mhunt"]["season"]["v"], 0.75, places=3)
        self.assertEqual(by[1]["mhunt"]["season"]["n"], 100)
        self.assertEqual(by[2]["mhunt"]["season"]["n"], 80)
        self.assertAlmostEqual(by[1]["mhunt_faced"]["season"]["v"] - by[1]["mhunt_exp"]["season"]["v"], by[1]["mhunt"]["season"]["v"], places=3)

    def test_floor_and_not_tracked(self):
        pairs = PAIRS + [(3, 101, 40), (4, 102, 10)]
        pl = self.players([1, 2, 3, 4, 101, 102, 103])
        H.apply_season("2025-26", pl, matchups(pairs), ISO_OFF, ISO_DEF, {1, 2, 3})
        by = {p["id"]: p["m"] for p in pl if p.get("m")}
        # D3 is in Synergy's other tables and his expected (0.9 × 0.2 × 40 = 7.2 before the multiplier)
        # is small enough that facing under 10 is ordinary: "under 10 faced", valued at 9
        self.assertEqual(by[3]["mhunt"]["season"]["note"], "floor")
        self.assertAlmostEqual(by[3]["mhunt_faced"]["season"]["v"], 100 * 9 / 40, places=3)
        # D4 is in no Synergy table: no value, said why
        self.assertIsNone(by[4]["mhunt"]["season"]["v"])
        self.assertEqual(by[4]["mhunt"]["season"]["note"], "not_tracked")
        # expected still adds up to faced over everyone with a value (D3 at its bound)
        faced = sum(by[d]["mhunt_faced"]["season"]["v"] * by[d]["mhunt"]["season"]["n"] / 100 for d in (1, 2, 3))
        exp = sum(by[d]["mhunt_exp"]["season"]["v"] * by[d]["mhunt"]["season"]["n"] / 100 for d in (1, 2, 3))
        self.assertAlmostEqual(faced, exp, places=2)

    def test_seasons_withheld(self):
        pl = self.players([1, 2, 101, 102, 103])
        n, why = H.apply_season("2023-24", pl, matchups(PAIRS), ISO_OFF, ISO_DEF, {1, 2})
        self.assertEqual(n, 0)
        self.assertIn("35 regular defenders", why["mhunt"])
        # in season: withheld while more than 10% of qualified defenders are missing from the table
        n, why = H.apply_season("2026-27", self.players([1, 2, 3, 4, 101]), matchups(PAIRS), ISO_OFF, {1: 12.0}, {1}, live=True)
        self.assertEqual(n, 0)
        self.assertIn("80% of qualified defenders", why["mhunt"])


class Shrinkage(unittest.TestCase):
    def test_prior_pulls_a_thin_player_toward_players_like_him(self):
        # with K = 211, O2 (0 isolations on 30 possessions) is pulled up toward the rate of guards
        # in his quartile; O3's own 100 possessions keep him nearer his own 0.2
        f = H.pair_frame(matchups(PAIRS))
        t = H.table(f, {i: "Guard" for i in (101, 102, 103)}, ISO_OFF, ISO_DEF, {1, 2}, {1, 2})
        self.assertAlmostEqual(t.e.sum(), 27.0, places=6)          # the season multiplier
        self.assertTrue(t.loc[1, "e"] > 0 and t.loc[2, "e"] > 0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
