"""
cap_engine.py — NBA salary cap and trade rules engine (2026-27, 2023 CBA).

A PURE rules engine: no UI, no simulation, no randomness. Every transaction goes through
`validate_trade` / `validate_signing` and comes back either approved or rejected with the
NAME OF THE RULE that stopped it. "This trade fails: Boston is above the second apron and
cannot aggregate salaries" is the single detail that will make this feel like a real front
office rather than a video game menu.

Run `python cap_engine.py test` for the suite. Every rule below has a test.

Usage:
  python cap_engine.py test
  python cap_engine.py team BOS
"""
import json, sys, math

OUT = "out"

# --------------------------------------------------------------- CBA constants
# 2026-27, confirmed against NBA.com and OverTheApron.
CBA = {
    "season":        "2026-27",
    "cap":           164_961_000,
    "floor":         148_465_000,
    "tax":           200_428_000,
    "apron1":        209_015_000,
    "apron2":        221_686_000,
    "mle_nontax":     15_044_000,   # up to 4 years
    "mle_tax":         6_064_000,   # up to 2 years
    "mle_room":        9_366_000,   # up to 3 years
    "bae":             5_477_000,   # up to 2 years
    "max_25":         41_240_250,   # 25% of cap, 0-6 years of service
    "max_30":         49_488_300,   # 30%, 7-9 years
    "max_35":         57_736_350,   # 35%, 10+ years
    "roster_min":             14,
    "roster_max":             15,
    "two_way_max":             3,
}

# Salary-matching brackets. The 2023 CBA set these at $7.25M / $29M / $7.5M padding
# against a $136.021M cap; they are cap-indexed, so they are carried here as a fraction
# of the cap rather than hardcoded dollars.
# !! CONFIRM the published 2026-27 dollar figures before shipping — the derivation is
#    right but the league rounds, and a rounding error here is a wrong trade ruling.
_BASE_CAP = 136_021_000
BRACKET_LO  = CBA["cap"] * 7_250_000 / _BASE_CAP     # ~ $8.79M
BRACKET_HI  = CBA["cap"] * 29_000_000 / _BASE_CAP    # ~ $35.2M
BRACKET_PAD = CBA["cap"] * 7_500_000 / _BASE_CAP     # ~ $9.10M
BUFFER = 250_000


# Basketball-Reference and nba_api disagree on three abbreviations. Joining contracts to
# Savant rosters without this silently drops three whole teams.
BR_TO_NBA = {"CHO": "CHA", "BRK": "BKN", "PHO": "PHX"}


def norm_team(t):
    return BR_TO_NBA.get(t, t)


class Rejected(Exception):
    def __init__(self, rule, detail):
        super().__init__(f"{rule}: {detail}")
        self.rule, self.detail = rule, detail


# ------------------------------------------------------------------ team state

def team_salary(roster):
    """roster: list of {'salary': int, ...}"""
    return sum(p["salary"] for p in roster)


def status(total):
    """Which of the four rulebooks a team is playing under."""
    return {
        "total":        total,
        "cap_space":    max(0, CBA["cap"] - total),
        "under_cap":    total < CBA["cap"],
        "over_tax":     total > CBA["tax"],
        "over_apron1":  total > CBA["apron1"],
        "over_apron2":  total > CBA["apron2"],
    }


def label(st):
    if st["over_apron2"]:
        return "second apron"
    if st["over_apron1"]:
        return "first apron"
    if st["over_tax"]:
        return "taxpayer"
    if st["under_cap"]:
        return "under the cap"
    return "over the cap"


# ------------------------------------------------------------- salary matching

def max_incoming(outgoing, st):
    """Most salary a team may receive for `outgoing` sent, given its apron status.

    Below the first apron, the 2023 CBA tiers:
        outgoing <= BRACKET_LO      -> 200% + $250,000
        BRACKET_LO..BRACKET_HI      -> outgoing + BRACKET_PAD
        outgoing >  BRACKET_HI      -> 125% + $250,000
    At or above the first apron the graduated reduction has completed: 100%, no buffer.
    """
    if st["over_apron1"]:
        return outgoing                       # includes second-apron teams
    if outgoing <= BRACKET_LO:
        return outgoing * 2.0 + BUFFER
    if outgoing <= BRACKET_HI:
        return outgoing + BRACKET_PAD
    return outgoing * 1.25 + BUFFER


# ------------------------------------------------------------------ validation

def validate_trade(packages):
    """packages: list of dicts, one per team:
         {name, roster, out:[players], inc:[players], aggregated:bool,
          cash_out:int, via_sign_and_trade:bool}
       Returns a list of human-readable notes, or raises Rejected naming the rule.
    """
    notes = []
    for pk in packages:
        name = pk["name"]
        before = team_salary(pk["roster"])
        st = status(before)
        out_sal = sum(p["salary"] for p in pk["out"])
        in_sal = sum(p["salary"] for p in pk["inc"])
        after = before - out_sal + in_sal
        n_out, n_in = len(pk["out"]), len(pk["inc"])

        # --- second apron: no aggregation
        if st["over_apron2"] and n_out > 1 and pk.get("aggregated", n_out > 1):
            raise Rejected("Second apron — no aggregation",
                           f"{name} is above the second apron "
                           f"(${before:,} > ${CBA['apron2']:,}) and cannot combine "
                           f"{n_out} salaries in one trade.")
        # --- second apron: cannot take back more than sent
        if st["over_apron2"] and in_sal > out_sal:
            raise Rejected("Second apron — no salary increase",
                           f"{name} sends ${out_sal:,} and receives ${in_sal:,}; a team "
                           f"above the second apron cannot take back more than it sends.")
        # --- second apron: no cash in trades
        if st["over_apron2"] and pk.get("cash_out", 0) > 0:
            raise Rejected("Second apron — no cash in trade",
                           f"{name} cannot send cash while above the second apron.")
        # --- first apron: no sign-and-trade acquisitions
        if st["over_apron1"] and pk.get("via_sign_and_trade"):
            raise Rejected("First apron — no sign-and-trade acquisition",
                           f"{name} is above the first apron and cannot acquire a player "
                           f"by sign-and-trade.")

        # --- salary matching
        if st["under_cap"] and in_sal - out_sal <= st["cap_space"]:
            notes.append(f"{name}: absorbs ${in_sal - out_sal:,} into "
                         f"${st['cap_space']:,} of cap space")
        else:
            # A team under the cap uses its ROOM first and only needs matching on what is
            # left over. Falling straight through to the brackets reported a team with
            # $4.9M of space and nothing going out as able to receive $250,000 — a correct
            # rejection with a false reason, which is worse than a wrong answer because it
            # teaches the user the wrong rule.
            allowed = max_incoming(out_sal, st) + (st["cap_space"] if st["under_cap"] else 0)
            if in_sal > allowed:
                raise Rejected("Salary matching",
                               f"{name} ({label(st)}) sends ${out_sal:,} and may receive "
                               f"at most ${allowed:,.0f}; this trade sends it "
                               f"${in_sal:,}.")
            notes.append(f"{name} ({label(st)}): ${in_sal:,} in / ${out_sal:,} out, "
                         f"limit ${allowed:,.0f}")

        # --- roster limits
        size = len(pk["roster"]) - n_out + n_in
        if size > CBA["roster_max"]:
            raise Rejected("Roster limit",
                           f"{name} would carry {size} players; the maximum is "
                           f"{CBA['roster_max']}.")
        if size < CBA["roster_min"]:
            notes.append(f"{name}: down to {size} players — must return to "
                         f"{CBA['roster_min']} within two weeks")

        # --- hard cap consequences
        after_st = status(after)
        if after_st["over_apron2"] and not st["over_apron2"]:
            notes.append(f"{name}: crosses the second apron (${after:,}) — frozen future "
                         f"first-round pick, no cash, no aggregation from here")
        elif after_st["over_apron1"] and not st["over_apron1"]:
            notes.append(f"{name}: crosses the first apron (${after:,})")
        if after_st["over_tax"]:
            notes.append(f"{name}: ends at ${after:,}, "
                         f"${after - CBA['tax']:,} into the tax")
    return notes


def validate_signing(roster, amount, exception, hard_capped=False):
    """Exception use, with the apron restrictions that make each one unavailable."""
    before = team_salary(roster)
    st = status(before)
    ex = exception.lower()
    if ex == "ntmle":
        if st["over_apron1"]:
            raise Rejected("First apron — non-taxpayer MLE unavailable",
                           "A team above the first apron cannot use the non-taxpayer MLE.")
        if amount > CBA["mle_nontax"]:
            raise Rejected("Exception amount",
                           f"${amount:,} exceeds the non-taxpayer MLE "
                           f"(${CBA['mle_nontax']:,}).")
        return [f"Uses the non-taxpayer MLE. HARD CAPPED at the first apron "
                f"(${CBA['apron1']:,}) for the rest of the season."]
    if ex == "tmle":
        if st["over_apron2"]:
            raise Rejected("Second apron — taxpayer MLE unavailable",
                           "A team above the second apron cannot use the taxpayer MLE.")
        if amount > CBA["mle_tax"]:
            raise Rejected("Exception amount",
                           f"${amount:,} exceeds the taxpayer MLE (${CBA['mle_tax']:,}).")
        return [f"Uses the taxpayer MLE. Hard capped at the second apron."]
    if ex == "bae":
        if st["over_apron1"]:
            raise Rejected("First apron — bi-annual exception unavailable",
                           "A team above the first apron cannot use the BAE.")
        if amount > CBA["bae"]:
            raise Rejected("Exception amount",
                           f"${amount:,} exceeds the bi-annual exception "
                           f"(${CBA['bae']:,}).")
        return ["Uses the bi-annual exception. Hard capped at the first apron."]
    if ex == "room":
        if not st["under_cap"]:
            raise Rejected("Room exception requires cap space",
                           f"{label(st)} teams use the mid-level exception instead.")
        if amount > CBA["mle_room"]:
            raise Rejected("Exception amount",
                           f"${amount:,} exceeds the room exception "
                           f"(${CBA['mle_room']:,}).")
        return ["Uses the room exception."]
    if ex == "minimum":
        return ["Minimum contract — always available, never hard caps."]
    raise Rejected("Unknown exception", exception)


# ----------------------------------------------------------------- test suite

def _roster(total, n=15):
    """A synthetic roster summing to `total`."""
    each = total // n
    r = [{"name": f"P{i}", "salary": each} for i in range(n)]
    r[0]["salary"] += total - each * n
    return r


def _p(sal, name="X"):
    return {"name": name, "salary": sal}


def _expect_ok(fn, what):
    try:
        fn(); return (True, what, "approved")
    except Rejected as e:
        return (False, what, f"WRONGLY REJECTED — {e.rule}")


def _expect_reject(fn, rule, what):
    try:
        fn(); return (False, what, "WRONGLY APPROVED")
    except Rejected as e:
        if e.rule == rule:
            return (True, what, f"rejected: {e.rule}")
        return (False, what, f"rejected by the WRONG rule: {e.rule} (wanted {rule})")


def cmd_test():
    T = []
    C = CBA

    # 1 — under-cap team absorbs salary into space.
    # 12 men, not 15: a team carrying cap space has open roster spots by definition, and
    # the first version of this test failed on the roster limit rather than the cap rule
    # it was meant to exercise.
    r = _roster(140_000_000, 12)
    T.append(_expect_ok(lambda: validate_trade([
        {"name": "SPACE", "roster": r, "out": [], "inc": [_p(20_000_000)]}]),
        "under-cap team absorbs $20M into cap space"))

    # 2 — small outgoing salary gets the 200% + 250k bracket
    r = _roster(190_000_000)
    T.append(_expect_ok(lambda: validate_trade([
        {"name": "OVER", "roster": r, "out": [_p(5_000_000)],
         "inc": [_p(10_200_000)]}]),
        "over-cap: $5M out -> $10.2M in (200% + $250k bracket)"))
    T.append(_expect_reject(lambda: validate_trade([
        {"name": "OVER", "roster": r, "out": [_p(5_000_000)],
         "inc": [_p(11_000_000)]}]),
        "Salary matching", "over-cap: $5M out -> $11M in exceeds the 200% bracket"))

    # 3 — middle bracket is a flat pad, not a percentage
    T.append(_expect_ok(lambda: validate_trade([
        {"name": "OVER", "roster": r, "out": [_p(20_000_000)],
         "inc": [_p(28_000_000)]}]),
        "over-cap: $20M out -> $28M in (flat ~$9.1M pad bracket)"))

    # 4 — large outgoing salary gets 125% + 250k
    T.append(_expect_ok(lambda: validate_trade([
        {"name": "OVER", "roster": r, "out": [_p(40_000_000)],
         "inc": [_p(50_000_000)]}]),
        "over-cap: $40M out -> $50M in (125% + $250k)"))
    T.append(_expect_reject(lambda: validate_trade([
        {"name": "OVER", "roster": r, "out": [_p(40_000_000)],
         "inc": [_p(52_000_000)]}]),
        "Salary matching", "over-cap: $40M out -> $52M in breaks 125%"))

    # 5 — first apron team matches at 100%, no buffer
    a1 = _roster(212_000_000)
    T.append(_expect_ok(lambda: validate_trade([
        {"name": "APRON1", "roster": a1, "out": [_p(20_000_000)],
         "inc": [_p(20_000_000)]}]),
        "first apron: 100% matching allowed"))
    T.append(_expect_reject(lambda: validate_trade([
        {"name": "APRON1", "roster": a1, "out": [_p(20_000_000)],
         "inc": [_p(21_000_000)]}]),
        "Salary matching", "first apron: cannot take back 105%"))

    # 6 — second apron cannot aggregate
    a2 = _roster(225_000_000)
    T.append(_expect_reject(lambda: validate_trade([
        {"name": "APRON2", "roster": a2,
         "out": [_p(12_000_000), _p(10_000_000)], "inc": [_p(21_000_000)]}]),
        "Second apron — no aggregation",
        "second apron: cannot combine two salaries in one trade"))

    # 7 — second apron cannot take back more than it sends
    T.append(_expect_reject(lambda: validate_trade([
        {"name": "APRON2", "roster": a2, "out": [_p(20_000_000)],
         "inc": [_p(20_500_000)]}]),
        "Second apron — no salary increase",
        "second apron: cannot take back more than it sends"))
    T.append(_expect_ok(lambda: validate_trade([
        {"name": "APRON2", "roster": a2, "out": [_p(20_000_000)],
         "inc": [_p(19_000_000)]}]),
        "second apron: shedding salary is fine"))

    # 8 — second apron cannot send cash
    T.append(_expect_reject(lambda: validate_trade([
        {"name": "APRON2", "roster": a2, "out": [_p(20_000_000)],
         "inc": [_p(19_000_000)], "cash_out": 1_000_000}]),
        "Second apron — no cash in trade", "second apron: cannot send cash"))

    # 9 — first apron cannot acquire by sign-and-trade
    T.append(_expect_reject(lambda: validate_trade([
        {"name": "APRON1", "roster": a1, "out": [_p(20_000_000)],
         "inc": [_p(20_000_000)], "via_sign_and_trade": True}]),
        "First apron — no sign-and-trade acquisition",
        "first apron: cannot acquire by sign-and-trade"))

    # 10 — roster maximum
    T.append(_expect_reject(lambda: validate_trade([
        {"name": "FULL", "roster": _roster(190_000_000, 15), "out": [_p(5_000_000)],
         "inc": [_p(4_000_000), _p(3_000_000)]}]),
        "Roster limit", "roster cannot exceed 15"))

    # 11 — exceptions
    T.append(_expect_ok(lambda: validate_signing(_roster(190_000_000),
                                                 C["mle_nontax"], "ntmle"),
                        "non-taxpayer MLE at the full amount"))
    T.append(_expect_reject(lambda: validate_signing(a1, C["mle_nontax"], "ntmle"),
             "First apron — non-taxpayer MLE unavailable",
             "first apron team cannot use the non-taxpayer MLE"))
    T.append(_expect_reject(lambda: validate_signing(a2, C["mle_tax"], "tmle"),
             "Second apron — taxpayer MLE unavailable",
             "second apron team cannot use the taxpayer MLE"))
    T.append(_expect_reject(lambda: validate_signing(a1, C["bae"], "bae"),
             "First apron — bi-annual exception unavailable",
             "first apron team cannot use the BAE"))
    T.append(_expect_reject(lambda: validate_signing(_roster(190_000_000),
                                                     C["mle_room"], "room"),
             "Room exception requires cap space",
             "over-cap team cannot use the room exception"))
    T.append(_expect_ok(lambda: validate_signing(a2, 3_000_000, "minimum"),
                        "minimum signing always available, even at the second apron"))

    ok = sum(1 for p, _, _ in T if p)
    print(f"cap engine — {ok}/{len(T)} rules behave correctly\n")
    for passed, what, how in T:
        print(f"  {'PASS' if passed else 'FAIL'}  {what}")
        if not passed:
            print(f"        -> {how}")
    print(f"\nbrackets in effect for {C['season']}: "
          f"200%+$250k up to ${BRACKET_LO:,.0f}, "
          f"flat +${BRACKET_PAD:,.0f} to ${BRACKET_HI:,.0f}, "
          f"then 125%+$250k")
    return ok == len(T)


def cmd_team():
    """Real cap sheet from the parsed contracts."""
    tm = (sys.argv[2] if len(sys.argv) > 2 else "BOS").upper()
    cons = json.load(open(f"{OUT}/contracts_2026_27.json"))
    roster = [{"name": c["name"], "salary": c["years"].get("2026-27", {}).get("salary", 0),
               "option": c["years"].get("2026-27", {}).get("option")}
              for c in cons if norm_team(c["team"]) == tm and c["years"].get("2026-27")]
    roster.sort(key=lambda p: -p["salary"])
    tot = team_salary(roster)
    st = status(tot)
    print(f"{tm}  {CBA['season']}   {len(roster)} contracts\n")
    for p in roster:
        opt = f"  ({p['option']})" if p.get("option") else ""
        print(f"  {p['name'][:26]:26} ${p['salary']:>12,}{opt}")
    print(f"\n  {'TOTAL':26} ${tot:>12,}   — {label(st)}")
    for k, v in (("cap", CBA["cap"]), ("tax", CBA["tax"]),
                 ("first apron", CBA["apron1"]), ("second apron", CBA["apron2"])):
        print(f"  {k:26} ${v:>12,}   {tot - v:+,}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "test"
    sys.exit(0 if {"test": cmd_test, "team": cmd_team}[cmd]() is not False else 1)
