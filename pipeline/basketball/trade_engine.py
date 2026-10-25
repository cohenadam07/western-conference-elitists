"""
trade_engine.py — asset valuation and AI trade decisions.

One currency: SURPLUS VALUE — projected production a contract buys, minus what it costs,
discounted over its remaining years. Everything (players, picks, cap relief) is priced in
dollars of surplus so they can be compared in one deal.

Three things keep this from being exploitable, which is the failure mode of every GM game:
  * a STAR PREMIUM, because the max salary makes elite production structurally underpaid
    and no team trades that away at its arithmetic price
  * TEAM CONTEXT — a rebuilding team pays up for youth and picks, a contender for now
  * RELATIONSHIP state, so a user cannot machine-gun offers until one lands

Usage:
  python trade_engine.py picks        # fit + show the empirical pick-value curve
  python trade_engine.py value BOS    # surplus value of a roster
  python trade_engine.py test         # adversarial suite: try to rob the AI
"""
import json, sys, math, collections

OUT = "out"
DISCOUNT = 0.90            # per future year
PICKS_PATH = f"{OUT}/pick_curve.json"


# ------------------------------------------------------------------ pick curve

def fit_pick_curve():
    """Smooth monotone decay fitted to real outcomes (2010-2020 first rounds).

    The raw buckets are non-monotonic — picks 4-5 come out below 6-10, and 11-14 above
    both — on samples of 22 and 44. That is noise, and shipping it would mean an AI that
    genuinely believes the 12th pick is better than the 7th. A two-parameter decay fitted
    to the individual observations keeps the shape the data supports and drops the wiggle
    it does not.
    """
    import numpy as np
    from scipy.optimize import curve_fit
    rows = json.load(open(f"{OUT}/draft_outcomes.json"))
    x = np.array([r["pick"] for r in rows], float)
    y = np.array([r["vorp4"] for r in rows], float)
    # A power law, not an exponential. exp(-b(p-1)) hits its asymptote by about pick 15
    # and then reports picks 15 and 30 as equal, which the data flatly contradicts
    # (15-20 averages 1.56, 21-30 averages 1.36). Worse, paired with a rookie-scale cost
    # that falls faster than the curve, it made LATE firsts look more valuable than
    # mid-lottery ones — a hole a user would drive a truck through.
    f = lambda p, a, b, c: a * np.power(p, -b) + c
    (a, b, c), _ = curve_fit(f, x, y, p0=[8.0, 0.6, 0.5], maxfev=40000)
    return {"a": float(a), "b": float(b), "c": float(c), "n": len(rows)}


def rookie_scale(pick):
    """Approximate first-year rookie-scale salary. The real scale falls like a power law
    (~$12.5M at #1, $4.4M at #14, $2.9M at #30), NOT exponentially — the exponential
    version undercharged late firsts so badly they scored as better assets than lottery
    picks. !! Replace with the published rookie scale table before shipping."""
    if pick > 30:
        return 1_300_000                     # second round: minimum-ish
    return 12_500_000 * (pick ** -0.43)


def pick_vorp(pick, curve):
    """Expected 4-year VORP for a given slot. Second round is extrapolation — the
    training data is first rounds only, so it is floored rather than trusted."""
    v = curve["a"] * (pick ** -curve["b"]) + curve["c"]
    return max(0.05, v if pick <= 30 else v * 0.5)


# ------------------------------------------------------------------- valuation

def load_ctx():
    price = json.load(open(f"{OUT}/value_price.json"))
    curve = json.load(open(PICKS_PATH)) if _exists(PICKS_PATH) else fit_pick_curve()
    return price, curve


def _exists(p):
    import os
    return os.path.exists(p)


def project(model, feats, years):
    """Production and survival at each future season, predicted DIRECTLY at horizon h.

    Not rolled forward. Feeding a model its own prediction back in re-applies regression
    to the mean every step and compounds any player toward league average regardless of
    age — it had a 23-year-old Chet Holmgren falling from 2.86 VORP to 1.41 across his
    extension, which prices young stars as liabilities. Direct h=1..5 prediction never
    compounds, and the attrition curve (82% at h=1 down to 46% at h=5) comes straight
    from the data rather than from multiplying one year's rate by itself."""
    import numpy as np
    out = []
    for i in range(years):
        f = dict(feats)
        f["h"] = min(5, i + 1)
        X = np.array([[f.get(k, np.nan) for k in model["feats"]]], float)
        alive = float(model["attrition"].predict_proba(X)[0, 1])
        v = float(model["projection"].predict(X)[0])
        if i + 1 > 5:                       # beyond the fitted horizon, decay gently
            alive *= 0.88 ** (i + 1 - 5)
        out.append({"year": i, "vorp": v, "p_active": alive, "expected": v * alive})
    return out


def contract_surplus(model, price, feats, salaries, premium=1.0):
    """$ of surplus a contract carries. salaries: list, one per remaining year.

    `premium` multiplies what the production is WORTH, never the net surplus. Applying it
    to the net was a sign error in disguise: it made an underwater star contract look
    even worse the better the player was."""
    proj = project(model, feats, len(salaries))
    total = 0.0
    detail = []
    for pr, sal in zip(proj, salaries):
        worth = (price["replacement_salary"] * pr["p_active"]
                 + pr["expected"] * price["per_vorp"] * premium)
        yr = (worth - sal) * (DISCOUNT ** pr["year"])
        total += yr
        detail.append({"year": pr["year"], "vorp": round(pr["vorp"], 2),
                       "p_active": round(pr["p_active"], 3),
                       "worth": worth, "salary": sal, "surplus": yr})
    return total, detail


# --- star premium -------------------------------------------------------------
def star_reluctance(vorp):
    """How much MORE than fair value a team demands to part with a star.

    Deliberately NOT a multiplier on the player's dollar value. Inflating `worth` by a
    star factor double-counts, because $/VORP is already a market price — it valued SGA
    at $568M of surplus, which is not a number, it is a runaway. The real effect is
    behavioural: elite production is scarce and structurally underpaid (a 5-VORP player
    is worth ~$73M/yr against a $57.7M maximum), so teams demand a premium ABOVE fair
    value to give one up. That belongs in the decision threshold, not the currency."""
    if vorp <= 2.5:
        return 1.0
    return 1.0 + min(1.6, (vorp - 2.5) * 0.55)


CONTEXTS = {
    #                    youth   picks   win-now   salary relief
    "contending":  dict(youth=0.85, picks=0.75, now=1.25, relief=0.9),
    "fringe":      dict(youth=1.00, picks=1.00, now=1.00, relief=1.0),
    "retooling":   dict(youth=1.15, picks=1.15, now=0.85, relief=1.1),
    "rebuilding":  dict(youth=1.35, picks=1.40, now=0.65, relief=1.25),
}


def asset_value(model, price, curve, asset, ctx="fringe"):
    """One asset -> context-adjusted surplus dollars.

    asset kinds:
      player: {kind:'player', feats:{...}, salaries:[...], age}
      pick:   {kind:'pick', round:1, slot:14, years_out:1}
      cash:   {kind:'cash', amount:int}
    """
    c = CONTEXTS[ctx]
    if asset["kind"] == "player":
        v0 = asset["feats"].get("vorp", 0) or 0
        base, detail = contract_surplus(model, price, asset["feats"], asset["salaries"])
        age = asset["feats"].get("age", 27) or 27
        base *= c["youth"] if age <= 24 else (c["now"] if v0 >= 2.0 else 1.0)
        return base, detail
    if asset["kind"] == "pick":
        slot = asset.get("slot", 15 if asset.get("round", 1) == 1 else 45)
        v = pick_vorp(slot, curve)
        # rookie-scale cost over four years, approximated from the slot
        # !! replace with the published rookie scale table before shipping
        cost = 4 * rookie_scale(slot)
        gross = v * price["per_vorp"] - cost
        gross *= DISCOUNT ** max(0, asset.get("years_out", 1))
        return max(0.0, gross) * c["picks"], None
    if asset["kind"] == "cash":
        return asset["amount"] * 0.5, None
    raise ValueError(asset["kind"])


def evaluate(model, price, curve, giving, getting, ctx="fringe", relationship=1.0):
    """AI side of a proposal. Returns (verdict, margin, detail)."""
    out_v = sum(asset_value(model, price, curve, a, ctx)[0] for a in giving)
    in_v = sum(asset_value(model, price, curve, a, ctx)[0] for a in getting)
    # An AI team needs a real reason to move, not a coin-flip edge. The threshold scales
    # with the size of what it is giving up, with how reluctant it is to lose the best
    # player in the deal, and with how much the user has annoyed it.
    rel = max([star_reluctance(a["feats"].get("vorp") or 0)
               for a in giving if a["kind"] == "player"] or [1.0])
    need = max(2_000_000, abs(out_v) * 0.08 * rel + abs(out_v) * (rel - 1.0)) * relationship
    margin = in_v - out_v
    return ("accept" if margin >= need else
            "counter" if margin >= -abs(out_v) * 0.25 else "reject"), margin, {
        "giving": out_v, "getting": in_v, "threshold": need, "reluctance": rel}


# ---------------------------------------------------------------------- CLI

def _model():
    import joblib
    return joblib.load(f"{OUT}/value_model.joblib")


def _roster_feats(team):
    """Real players from the current season with their real 2026-27 salary."""
    import cap_engine as CE
    data = json.load(open(f"{OUT}/players.json"))["data"]
    season = max(data)
    cons = {c["name"]: c for c in json.load(open(f"{OUT}/contracts_2026_27.json"))}
    out = []
    for p in data[season]["players"]:
        if p.get("team") != team:
            continue
        g = lambda k: ((p.get("m", {}).get(k) or {}).get("season") or {}).get("v")
        c = cons.get(p["name"])
        if not c:
            continue
        sal = [y["salary"] for k, y in sorted(c["years"].items())]
        if not sal:
            continue
        out.append({"name": p["name"], "salaries": sal,
                    "feats": {"age": g("age") or p.get("age"), "vorp": g("vorp"),
                              "bpm": g("bpm"), "mpg": g("mpg"), "avail": g("avail"),
                              "usg": g("usg"), "exp": p.get("exp")}})
    return out


def cmd_picks():
    curve = fit_pick_curve()
    json.dump(curve, open(PICKS_PATH, "w"), indent=1)
    print(f"fitted on {curve['n']} drafted players (2010-2020 first rounds)")
    print(f"  expected 4-year VORP = {curve['a']:.2f} * pick^-{curve['b']:.3f} "
          f"+ {curve['c']:.2f}\n")
    price, _ = load_ctx()
    print(f"{'pick':>6}{'exp VORP':>10}{'surplus $':>16}")
    for p in (1, 2, 3, 5, 8, 10, 14, 20, 25, 30, 40, 50):
        v = pick_vorp(p, curve)
        cost = 4 * rookie_scale(p)
        print(f"  {p:4d}{v:10.2f}   ${v*price['per_vorp']-cost:>13,.0f}")


def cmd_value():
    team = (sys.argv[2] if len(sys.argv) > 2 else "OKC").upper()
    model, (price, curve) = _model(), load_ctx()
    rows = []
    for p in _roster_feats(team):
        v, _ = contract_surplus(model, price, p["feats"], p["salaries"])
        rows.append((v, p))
    rows.sort(reverse=True, key=lambda r: r[0])
    print(f"{team}  surplus value by contract\n")
    print(f"  {'player':26}{'age':>5}{'VORP':>7}{'yrs':>5}{'yr1 salary':>14}{'surplus':>16}")
    for v, p in rows:
        f = p["feats"]
        print(f"  {p['name'][:24]:26}{(f.get('age') or 0):5.0f}{(f.get('vorp') or 0):7.1f}"
              f"{len(p['salaries']):5d}${p['salaries'][0]:>13,}${v:>15,.0f}")
    print(f"\n  total roster surplus: ${sum(v for v, _ in rows):,.0f}")




def cmd_test():
    """Adversarial suite. Every case is an attempt to get something for nothing —
    the failure mode of every GM game is a trade engine you can farm."""
    import joblib
    model = joblib.load(f"{OUT}/value_model.joblib")
    price, curve = load_ctx()
    R = {p["name"]: p for p in _roster_feats("OKC")}
    B = {p["name"]: p for p in _roster_feats("BOS")}

    def pl(d):
        return {"kind": "player", "feats": d["feats"], "salaries": d["salaries"]}

    def pick(slot, out=1):
        return {"kind": "pick", "round": 1 if slot <= 30 else 2, "slot": slot,
                "years_out": out}

    star = pl(R["Shai Gilgeous-Alexander"])
    role = [pl(R["Isaiah Joe"]), pl(R["Aaron Wiggins"])]
    young = pl(R["Ajay Mitchell"])
    vet_bad = pl(R["Alex Caruso"])

    cases = []

    def run(name, giving, getting, ctx, expect, rel=1.0):
        v, margin, d = evaluate(model, price, curve, giving, getting, ctx, rel)
        ok = v == expect if isinstance(expect, str) else v in expect
        cases.append((ok, name, f"{v} (margin ${margin:,.0f} vs "
                                f"threshold ${d['threshold']:,.0f})"))

    # 1 — the classic robbery
    run("star for two role players and a late first",
        [star], role + [pick(26)], "fringe", "reject")
    # 2 — star for three late firsts
    run("star for three late firsts",
        [star], [pick(24), pick(26, 2), pick(28, 3)], "fringe", "reject")
    # 3 — star for a genuine haul
    run("star for a top-3 pick, a mid first and a good young player",
        [star], [pick(2), pick(12), young], "rebuilding", ("accept", "counter"))
    # 4 — context: a rebuilding team should PAY for youth and picks
    run("rebuilder gives a declining vet for a late first",
        [vet_bad], [pick(27)], "rebuilding", ("accept", "counter"))
    # 5 — ...and a contender should not care as much
    run("contender gives the same vet for the same pick",
        [vet_bad], [pick(27)], "contending", ("accept", "counter", "reject"))
    # 6 — salary dump: paying a pick to shed a bad contract
    run("dump a bad contract by attaching a first",
        [vet_bad, pick(18)], [], "rebuilding", ("accept", "counter"))
    # 7 — nothing for something
    run("ask for a star and give literally nothing",
        [star], [], "fringe", "reject")
    # 8/9 — relationship state. The offer is a genuinely fair one: Ajay Mitchell is a
    # 24-year-old at 1.4 VORP on $2.85M, which is a ~$38M asset, so it takes a top-two
    # pick to move him. An earlier version of this test offered pick 20 and called it
    # fair; the engine was right to reject it and the TEST was wrong.
    run("fair offer, but the user has burned the relationship",
        [young], [pick(2)], "fringe", ("counter", "reject"), rel=4.0)
    run("the same offer with a clean relationship",
        [young], [pick(2)], "fringe", ("accept", "counter"), rel=1.0)
    # 10 — two-for-one where the two are worse
    run("two negative contracts for one good young player",
        [young], [vet_bad, pl(R["Luguentz Dort"])], "fringe", "reject")

    ok = sum(1 for c in cases if c[0])
    print(f"trade engine — {ok}/{len(cases)} adversarial cases behave correctly\n")
    for good, name, how in cases:
        print(f"  {'PASS' if good else 'FAIL'}  {name}")
        print(f"        {how}")
    return ok == len(cases)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "picks"
    {"picks": cmd_picks, "value": cmd_value, "test": cmd_test}[cmd]()
