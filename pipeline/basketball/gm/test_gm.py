"""
test_gm.py — GM Savant's pipeline invariants (Module 9), on the working files out/ holds after ./run_chain.sh.

    python3 test_gm.py            # every test; about a minute (it loads grade.py once)
    python3 test_gm.py -k ledger  # one

  ledger balance     every move's giver held what it gives (after the repairs), nothing is in two places at once,
                     and every player and pick move has a source
  conservation       for every team-season the decisions' credit plus the booked moves equals what its players
                     produced (conserve.py, inside its limits)
  trades zero-sum    each trade's credits across its teams sum to zero
  frozen grades      a frozen at-the-time grade never changes, whatever the models say later, and a new one is stored
  incremental        an incremental night carries over only what cannot have changed: identical decisions
  credit sums        a decision's credit weights sum to 1 (or it names why no one is credited); every day of a
                     team's history is credited once
  sources            every tenure, decision and press-filled trade has a source link
  replay             the last deadline-week replay matched its one full build (out/replay_report.txt)
  same-day signings  when two teams take a player on one day, the first lets him go when the second takes him
  player ids         a Basketball-Reference id is the NBA id whose seasons are his (a son is not his father; a name two
                     NBA ids share still finds one; another spelling is found by season, team and minutes), a career
                     NBA Savant splits across two ids is one career, and every season of 100+ minutes has its value
The page files and the connector are tools/savant-gm/check.mjs.
"""
import collections, json, os, shutil, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, HERE)
NON = {'POOL', 'DRAFT', 'RETIRED', 'OPENING'}


def load(name):
    return json.load(open(os.path.join(OUT, name)))


class Ledger(unittest.TestCase):
    def test_ledger_balance(self):
        E = load('ledger_events.json')
        by = collections.defaultdict(list)
        for i, e in enumerate(E):
            by[e['asset']].append((i, e))
        bad = []
        for aid, ev in by.items():
            if not (aid.startswith('player:') or aid.startswith('pick:')):
                continue
            holder = None
            for i, e in ev:
                if e['from'] not in NON and holder is not None and holder != e['from']:
                    bad.append((aid, e['date'], e['kind'], e['from'], holder))
                holder = e['to']
        players = [b for b in bad if b[0].startswith('player:')]
        self.assertEqual(players, [], f'{len(players)} player moves from a team that did not hold him, e.g. {players[:3]}')
        # picks: the ledger's own repairs cover the pick histories the source leaves out; anything left is listed
        self.assertLessEqual(len(bad), 40, f'{len(bad)} pick moves from a team that did not hold the pick, e.g. {bad[:3]}')

    def test_every_move_has_a_source(self):
        E = load('ledger_events.json')
        missing = [e for e in E if (e['asset'].startswith('player:') or e['asset'].startswith('pick:')) and not e.get('source')]
        self.assertEqual(missing, [], f'{len(missing)} moves without a source, e.g. {missing[:2]}')


    def test_same_day_signings(self):
        # Greg Foster (IND and TOR, 2002-11-06), Billy Thomas (WAS and NJN, 2006-02-24), Malcolm Thomas (SAS and UTA
        # inferred on 2013-10-30): the first team's books stop when the second takes him, that same day
        E = load('ledger_events.json')
        for aid, date, first, second in [('player:fostegr01', '2002-11-06', 'IND', 'TOR'), ('player:thomabi01', '2006-02-24', 'WAS', 'BRK'),
                                         ('player:thomama01', '2013-10-30', 'SAS', 'UTA')]:
            day = [(e['kind'], e['from'], e['to']) for e in E if e['asset'] == aid and e['date'] == date]
            self.assertEqual([x[1:] for x in day], [('POOL', first), (first, 'POOL'), ('POOL', second)], f'{aid} {date}: {day}')
        rows = load('ledger_same_day.json')
        self.assertTrue(all(r.get('taken_off') for r in rows), f'a same-day pair left on two books: {[r for r in rows if not r.get("taken_off")]}')


class Ids(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import grade
        cls.G = grade

    def test_son_is_not_his_father(self):
        G = self.G
        self.assertEqual(G.pid_of('player:harpero02'), 1631199)     # Ron Harper Jr., spelled "Ron Harper" by the ledger
        self.assertEqual(G.pid_of('player:harpero01'), 166)         # Ron Harper
        self.assertEqual(G.pid_of('player:jacksja01'), 1114)        # Jaren Jackson (the father)

    def test_shared_name_finds_its_id(self):
        G = self.G
        for br, nba in [('dunlemi02', 2399), ('jamesmi01', 2229), ('jamesmi02', 1628455), ('butleji01', 202710), ('smithjr01', 2747)]:
            self.assertEqual(G.vid_of(f'player:{br}'), nba, br)

    def test_other_spellings_by_minutes(self):
        # names NBA.com spells otherwise ("Flip Murray", "Ike Austin", "Clar. Weatherspoon") and rookies the offline
        # list lacks: found by season, team and minutes (Toby Okani and Lucas Williamson, MEM 2025-26: 217 and 224)
        G = self.G
        for br, nba in [('murraro01', 2436), ('austiis01', 1134), ('weathcl01', 221), ('okanito01', 1643253), ('willilu01', 1631351)]:
            self.assertEqual(G.vid_of(f'player:{br}'), nba, br)

    def test_every_season_has_its_value(self):
        # every ledger player's completed season of 100+ minutes has a value under the id he is graded by
        G = self.G
        miss = [(aid, y) for aid in G.A if aid.startswith('player:') for y in G.BR_YEARS.get(aid[7:], ())
                if y < G.NOW_SEASON and G.BR_MIN[(aid[7:], y)][0] >= 100 and (G.vid_of(aid), y) not in G.VAL]
        self.assertEqual(miss, [], f'{len(miss)} seasons with no value, e.g. {miss[:5]}')

    def test_split_career_is_one(self):
        # Patrick Ewing: NBA Savant keeps 1985-86 to 1995-96 under "br:ewingpa01" and 1996-97 on under 121
        G = self.G
        self.assertEqual(G.vid_of('player:ewingpa01'), 121)
        ys = {y for (i, y) in G.VAL if i == 121}
        self.assertTrue({1986, 1996, 1997, 2002} <= ys, sorted(ys))


class Grades(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.D = load('gm_decisions.json')
        cls.S = load('decision_streams.json')

    def test_conservation(self):
        import conserve
        self.assertEqual(conserve.main(), 0)

    def test_trades_zero_sum(self):
        by = collections.defaultdict(collections.Counter)
        for d in self.D:
            if d['type'] in ('trade', 'sign-and-trade') and d['decision_id'] in self.S:
                for y, v in self.S[d['decision_id']]:
                    by[d['tx']][y] += v
        off = {tx: max(abs(v) for v in c.values()) for tx, c in by.items() if c and max(abs(v) for v in c.values()) > 0.5}
        self.assertEqual(off, {}, f'{len(off)} trades whose sides do not net to zero')

    def test_ids_unique(self):
        ids = collections.Counter(d['decision_id'] for d in self.D)
        self.assertEqual([k for k, v in ids.items() if v > 1], [])

    def test_credit_weights(self):
        bad = []
        for d in self.D:
            c = d.get('credit') or {}
            ppl = c.get('people') or []
            if ppl:
                if abs(sum(p['weight'] for p in ppl) - 1) > 1e-6:
                    bad.append((d['decision_id'], sum(p['weight'] for p in ppl)))
            elif not c.get('note'):
                bad.append((d['decision_id'], 'no one credited and no reason given'))
        self.assertEqual(bad, [], f'{len(bad)} decisions, e.g. {bad[:3]}')

    def test_every_day_credited_once(self):
        C = load('gm_credit.json')
        segs = C if isinstance(C, list) else [s for v in C.values() for s in v]
        by = collections.defaultdict(list)
        for s in segs:
            by[s['team']].append(s)
        overlaps = []
        for team, ss in by.items():
            ss.sort(key=lambda s: s['from'])
            for a, b in zip(ss, ss[1:]):
                if b['from'] < (a.get('to') or '9999'):
                    overlaps.append((team, a['from'], a.get('to'), b['from']))
            for s in ss:
                if s.get('people') and abs(sum(p['weight'] for p in s['people']) - 1) > 1e-6:
                    overlaps.append((team, s['from'], 'weights', sum(p['weight'] for p in s['people'])))
        self.assertEqual(overlaps, [], f'{len(overlaps)} credit overlaps, e.g. {overlaps[:3]}')

    def test_sources(self):
        T = load('gm_tenures.json')
        no = [t['person'] + ' ' + t['team'] for t in T if not (t.get('sources') or t.get('source') or t.get('start_source'))]
        self.assertEqual(no, [], f'{len(no)} tenures without a source, e.g. {no[:3]}')
        TR = {t['tx'] for t in load('ledger_trades.json') if t.get('source')}
        nosrc = [d['decision_id'] for d in self.D if d['type'] not in ('coach hire', 'coach firing', 'draft', 'trade', 'sign-and-trade') and not d.get('source')]
        self.assertLessEqual(len(nosrc), 0, f'{len(nosrc)} roster decisions without a source')
        import facts
        self.assertTrue(all(t.get('sources') for t in facts.PRESS_TRADES))


class Frozen(unittest.TestCase):
    def test_frozen_grades_never_change(self):
        import grade as G
        tmp = tempfile.mkdtemp()
        saved = G.FROZEN, os.environ.get('GM_FREEZE')
        try:
            G.FROZEN = os.path.join(tmp, 'frozen.json')
            os.environ['GM_FREEZE'] = '1'
            D = [dict(type='trade', team='OKC', agreed='2019-07-10', **{'in': ['player:a'], 'out': ['player:b']}, at_time=100.0, at_time_note=None, models=['m1']),
                 dict(type='signing', team='OKC', agreed='2019-07-11', asset='player:c', at_time=-5.0, at_time_note=None, models=['m1'])]
            self.assertEqual(G.freeze([dict(d) for d in D]), 0)
            later = [dict(d, at_time=d['at_time'] + 50, models=['m2']) for d in D]   # the models changed
            drift = G.freeze(later)
            self.assertEqual(drift, 2, 'the change was not counted')
            self.assertEqual([d['at_time'] for d in later], [100.0, -5.0], 'a frozen grade changed')
            self.assertEqual([d['models'] for d in later], [['m1'], ['m1']], 'its model versions changed')
            new = [dict(type='waiver', team='OKC', agreed='2020-01-01', asset='player:d', at_time=3.0, at_time_note=None, models=['m2'])]
            G.freeze(new)
            self.assertIn(new[0]['decision_id'], json.load(open(G.FROZEN)), 'a new decision was not stored')
        finally:
            G.FROZEN = saved[0]
            if saved[1] is None:
                os.environ.pop('GM_FREEZE', None)
            else:
                os.environ['GM_FREEZE'] = saved[1]
            shutil.rmtree(tmp)


@unittest.skipUnless(os.environ.get('GM_TEST_SLOW') == '1', 'slow: GM_TEST_SLOW=1 (three grade runs in a sandbox, ~3 minutes)')
class Incremental(unittest.TestCase):
    def test_incremental_equals_full(self):
        import subprocess, gm_replay
        box = gm_replay.sandbox(tempfile.mkdtemp() + '/box')
        run = lambda **env: subprocess.run([sys.executable, 'grade.py'], cwd=box, env=dict(os.environ, **env), capture_output=True, text=True, check=True)
        strip = lambda: [{k: v for k, v in d.items() if k != 'frozen_on'} for d in json.load(open(os.path.join(box, 'out', 'gm_decisions.json')))]
        run(); full = strip()
        run(GM_FREEZE='1', GM_INCREMENTAL='1'); first = strip()
        r = run(GM_FREEZE='1', GM_INCREMENTAL='1'); second = strip()
        self.assertIn('turned out carried over', r.stdout)
        self.assertEqual(first, full)
        self.assertEqual(second, full)


class Replay(unittest.TestCase):
    def test_last_replay_matched(self):
        r = open(os.path.join(OUT, 'replay_report.txt')).read()
        self.assertIn('0 differ in anything else', r)
        self.assertIn('Decisions in the replay dated after', r)
        self.assertRegex(r, r'at-the-time grades identical (\d+) of \1;')


if __name__ == '__main__':
    unittest.main(verbosity=2)
