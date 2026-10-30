"""
gen_comp_chain.py — build the Comp Chain game graph for the website.

Reads:  out/players.json (current season, for id/name/team) + cached box/adv/opponent pulls
Writes: /Users/adamcohen/nba_prospect_model/website/src/data/compChain.json

The game graph is intentionally different from the Savant page's top-3 comps:
  - 5 comps per player (more outs per hop -> shorter, friendlier chains)
  - assigned by GLOBAL greedy matching on similarity with an in-degree cap, so no
    hub player becomes everyone's comp and chains stop circling the same cluster
  - same 9-D percentile vectors + distance as the Savant comps (savant_engine.comp_vectors)

Run AFTER `python3 savant_engine.py build` (uses its cache), then rebuild the website.
"""
import json, math, sys
import savant_engine as E
import savant_config as C

OUT = "/Users/adamcohen/nba_prospect_model/website/src/data/compChain.json"
OUT_DEGREE = 3     # comps per player in the game (matches the deployed 3-option game)
IN_CAP = 7         # max times a player may appear as someone's comp (avg is OUT_DEGREE)

def main():
    season = C.SEASONS[0]
    d = json.load(open("out/players.json"))
    players = d["data"][season]["players"]
    uni = {p["id"]: p for p in players}

    box, adv = E.load_box(None, season), E.load_adv(None, season)
    vec = E.comp_vectors(season, uni, box, adv)
    pids = sorted(vec.keys())                     # deterministic

    # all pair distances (ordered pairs share the symmetric distance)
    pairs = []                                    # (dist, a, b) both directions
    dmap = {}
    for i, a in enumerate(pids):
        for b in pids[i + 1:]:
            dd = E.comp_dist(vec, a, b)
            if dd is None:
                continue
            dmap[(a, b)] = dmap[(b, a)] = dd
            pairs.append((dd, a, b)); pairs.append((dd, b, a))
    pairs.sort(key=lambda x: (x[0], x[1], x[2])) # deterministic tie-break

    # global greedy: most-similar edges first, subject to out-degree / in-degree caps
    out_edges = {pid: [] for pid in pids}
    in_deg = {pid: 0 for pid in pids}
    for dd, a, b in pairs:
        if len(out_edges[a]) >= OUT_DEGREE or in_deg[b] >= IN_CAP:
            continue
        out_edges[a].append(b); in_deg[b] += 1

    # fallback: if the caps stranded anyone below OUT_DEGREE, fill with nearest regardless of cap
    stranded = 0
    for a in pids:
        if len(out_edges[a]) < OUT_DEGREE:
            stranded += 1
            near = sorted((dmap[(a, b)], b) for b in pids if b != a and (a, b) in dmap)
            for dd, b in near:
                if b not in out_edges[a]:
                    out_edges[a].append(b)
                    if len(out_edges[a]) >= OUT_DEGREE:
                        break

    # match % — same two-anchor calibration as the engine, on this graph's best-match distances
    best = sorted(dmap[(a, out_edges[a][0])] for a in pids if out_edges[a])
    q = lambda f: best[min(len(best) - 1, max(0, int(f * len(best))))]
    d95, d_mid = q(0.01), q(0.50)
    if d_mid <= d95:
        d_mid = d95 + 1.0
    slope = (95.0 - 80.0) / (d_mid - d95)
    score = lambda dd: max(1, min(99, round(95.0 - (dd - d95) * slope)))

    prof = lambda a: {d: (round(vec[a][d]) if vec[a][d] is not None else None) for d in E.COMP_DIMS}
    graph = [
        {"id": a, "name": uni[a]["name"], "team": uni[a]["team"], "prof": prof(a),
         "comps": [{"id": b, "score": score(dmap[(a, b)])} for b in out_edges[a]]}
        for a in pids
    ]
    json.dump(graph, open(OUT, "w"), separators=(",", ":"))

    mx_in = max(in_deg.values())
    print(f"wrote {OUT}: {len(graph)} nodes x {OUT_DEGREE} comps "
          f"(in-degree max {mx_in}, capped {IN_CAP}; {stranded} fallback fills)")

if __name__ == "__main__":
    sys.exit(main())
