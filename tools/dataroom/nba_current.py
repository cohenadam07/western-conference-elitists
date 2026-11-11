# tools/dataroom/nba_current.py — the NBA Data Room's season in progress, built the way the cloud
# refresh builds it (ESPN -> tables -> the shim -> pipeline/dataroom/nba.py build_current), for a
# local first build and for tools/dataroom/identity.sh.
#   python3 tools/dataroom/nba_current.py 2026-27 <espn cache dir>
import os, sys
WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
BB = os.path.join(WT, 'pipeline', 'basketball')
sys.path.insert(0, BB)
import cloud_refresh as CR
import espn_shim as SH
season = sys.argv[1]
games, tables, rosters, idmap = CR.prepare(season, sys.argv[2], os.path.join(WT, 'public'))
print(len(games), 'games')
shim = SH.install(season, tables, CR.SEED)
CR.install_player_info(shim, rosters, idmap, season)
sys.path.insert(0, os.path.join(WT, 'pipeline', 'dataroom'))
import nba as DR
for r in DR.build_current(season, out_hosted=os.environ.get('DATAROOM_HOSTED', os.path.join(WT, 'out', 'dataroom'))):
    print(r['path'].split('dataroom/')[-1], r['rows'], 'rows through', r['through'])
