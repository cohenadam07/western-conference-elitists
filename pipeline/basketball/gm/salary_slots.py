"""
salary_slots.py — the one place NBA GM Savant reads salaries from (SALARY_SLOTS.md lists every slot and what it will move).

NBA GM Savant 1.0.0 ships without salaries. Every salary field already exists, null, in the page's files, the Data Room
tables (gm_decisions, gm_seasons) and the connector, so 1.1.0 is a drop-in: the Contract tab writes its files, this
module reads them, and nothing downstream changes shape. The page shows a value where one is present and a
"salaries coming" badge where it is null.

The Contract tab's files (pipeline/basketball/contracts, Module 3 onward), read only from CONTRACTS_DATA
(default <repo>/pipeline/basketball/contracts/data):
    salaries_history.json      per player-season: team, cap hit, paid, source status        -> cap_hit, salary_cost
    team_payroll_history.json  per team-season: payroll, tax paid, apron status, dead money -> gm_seasons fields
    years_of_control.json.gz   per player and date: seasons under contract (options marked) -> years_of_control
None of them exists on this branch yet; AVAILABLE needs the files AND ENABLED (set by hand in 1.1.0), and until then
every function returns its fields as None.
Nothing here reads Front Office (cap_engine, contracts_2026_27.json and the rest are never touched).

Units: dollars as whole US dollars; value_per_dollar in Savant points per $1 million of cost; years in seasons.
"""
import gzip, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('CONTRACTS_DATA', os.path.join(HERE, '..', 'contracts', 'data'))
FILES = {'salaries': 'salaries_history.json', 'payroll': 'team_payroll_history.json', 'control': 'years_of_control.json.gz'}
ARRIVES = '1.1.0'

# the fields, in the order the Data Room columns carry them
DECISION_FIELDS = ('salary_cost', 'cap_hit', 'value_per_dollar', 'dead_money', 'years_of_control')
SEASON_FIELDS = ('payroll', 'tax_paid', 'apron_status', 'dead_money', 'value_per_dollar')
SPELL_FIELDS = ('payroll_per_season', 'tax_paid', 'dead_money', 'value_per_dollar', 'cap_outlook')
APRON_STATUS = ('under the cap', 'over the cap', 'over the tax', 'over the first apron', 'over the second apron')

# what salaries will change, in the page banner's order; each badge on the page links to its key
CHANGES = [
    ('fa', 'Free agency', 'each signing graded on value against what it cost (value per dollar), not value alone'),
    ('resign', 'Re-signing and extensions', 'the value kept against what it cost, and a percentile once value can be tested against cost'),
    ('trades', 'Trades', 'salary taken on and sent out, dead money and tax, beside the value'),
    ('lists', 'Inherited and left behind', 'only the seasons a player was under contract count (years of control), so GM Value Added and expected titles added move'),
    ('left_fa', 'Left in free agency', 'whether keeping the player fit under the cap and aprons'),
    ('cap', 'Cap outlook', "payroll, cap space, tax and apron status for every active GM's books"),
]

FILES_PRESENT = all(os.path.exists(os.path.join(DATA, f)) for f in FILES.values())
# Switched on by hand in 1.1.0, once the readers below are written and checked: the Contract tab's files merely existing
# must not tell the page that salaries are in while every field is still null.
ENABLED = False
AVAILABLE = ENABLED and FILES_PRESENT


def _load(key):
    p = os.path.join(DATA, FILES[key])
    return json.load(gzip.open(p) if p.endswith('.gz') else open(p))


def meta():
    """The page's and the connector's salary block: whether salaries are in, and what they will change."""
    return {'available': AVAILABLE, 'arrives': ARRIVES, 'changes': [{'key': k, 'what': w, 'change': c} for k, w, c in CHANGES],
            'note': 'Salaries are in.' if AVAILABLE else f'Salaries arrive in NBA GM Savant {ARRIVES}. Until then value is counted without what it cost.'}


def decision(d):
    """Salary fields for one graded decision (grade.py's row). Null until the Contract tab's files exist."""
    return dict.fromkeys(DECISION_FIELDS)


def season(team, y):
    """Salary fields for one team-season (gm_seasons; a GM's share is applied by the caller where a field adds up)."""
    return dict.fromkeys(SEASON_FIELDS)


def spell(spell_row):
    """Salary fields for one GM spell (the card and the connector's profile)."""
    return dict.fromkeys(SPELL_FIELDS)


def asset(asset_id, day):
    """Years of control left on one asset on one day (the Inherited and Left behind lists)."""
    return None


if __name__ == '__main__':
    print(json.dumps({'data': DATA, 'available': AVAILABLE, 'enabled': ENABLED, **{k: os.path.exists(os.path.join(DATA, f)) for k, f in FILES.items()}}, indent=1))
