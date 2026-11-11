"""Shared writer for the WCE Data Room tables (savant_data, api/_dataroom.js).

Every table is one file per season:

    {"schema": 1, "sport": "nfl", "table": "plays", "season": "2024", "through": "2025-02-09",
     "columns": [...], "rows": [[...], ...]}

`through` is the date of the newest row, never the day the file was written, so a stale
file says it is stale. Rows are lists in `columns` order; booleans are 0/1, missing is null,
floats are rounded once here (ROUND) so a rebuild is byte-identical.

Files are written gzipped with a fixed mtime (mtime=0) and no file name in the header, so the
same rows always give the same bytes: the refresh's "byte-identical to a full build" check
depends on it.
"""
import gzip
import io
import json
import math
import os

ROUND = 3


def clean(v, nd=ROUND):
    """A cell as JSON wants it: None for NaN/NA, ints for whole floats, rounded floats."""
    if v is None:
        return None
    try:
        import pandas as pd  # noqa: F401
        if v is pd.NA or v is pd.NaT:
            return None
    except Exception:
        pass
    if isinstance(v, bool):
        return 1 if v else 0
    if hasattr(v, 'item') and not isinstance(v, (str, bytes)):
        try:
            v = v.item()
        except Exception:
            pass
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        if v.is_integer() and abs(v) < 1e15:
            return int(v)
        r = round(v, nd)
        return int(r) if r.is_integer() else r
    if isinstance(v, str):
        return v if v != '' else None
    return v


def frame_rows(df, columns, digits=None):
    """DataFrame -> list of row lists in `columns` order, every cell cleaned."""
    digits = digits or {}
    out = []
    cols = [df[c].tolist() for c in columns]
    nds = [digits.get(c, ROUND) for c in columns]
    for i in range(len(df)):
        out.append([clean(cols[j][i], nds[j]) for j in range(len(columns))])
    return out


def dumps(doc):
    return json.dumps(doc, separators=(',', ':'), ensure_ascii=False)


def gz_bytes(text):
    buf = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=buf, mtime=0, compresslevel=9) as g:
        g.write(text.encode('utf-8'))
    return buf.getvalue()


def write_table(path, sport, table, season, columns, rows, through, extra=None):
    """Write one season of one table as <path> (always gzipped). Returns (raw bytes, gz bytes)."""
    doc = {'schema': 1, 'sport': sport, 'table': table, 'season': str(season), 'through': through,
           'columns': list(columns), 'rows': rows}
    if extra:
        doc.update(extra)
    text = dumps(doc)
    data = gz_bytes(text)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)
    return len(text.encode('utf-8')), len(data)


def read_table(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        return json.load(f)


def newest(rows, columns, col='date'):
    if col not in columns:
        return None
    i = columns.index(col)
    best = None
    for r in rows:
        v = r[i]
        if v and (best is None or v > best):
            best = v
    return best[:10] if best else None
