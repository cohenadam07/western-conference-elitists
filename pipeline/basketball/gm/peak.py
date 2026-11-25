"""
peak.py — run one command and record its peak memory (maximum resident set size), on the Mac and on GitHub's
Linux runners alike. The line goes to stderr and, with PEAK_LOG set, is appended to that file:

    python3 peak.py grade.py                 # -> "peak grade.py 2,140 MB 182s"

Disk guard: every heavy step runs through here (run_chain.sh, gm_update.py), so before it starts the free space on
this disk is checked, and below MIN_FREE_GB (default 15) the step does not start: it stops cleanly with exit code 75
and a message saying so, and the step's earlier output is left as it was. (The Mac ran out of disk mid-build once and
a step died writing nothing.) GitHub's runners have about 14 GB free, so gm_cloud_run.sh sets its own floor.
"""
import os, resource, shutil, subprocess, sys, time

t = time.time()
cmd = sys.argv[1:]
floor = float(os.environ.get('MIN_FREE_GB', '15'))
free = shutil.disk_usage(os.path.dirname(os.path.abspath(__file__))).free / 2**30
if free < floor:
    msg = (f"DISK GUARD: {free:.1f} GB free, under the {floor:g} GB floor; not starting {' '.join(sys.argv[1:])}. "
           "Free some space and rerun from this step (nothing this step writes was touched).")
    print(msg, file=sys.stderr)
    if os.environ.get('PEAK_LOG'):
        open(os.environ['PEAK_LOG'], 'a').write(msg + '\n')
    sys.exit(75)
if cmd and cmd[0].endswith('.py'):
    cmd = [sys.executable] + cmd
rc = subprocess.call(cmd)
ru = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
mb = ru / 2**20 if sys.platform == 'darwin' else ru / 2**10          # bytes on macOS, kilobytes on Linux
line = f"peak {' '.join(sys.argv[1:])} {mb:,.0f} MB {time.time() - t:.0f}s rc={rc}"
print(line, file=sys.stderr)
if os.environ.get('PEAK_LOG'):
    open(os.environ['PEAK_LOG'], 'a').write(line + '\n')
sys.exit(rc)
