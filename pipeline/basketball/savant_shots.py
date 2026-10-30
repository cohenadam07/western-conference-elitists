"""
savant_shots.py — shot-location heatmaps for Basketball Savant (lazy, per-player).

For each qualified player-season (NBA shot coords exist 1996-97+), pulls ShotChartDetail
(x/y of every FGA) via the engine's cached client, then precomputes two grids on a fixed
half-court lattice so the page just draws rectangles:

  vol : shot FREQUENCY vs the LEAGUE at that spot — self KDE density / league KDE density,
        log-scaled (light blue = shoots there less than a typical player, dark red = much
        more). This is the player's SHOT IDENTITY: without dividing out the league, every
        player looks paint-heavy simply because layups are the modal shot for everyone.
  eff : local eFG% vs the LEAGUE average at that spot (ShotChartLeagueWide zone baselines),
        only where the local sample is real. Blue→red diverging.

The league surface for vol is built by summing EVERY qualified player's KDE for the season,
so a season is an all-or-nothing unit: we must fetch all its players before any player's vol
is meaningful. out/shots/_built.json records which seasons are done (v2), so a killed run
resumes at the season boundary.

Output: out/shots/<player_id>.json = { "<season>": {n, vol:[[cell,val]...], eff:[[cell,val]...]} }
        out/shots/index.json        = { "<player_id>": ["2024-25", ...] }   (availability, loaded once)
        out/shots/_built.json       = ["2024-25", ...]  (seasons completed with the v2 vol algo)

The page and this module MUST agree on the lattice constants below (GRID) and the value
scaling (0..100). Nothing is fabricated: a player-season with no/too-few shots is simply absent
and the page hides the module.

CLI:
  python savant_shots.py test 201939 2023-24     # one player-season, prints grid stats (uses cache)
  python savant_shots.py build                    # full run (long; cached, resumable)
  python savant_shots.py build 4                  # only the most recent N seasons
  python savant_shots.py build full               # every season 1996-97 .. current
"""
import os, sys, json, math, base64
import numpy as np
import savant_engine as E
import savant_config as C

# ---- fixed half-court lattice (shot-chart units = 0.1 ft; basket at origin) ----------------
STEP = 11
XMIN, YMIN = -245, -46
NX, NY = 46, 43                      # covers x[-245,250], y[-46,416]
H = 42.0                            # KDE bandwidth (~4.2 ft)
H2 = 2 * H * H
RAD2 = (H * 2.6) ** 2
VOL_MIN_T = 12                      # keep a volume cell only if its 0..100 value >= this
EFF_MIN_AW = 4.0                    # weighted-attempt floor before we dare grade efficiency
EFF_SPREAD = 0.30                   # eFG diff that spans half the diverging ramp
MIN_FGA = 100                       # a player needs this many FGA in a season to get a chart

# ---- league-relative volume (vol) scaling --------------------------------------------------
# vol is log2(player_freq / league_freq) at each cell, mapped onto 0..100:
#   LR_LO -> 0 (shoots here much LESS than league)   ·   0 (=league avg) -> mid   ·   LR_HI -> 100
# A dead-zone floor drops cells the whole league barely shoots from (deep corners, backcourt)
# so a player's handful of attempts there can't paint a spurious hot spot.
LR_LO = -1.25                      # log2 ratio at the cold end (~0.42x league) -> 0
LR_HI = 1.6                        # log2 ratio at the hot end  (~3.0x league)  -> 100
FREQ_FLOOR_FRAC = 0.02             # ignore cells with < this fraction of the league's peak density
SHOTS_DIR = os.path.join("out", "shots")
BUILT_FILE = os.path.join(SHOTS_DIR, "_built.json")

_CX = np.tile(np.array([XMIN + STEP * i for i in range(NX)], float), NY)
_CY = np.repeat(np.array([YMIN + STEP * j for j in range(NY)], float), NX)


def _is3(zone):
    return "3" in str(zone)


def league_baseline(season):
    """{SHOT_ZONE_BASIC: league eFG%} for a season, from ShotChartLeagueWide."""
    from nba_api.stats.endpoints import shotchartleaguewide as LW
    lw = E.call(LW.ShotChartLeagueWide, dict(league_id="00", season=season), frame=0)
    lw["FGM"] = lw["FGM"].astype(float); lw["FGA"] = lw["FGA"].astype(float)
    z = lw.groupby("SHOT_ZONE_BASIC")[["FGM", "FGA"]].sum()
    return {zone: (r.FGM / r.FGA) * (1.5 if _is3(zone) else 1.0)
            for zone, r in z.iterrows() if r.FGA > 0}


DISK_LIGHT = True   # delete each raw ShotChartDetail cache file after use — the giant responses
                    # otherwise fill the disk (100+ MB/season). Trade-off: a re-run re-fetches, but
                    # build() flushes per-season so processed grids are never lost.


def player_shots(pid, season):
    """Every FGA (x, y, made, value, league_efg_of_its_zone) for a player-season, or None."""
    from nba_api.stats.endpoints import shotchartdetail as SC
    params = dict(team_id=0, player_id=int(pid), season_nullable=season,
                  season_type_all_star=C.SEASON_TYPE, context_measure_simple="FGA")
    df = E.call(SC.ShotChartDetail, params, frame=0)
    if DISK_LIGHT:
        try:
            os.remove(os.path.join(C.CACHE_DIR, E._key("ShotChartDetail", params, 0) + ".json"))
        except OSError:
            pass
    return df


def cell_kde(df, lg):
    """Vectorized KDE over the lattice -> (n, aw, pw, lw) as NX*NY float arrays.
    aw = weighted attempts per cell, pw = weighted points, lw = weighted league-expected eFG.
    These are the raw ingredients; vol needs the league's aw too, so normalization happens later."""
    m = df["LOC_Y"].between(-52, 418)
    df = df[m]
    n = len(df)
    if n == 0:
        z = np.zeros(NX * NY)
        return 0, z, z.copy(), z.copy()
    sx = df["LOC_X"].to_numpy(float)
    sy = df["LOC_Y"].to_numpy(float)
    made = df["SHOT_MADE_FLAG"].to_numpy(float)
    val = np.where(df["SHOT_TYPE"].astype(str).str.contains("3"), 3.0, 2.0)
    le = df["SHOT_ZONE_BASIC"].map(lambda z: lg.get(z, 0.5)).to_numpy(float)

    dx = _CX[:, None] - sx[None, :]
    dy = _CY[:, None] - sy[None, :]
    d2 = dx * dx + dy * dy
    K = np.where(d2 <= RAD2, np.exp(-d2 / H2), 0.0)   # (cells x shots)
    aw = K.sum(axis=1)                                 # weighted attempts per cell
    pw = K @ (val * made)                              # weighted points
    lw = K @ le                                        # weighted league-expected eFG
    return n, aw, pw, lw


def vol_grid(aw, aw_L):
    """Player shot frequency RELATIVE to the league surface -> 0..100 uint8 (0 = absent).
    log2(player_freq / league_freq) mapped onto [LR_LO, LR_HI]. A cell only reads if the player
    actually shoots there AND the league shoots there enough for the ratio to mean something."""
    vol = np.zeros(NX * NY, np.uint8)
    s, sL = aw.sum(), aw_L.sum()
    if s <= 0 or sL <= 0:
        return vol
    pf = aw / s                                        # player frequency distribution
    lf = aw_L / sL                                     # league frequency distribution
    valid = (aw > 0) & (lf >= lf.max() * FREQ_FLOOR_FRAC)
    with np.errstate(divide="ignore", invalid="ignore"):
        rel = np.where(valid, pf / lf, 0.0)
    lr = np.where(rel > 0, np.log2(np.where(rel > 0, rel, 1.0)), LR_LO - 1)
    vt = np.clip((lr - LR_LO) / (LR_HI - LR_LO), 0.0, 1.0) * 100.0
    return np.where(valid & (vt >= VOL_MIN_T), np.rint(vt), 0).astype(np.uint8)


def eff_grid(aw, pw, lw, vol):
    """Local eFG vs the league at that spot -> 0..100 uint8, 255 = no read. Only inside the
    shooting footprint (a volume cell) AND where enough weighted attempts back it up, so
    empty-edge noise can't paint a spurious hot/cold spot."""
    eff = np.full(NX * NY, 255, np.uint8)
    if aw.max() <= 0:
        return eff
    with np.errstate(divide="ignore", invalid="ignore"):
        pefg = np.where(aw > 0, pw / (2 * aw), 0.0)
        lefg = np.where(aw > 0, lw / aw, 0.0)
    t = np.clip(0.5 + (pefg - lefg) / EFF_SPREAD, 0.0, 1.0) * 100.0
    show = (vol > 0) & (aw >= EFF_MIN_AW)
    return np.where(show, np.rint(t), 255).astype(np.uint8)


def _b64(arr):
    return base64.b64encode(arr.tobytes()).decode("ascii")


def pack(n, vol, eff):
    return dict(n=int(n), vol=_b64(vol), eff=_b64(eff))


def qualified_pids(season):
    """Player ids with >= MIN_FGA in the season, via the engine's proven cached box loader."""
    box = E.load_box(None, season)          # full-season Base totals, indexed by player_id
    out = []
    for pid, fga in box["fga"].items():
        try:
            if float(fga) >= MIN_FGA:
                out.append(int(pid))
        except (ValueError, TypeError):
            continue
    return out


def all_shot_seasons():
    """Every season with NBA shot coordinates: 1996-97 .. current (newest first)."""
    end = int(C.SEASONS[0][:4])             # start-year of the newest season (e.g. 2025)
    return [f"{y}-{str(y + 1)[2:]}" for y in range(end, 1995, -1)]


def _load_existing():
    """Read already-built per-player files so a re-run resumes instead of starting over."""
    per = {}
    if not os.path.isdir(SHOTS_DIR):
        return per
    for fn in os.listdir(SHOTS_DIR):
        if fn == "index.json" or fn == "_built.json" or not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(SHOTS_DIR, fn)) as fh:
                per[int(fn[:-5])] = json.load(fh)
        except (ValueError, OSError, json.JSONDecodeError):
            continue
    return per


def _load_built():
    """Seasons already completed with the v2 (league-relative) vol algorithm."""
    try:
        with open(BUILT_FILE) as fh:
            return set(json.load(fh))
    except (OSError, ValueError, json.JSONDecodeError):
        return set()


def _flush(per_player, built):
    """Persist every player's grid file + the index + the built-seasons marker (crash-safe)."""
    index = {}
    for pid, sm in per_player.items():
        if not sm:
            continue
        with open(os.path.join(SHOTS_DIR, f"{pid}.json"), "w") as fh:
            json.dump(sm, fh, separators=(",", ":"))
        index[str(pid)] = sorted(sm.keys(), reverse=True)
    with open(os.path.join(SHOTS_DIR, "index.json"), "w") as fh:
        json.dump(index, fh, separators=(",", ":"))
    with open(BUILT_FILE, "w") as fh:
        json.dump(sorted(built), fh)
    return len(index)


def build(nseasons=10):
    seasons = all_shot_seasons() if nseasons == "full" else C.SEASONS[:nseasons]
    os.makedirs(SHOTS_DIR, exist_ok=True)
    per_player = _load_existing()                     # keep prior seasons; overwrite as we redo them
    built = _load_built()                             # seasons already done with the v2 vol algo
    print(f"resuming: {len(per_player)} player files on disk, {len(built)} seasons built (v2)")
    for season in seasons:
        if season in built:
            print(f"[{season}] already built (v2) — skipping")
            continue
        lg = league_baseline(season)
        pids = qualified_pids(season)
        print(f"[{season}] {len(pids)} qualified — fetching all (league surface)")
        # Phase 1: fetch every qualified player, KDE each, accumulate the league density surface.
        stats = {}                                    # pid -> (n, aw, pw, lw)
        aw_L = np.zeros(NX * NY)
        done = 0
        for pid in pids:
            try:
                df = player_shots(pid, season)
            except Exception as e:                     # noqa: BLE001 — one bad player shouldn't kill the run
                print(f"  ! {pid} {season}: {e}")
                continue
            n, aw, pw, lw = cell_kde(df, lg)
            if n >= MIN_FGA // 2 and aw.max() > 0:
                stats[pid] = (n, aw, pw, lw)
                aw_L += aw
            done += 1
            if done % 50 == 0:
                print(f"    fetched {done}/{len(pids)}")
        # Phase 2: now the league surface exists, grade each player's frequency + efficiency.
        for pid, (n, aw, pw, lw) in stats.items():
            vol = vol_grid(aw, aw_L)
            if int(vol.max()) == 0:
                continue
            eff = eff_grid(aw, pw, lw, vol)
            per_player.setdefault(pid, {})[season] = pack(n, vol, eff)
        built.add(season)
        cnt = _flush(per_player, built)               # persist after every season
        print(f"    flushed {cnt} player files after {season}")
    print(f"wrote {_flush(per_player, built)} player shot files + index.json to {SHOTS_DIR}")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "test":
        pid, season = int(sys.argv[2]), sys.argv[3]
        lg = league_baseline(season)
        n, aw, pw, lw = cell_kde(player_shots(pid, season), lg)
        # vol needs the league surface; approximate with this one player's own surface just to
        # exercise the code path (real vol comes from a full season build).
        vol = vol_grid(aw, aw)
        eff = eff_grid(aw, pw, lw, vol)
        d = pack(n, vol, eff)
        print(f"pid {pid} {season}: n={n}  aw_cells={int((aw>0).sum())}  eff cells={int((eff!=255).sum())}")
        print(f"  packed json bytes = {len(json.dumps(d))}  (grid {NX}x{NY}={NX*NY})")
        print("  NOTE: real vol is league-relative and only meaningful after a full season build.")
    elif len(sys.argv) >= 2 and sys.argv[1] == "build":
        arg = sys.argv[2] if len(sys.argv) > 2 else "10"
        build("full" if arg == "full" else int(arg))
    else:
        print(__doc__)
