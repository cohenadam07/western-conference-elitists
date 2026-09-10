"""Pull postseason play-by-play for every season into one small local table.

The nflverse play-by-play release is about 20 MB a season and 372 columns wide, and this
page needs roughly forty of those columns for a few hundred postseason games. Downloading
27 full seasons to keep one percent of the rows would be half a gigabyte of waste, so this
reads the remote parquet over HTTP byte ranges and asks for only the columns it wants —
parquet is columnar, so that pulls about a fifth of each file and never writes the raw
season to disk at all.

    python3 games_fetch.py            # -> agg/post_plays.parquet
"""
import io, os, sys, time
import requests
import pyarrow.parquet as pq
import pyarrow.compute as pc
import pyarrow as pa

AGG = os.environ.get('NFL_AGG', 'agg')
OUT = os.path.join(AGG, 'post_plays.parquet')
BASE = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_%d.parquet'
SEASONS = range(1999, 2026)

COLS = [
    'game_id', 'season', 'season_type', 'week', 'home_team', 'away_team',
    'posteam', 'defteam', 'qtr', 'time', 'game_seconds_remaining', 'quarter_seconds_remaining',
    'down', 'ydstogo', 'yardline_100', 'goal_to_go', 'play_type', 'desc', 'yards_gained',
    'air_yards', 'yards_after_catch', 'epa', 'wp', 'home_wp', 'away_wp', 'wpa', 'vegas_wp',
    'touchdown', 'pass_touchdown', 'rush_touchdown', 'return_touchdown',
    'pass_attempt', 'complete_pass', 'incomplete_pass', 'rush_attempt', 'sack',
    'interception', 'fumble_lost', 'penalty', 'penalty_yards', 'penalty_team',
    'total_home_score', 'total_away_score', 'sp', 'drive', 'fixed_drive', 'fixed_drive_result',
    'series_result', 'first_down', 'third_down_converted', 'third_down_failed',
    'fourth_down_converted', 'fourth_down_failed', 'success',
    'passer_player_id', 'passer_player_name', 'rusher_player_id', 'rusher_player_name',
    'receiver_player_id', 'receiver_player_name',
    'sack_player_name', 'interception_player_name',
    'field_goal_result', 'kick_distance', 'extra_point_result', 'two_point_conv_result',
    'timeout', 'timeout_team', 'td_team', 'td_player_name', 'score_differential',
]


class RangeFile(io.RawIOBase):
    """A read-only file over HTTP byte ranges.

    pyarrow reads the parquet footer, decides which column chunks it needs, and seeks to
    each — so with a file-like object that turns seeks into Range requests, only the bytes
    for the requested columns ever cross the wire.
    """

    def __init__(self, url, session=None):
        self.s = session or requests.Session()
        r = self.s.head(url, allow_redirects=True, timeout=60)
        r.raise_for_status()
        self.url = r.url
        self.size = int(r.headers['Content-Length'])
        self.pos = 0
        self.bytes = 0

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n <= 0 or self.pos >= self.size:
            return b''
        end = min(self.pos + n, self.size) - 1
        for attempt in range(4):
            try:
                r = self.s.get(self.url, headers={'Range': 'bytes=%d-%d' % (self.pos, end)},
                               timeout=180)
                r.raise_for_status()
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
        b = r.content
        self.pos += len(b)
        self.bytes += len(b)
        return b

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def season_post(year, session):
    f = RangeFile(BASE % year, session)
    pf = pq.ParquetFile(f)
    names = set(pf.schema_arrow.names)
    cols = [c for c in COLS if c in names]
    tb = pf.read(columns=cols)
    st = tb['season_type']
    tb = tb.filter(pc.equal(st, 'POST'))
    return tb, f.size, f.bytes, [c for c in COLS if c not in names]


def unify(parts):
    """Give every season the same column types before they are stacked.

    nflverse types a flag as an integer in the seasons where it is always filled and as a
    float in the seasons where it can be null, so the same column arrives as int32 from one
    year and double from another. Widening every numeric column to float64 costs nothing
    here and keeps a 2003 flag and a 2019 flag comparable.
    """
    kinds = {}
    for tb in parts:
        for f in tb.schema:
            k = kinds.setdefault(f.name, set())
            k.add('str' if pa.types.is_string(f.type) or pa.types.is_large_string(f.type)
                  else ('num' if pa.types.is_integer(f.type) or pa.types.is_floating(f.type)
                        else 'other'))
    out = []
    for tb in parts:
        cols, names = [], []
        for f in tb.schema:
            col = tb[f.name]
            if kinds[f.name] == {'num'} and not pa.types.is_float64(f.type):
                col = col.cast(pa.float64())
            elif 'str' in kinds[f.name] and not (pa.types.is_string(f.type)
                                                 or pa.types.is_large_string(f.type)):
                col = col.cast(pa.string())
            cols.append(col)
            names.append(f.name)
        out.append(pa.Table.from_arrays(cols, names=names))
    return out


def main():
    os.makedirs(AGG, exist_ok=True)
    session = requests.Session()
    parts, whole, pulled = [], 0, 0
    for y in SEASONS:
        t = time.time()
        try:
            tb, size, got, missing = season_post(y, session)
        except Exception as e:
            print('%d FAILED %s' % (y, e), flush=True)
            continue
        whole += size
        pulled += got
        parts.append(tb)
        games = len(set(tb['game_id'].to_pylist()))
        print('%d  %5d plays  %2d games  %4.1f MB of %4.1f MB  %4.1fs%s'
              % (y, tb.num_rows, games, got / 1e6, size / 1e6, time.time() - t,
                 ('  missing: ' + ','.join(missing)) if missing else ''), flush=True)
    if not parts:
        sys.exit('nothing fetched')
    tab = pa.concat_tables(unify(parts), promote_options='default')
    pq.write_table(tab, OUT, compression='zstd')
    print('\nwrote %s — %d plays, %d games, %.1f MB on disk'
          % (OUT, tab.num_rows, len(set(tab['game_id'].to_pylist())), os.path.getsize(OUT) / 1e6))
    print('pulled %.0f MB of %.0f MB published (%.0f%%)' % (pulled / 1e6, whole / 1e6,
                                                            100 * pulled / max(whole, 1)))


if __name__ == '__main__':
    main()
