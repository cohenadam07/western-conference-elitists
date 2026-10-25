"""
franchise.py — what the user actually controls, and the systems they control.

Before a career starts the user chooses their CONTROL SURFACE. Everything they do not
take is handled for them by the assistant GM, competently and visibly. This matters more
than it sounds: the full simulation has ten distinct decision domains, and a user who
wants to make trades does not necessarily want to set a practice plan every week. The
alternative — forcing every domain on everyone — is how depth turns into chores.

Every domain has three levels, not two:

    MANUAL    you decide
    ADVISED   the assistant recommends, you approve or override   <- the default
    AUTO      handled for you; it appears in the log, not the inbox

ADVISED is the default for most domains on purpose. It keeps a new user moving without
hiding what is happening, and it is how someone learns which levers matter.

Usage:
  python franchise.py domains     # the control surface
  python franchise.py presets     # the starting configurations
  python franchise.py test
"""
import json, sys, math, random, collections

MANUAL, ADVISED, AUTO = "manual", "advised", "auto"

DOMAINS = {
    "trades": dict(
        label="Trades", default=MANUAL,
        blurb="Propose and accept trades, work the deadline.",
        auto="Assistant makes only clearly positive-value deals and never trades a "
             "top-two player without asking."),
    "free_agency": dict(
        label="Free agency", default=MANUAL,
        blurb="Negotiate with free agents and your own expiring players.",
        auto="Assistant re-signs your own core at or under market and fills the roster "
             "with the best value available."),
    "draft": dict(
        label="Draft", default=MANUAL,
        blurb="Run the lottery, the board and both rounds.",
        auto="Assistant takes the best player on the scouting board."),
    "extensions": dict(
        label="Extensions", default=ADVISED,
        blurb="Rookie-scale and veteran extensions, and their windows.",
        auto="Assistant extends only where projected surplus is positive."),
    "rotations": dict(
        label="Rotations and minutes", default=AUTO,
        blurb="Starting five, minute allocation, closing lineups.",
        auto="Head coach sets minutes by ability and fit."),
    "practice": dict(
        label="Practice plan", default=ADVISED,
        blurb="Weekly emphasis per player: shooting, defence, conditioning, playmaking.",
        auto="Player development staff targets each player's weakest tradeable skill."),
    "staff": dict(
        label="Staff hiring", default=ADVISED,
        blurb="Head coach, development, medical, analytics and scouting.",
        auto="Assistant fills vacancies with the best affordable candidate."),
    "finances": dict(
        label="Finances", default=AUTO,
        blurb="Ticket pricing, budget allocation, tax exposure.",
        auto="Ownership sets pricing; you are told when you are near the tax."),
    "tactics": dict(
        label="Game tactics", default=AUTO,
        blurb="Pace, shot profile, defensive scheme, playoff adjustments.",
        auto="Head coach plays to the roster's strengths."),
    "two_way": dict(
        label="Two-ways and G League", default=AUTO,
        blurb="Two-way signings, call-ups, assignments.",
        auto="Assistant manages the fringe of the roster."),
}

PRESETS = {
    "full_control": dict(
        label="Full control",
        blurb="Every lever. The whole job, nothing delegated.",
        levels={k: MANUAL for k in DOMAINS}),
    "front_office": dict(
        label="Front office",
        blurb="Roster building only. The coach coaches.",
        levels={**{k: AUTO for k in DOMAINS},
                **{k: MANUAL for k in ("trades", "free_agency", "draft", "extensions")}}),
    "dealmaker": dict(
        label="Deal-maker",
        blurb="Trades and the deadline. Everything else is handled.",
        levels={**{k: AUTO for k in DOMAINS},
                **{"trades": MANUAL, "extensions": ADVISED}}),
    "architect": dict(
        label="Architect",
        blurb="Draft, develop and extend. Trades are advised, not yours.",
        levels={**{k: AUTO for k in DOMAINS},
                **{"draft": MANUAL, "extensions": MANUAL, "practice": MANUAL,
                   "staff": MANUAL, "trades": ADVISED}}),
    "head_coach": dict(
        label="Head coach",
        blurb="Rotations, practice and tactics. The roster is someone else's problem.",
        levels={**{k: AUTO for k in DOMAINS},
                **{"rotations": MANUAL, "practice": MANUAL, "tactics": MANUAL}}),
    "guided": dict(
        label="Guided",
        blurb="Recommended for a first career: you decide, the assistant advises.",
        levels={**{k: ADVISED for k in DOMAINS},
                **{"finances": AUTO, "two_way": AUTO, "tactics": AUTO}}),
}


class ControlSurface:
    def __init__(self, preset="guided", overrides=None):
        if preset not in PRESETS:
            raise ValueError(f"unknown preset {preset}")
        self.preset = preset
        self.levels = dict(PRESETS[preset]["levels"])
        for k, v in (overrides or {}).items():
            if k not in DOMAINS:
                raise ValueError(f"unknown domain {k}")
            if v not in (MANUAL, ADVISED, AUTO):
                raise ValueError(f"unknown level {v}")
            self.levels[k] = v

    def level(self, domain):
        return self.levels[domain]

    def is_mine(self, domain):
        return self.levels[domain] == MANUAL

    def wants_advice(self, domain):
        return self.levels[domain] == ADVISED

    def summary(self):
        by = collections.defaultdict(list)
        for k, v in self.levels.items():
            by[v].append(DOMAINS[k]["label"])
        return dict(by)

    def to_json(self):
        return {"preset": self.preset, "levels": self.levels}

    @staticmethod
    def from_json(d):
        return ControlSurface(d.get("preset", "guided"), d.get("levels"))


def route(surface, domain, decide, recommend=None):
    """How a decision is resolved given the control surface.

    Returns (action, payload):
      ('ask', None)                 -> the user decides
      ('propose', recommendation)   -> show a recommendation, wait for approval
      ('done', result)              -> already handled; goes in the log, not the inbox
    """
    lv = surface.level(domain)
    if lv == MANUAL:
        return "ask", None
    if lv == ADVISED:
        return "propose", (recommend or decide)()
    return "done", decide()


# ==================================================================== staff

class Coach:
    """A head coach is the team-level factor the sim was missing.

    Section 5.6 diagnosed the residual win-spread gap precisely: real corr(ORtg, DRtg) is
    -0.650 and the sim's was -0.243. Both marginal dispersions matched; what was absent
    was that good teams are good at BOTH ends together, which no per-player rate can
    express. A coach supplies exactly that — one quality that lifts or sinks offence and
    defence at once — so coaching is not flavour bolted on, it is the named mechanism.
    """
    def __init__(self, name, offense, defense, development, rng=None):
        self.name = name
        self.offense = offense              # 0-100
        self.defense = defense
        self.development = development

    @staticmethod
    def random(rng, tier=None):
        base = rng.gauss(50, 15) if tier is None else tier
        # A coach's ends are correlated but not identical — most good coaches are good at
        # both, which is the whole point, but specialists exist.
        return Coach(f"Coach {rng.randrange(1000):03d}",
                     max(1, min(99, rng.gauss(base, 9))),
                     max(1, min(99, rng.gauss(base, 9))),
                     max(1, min(99, rng.gauss(50, 15))))

    def multipliers(self):
        """Offensive and defensive multipliers for the sim, centred on 1.0."""
        return (1.0 + (self.offense - 50) / 50.0 * 0.035,
                1.0 - (self.defense - 50) / 50.0 * 0.035)

    def __repr__(self):
        return f"<{self.name} off {self.offense:.0f} def {self.defense:.0f} dev {self.development:.0f}>"


STAFF_ROLES = {
    "head_coach":  "Sets rotations and scheme; moves both ends of the floor.",
    "development": "How fast young players actually improve.",
    "medical":     "Injury risk and recovery time.",
    "analytics":   "Narrows YOUR uncertainty — tighter error bars on every player.",
    "scouting":    "Draft board accuracy; see section 9's calibrated fog.",
}


# ================================================================== practice

PRACTICE_FOCUS = ["shooting", "defense", "conditioning", "playmaking"]


def practice_effect(focus, player_age, dev_rating, rng):
    """Weekly emphasis -> skill change and injury risk change.

    Real trade-offs, not free upgrades: conditioning cuts injury risk but buys no skill,
    and skill work on an older player is mostly wasted.
    """
    youth = max(0.15, min(1.0, (30 - player_age) / 10.0))
    power = (dev_rating / 50.0) * youth
    if focus == "conditioning":
        return {"skill": 0.0, "injury_mult": 1.0 - 0.12 * (dev_rating / 50.0)}
    return {"skill": max(0.0, rng.gauss(0.9 * power, 0.4)), "injury_mult": 1.0 + 0.03}


# =============================================================== locker room

def locker_room(players, wins_pace, recent_moves=0):
    """A vibe score in [0,1]. Modest effects on purpose — chemistry is real and small.

    Section 3.2b measured the whole team-composition effect at +0.057 R2 over individual
    skills. The locker room is a slice of that, so it must not be allowed to swing games.
    """
    if not players:
        return 0.5
    unhappy = sum(1 for p in players
                  if p.get("expected_minutes", 0) - p.get("minutes", 0) > 8)
    vets = sum(1 for p in players if (p.get("age") or 25) >= 30)
    score = 0.5
    score += 0.20 * ((wins_pace - 41) / 41.0)
    score -= 0.05 * unhappy
    score += 0.02 * min(3, vets)
    score -= 0.03 * recent_moves
    return max(0.0, min(1.0, score))


def chemistry_multiplier(vibe):
    """A broken locker room costs a point or so of efficiency. Not more.

    Capped at +-1.5%. Section 3.2b measured the ENTIRE team-composition effect at +0.057
    R2 over individual skills; the locker room is one slice of that, so letting it swing
    more would be asserting an effect the data does not support.
    """
    return 1.0 + (vibe - 0.5) * 0.03


# ================================================================== finances

def load_markets():
    try:
        return json.load(open("out/market_size.json"))
    except Exception:
        return {}


def revenue(team, wins, playoff_rounds, markets, vibe=0.5):
    """Annual revenue in dollars.

    Market strength is the z-score of average home attendance 2015-2026 excluding the
    covid seasons — real data, but honestly a proxy: attendance is capacity-bounded, so
    it measures fan-base strength more than metro size (Chicago tops it; Brooklyn is
    near the bottom despite New York). A fuller model would add local media and metro
    population.
    """
    z = markets.get(team, 0.0)
    base = 260_000_000 + 32_000_000 * z
    base *= 1.0 + 0.30 * ((wins - 41) / 41.0)
    base += playoff_rounds * 14_000_000
    base *= 1.0 + 0.03 * (vibe - 0.5)
    return base


def tax_bill(payroll):
    """Progressive luxury tax on the amount over the line. Repeater rates are a further
    escalation and are not modelled yet."""
    import cap_engine as CE
    over = payroll - CE.CBA["tax"]
    if over <= 0:
        return 0.0
    brackets = [(5_000_000, 1.50), (5_000_000, 1.75), (5_000_000, 2.50),
                (5_000_000, 3.25)]
    bill, rate_step = 0.0, 3.75
    for size, rate in brackets:
        take = min(over, size)
        bill += take * rate
        over -= take
        if over <= 0:
            return bill
    while over > 0:
        take = min(over, 5_000_000)
        bill += take * rate_step
        over -= take
        rate_step += 0.50
    return bill


# ========================================================= owner and job security

MANDATES = {
    "develop":   dict(label="Develop the young core", target_wins=28, patience=4),
    "playoffs":  dict(label="Make the playoffs", target_wins=44, patience=3),
    "win_round": dict(label="Win a playoff round", target_wins=48, patience=3),
    "title":     dict(label="Title or bust", target_wins=55, patience=2),
}


def evaluate_season(mandate, wins, playoff_rounds, profit, market_z):
    """Owner confidence delta. Judged against the MANDATE, not raw wins — a 25-win
    rebuilding season can be a success and a 45-win title-or-bust season is a failure."""
    m = MANDATES[mandate]
    score = (wins - m["target_wins"]) / 12.0
    score += playoff_rounds * 0.35
    if mandate == "develop":
        score += 0.3          # losing is tolerated; the point is the kids
    # small markets cannot eat losses the way big ones can
    if profit < 0:
        score -= min(1.2, abs(profit) / 40_000_000) * (1.0 + max(0.0, -market_z) * 0.5)
    return max(-2.0, min(2.0, score))


# ====================================================================== CLI

def cmd_domains():
    print("Control surface — every domain has three levels.\n")
    print(f"  {'domain':26}{'default':>9}   what it is")
    for k, d in DOMAINS.items():
        print(f"  {d['label']:26}{d['default']:>9}   {d['blurb']}")
        print(f"  {'':26}{'':>9}   auto: {d['auto']}")


def cmd_presets():
    print("Starting configurations (all fully customisable per domain).\n")
    for k, p in PRESETS.items():
        s = ControlSurface(k).summary()
        print(f"  {p['label']}")
        print(f"    {p['blurb']}")
        for lv in (MANUAL, ADVISED, AUTO):
            if s.get(lv):
                print(f"    {lv:8}: {', '.join(sorted(s[lv]))}")
        print()


def cmd_test():
    T = []
    rng = random.Random(3)

    def ck(name, cond, detail=""):
        T.append((cond, name, detail))

    # --- control surface
    cs = ControlSurface("guided")
    ck("every domain has a level in every preset",
       all(all(d in ControlSurface(p).levels for d in DOMAINS) for p in PRESETS))
    ck("full control leaves nothing delegated",
       set(ControlSurface("full_control").levels.values()) == {MANUAL})
    ck("head coach preset does not hand over the roster",
       ControlSurface("head_coach").level("trades") == AUTO and
       ControlSurface("head_coach").level("rotations") == MANUAL)
    cs2 = ControlSurface("guided", {"trades": MANUAL, "finances": MANUAL})
    ck("per-domain overrides apply on top of a preset",
       cs2.is_mine("trades") and cs2.is_mine("finances"))
    ck("a bad domain or level is rejected",
       _raises(lambda: ControlSurface("guided", {"nope": MANUAL})) and
       _raises(lambda: ControlSurface("guided", {"trades": "sometimes"})))
    ck("a surface round-trips through save data",
       ControlSurface.from_json(cs2.to_json()).levels == cs2.levels)

    # --- routing
    calls = {"decide": 0, "rec": 0}
    def dec():
        calls["decide"] += 1; return "did it"
    def rec():
        calls["rec"] += 1; return "suggest"
    a, _ = route(ControlSurface("full_control"), "trades", dec, rec)
    ck("a manual domain asks the user and runs nothing", a == "ask" and calls["decide"] == 0)
    a, p = route(ControlSurface("guided"), "extensions", dec, rec)
    ck("an advised domain returns a recommendation to approve",
       a == "propose" and p == "suggest")
    a, p = route(ControlSurface("dealmaker"), "draft", dec, rec)
    ck("an auto domain resolves without asking", a == "done" and p == "did it")

    # --- coaching
    good = Coach("G", 85, 85, 60); bad = Coach("B", 20, 20, 60)
    go, gd = good.multipliers(); bo, bd = bad.multipliers()
    ck("a good coach lifts offence and suppresses opponent scoring",
       go > 1.0 > gd and bo < 1.0 < bd,
       f"good {go:.3f}/{gd:.3f}  bad {bo:.3f}/{bd:.3f}")
    cs_ = [Coach.random(random.Random(i)) for i in range(400)]
    import statistics as st
    corr = st.correlation([c.offense for c in cs_], [c.defense for c in cs_])
    ck("coaches are correlated across both ends, which is the point",
       corr > 0.3, f"corr(off, def) = {corr:+.2f}")

    # --- practice
    young = practice_effect("shooting", 22, 70, random.Random(1))
    old = practice_effect("shooting", 34, 70, random.Random(1))
    ck("skill work helps the young far more than the old",
       young["skill"] > old["skill"] * 1.8, f"{young['skill']:.2f} vs {old['skill']:.2f}")
    cond = practice_effect("conditioning", 26, 70, random.Random(1))
    ck("conditioning trades skill growth for durability",
       cond["skill"] == 0.0 and cond["injury_mult"] < 1.0,
       f"injury x{cond['injury_mult']:.2f}")

    # --- locker room
    hi = locker_room([{"age": 30, "minutes": 30, "expected_minutes": 30}] * 8, 58)
    lo = locker_room([{"age": 24, "minutes": 12, "expected_minutes": 28}] * 8, 22,
                     recent_moves=3)
    ck("winning and satisfied minutes beat losing and buried players",
       hi > lo, f"{hi:.2f} vs {lo:.2f}")
    ck("chemistry cannot swing a game on its own",
       abs(chemistry_multiplier(1.0) - 1.0) <= 0.02,
       f"best case x{chemistry_multiplier(1.0):.3f}")

    # --- finances
    mk = load_markets()
    ck("market data covers the league", len(mk) == 30, f"{len(mk)} teams")
    big = revenue("CHI", 50, 2, mk); small = revenue("IND", 50, 2, mk)
    ck("a big market out-earns a small one at identical results",
       big > small, f"${big:,.0f} vs ${small:,.0f}")
    win = revenue("IND", 60, 3, mk); lose = revenue("IND", 20, 0, mk)
    ck("winning is worth real money", win > lose * 1.3,
       f"${win:,.0f} vs ${lose:,.0f}")
    import cap_engine as CE
    ck("the tax is progressive, not linear",
       tax_bill(CE.CBA["tax"] + 10_000_000) > 2 * tax_bill(CE.CBA["tax"] + 5_000_000),
       f"${tax_bill(CE.CBA['tax']+5_000_000):,.0f} at +$5M vs "
       f"${tax_bill(CE.CBA['tax']+10_000_000):,.0f} at +$10M")
    ck("no tax under the line", tax_bill(CE.CBA["tax"] - 1) == 0)

    # --- mandates
    reb = evaluate_season("develop", 25, 0, 5_000_000, 0.0)
    fail = evaluate_season("title", 45, 1, 5_000_000, 0.0)
    ck("a 25-win rebuild can be a success and a 45-win contender a failure",
       reb > fail, f"develop@25 {reb:+.2f} vs title@45 {fail:+.2f}")
    rich = evaluate_season("playoffs", 44, 1, -30_000_000, 1.5)
    poor = evaluate_season("playoffs", 44, 1, -30_000_000, -1.5)
    ck("small markets are punished harder for losing money",
       rich > poor, f"{rich:+.2f} vs {poor:+.2f}")

    ok = sum(1 for c, _, _ in T if c)
    print(f"franchise systems — {ok}/{len(T)} behaviours correct\n")
    for good_, name, detail in T:
        print(f"  {'PASS' if good_ else 'FAIL'}  {name}")
        if detail:
            print(f"        {detail}")
    return ok == len(T)


def _raises(fn):
    try:
        fn(); return False
    except Exception:
        return True


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "domains"
    {"domains": cmd_domains, "presets": cmd_presets, "test": cmd_test}[cmd]()
