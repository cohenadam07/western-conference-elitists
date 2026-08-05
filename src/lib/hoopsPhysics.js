/* Flap Hoops physics — the single source of truth.
 *
 * Imported by BOTH the game page and api/race.js. That is the whole point: a browser cannot
 * be trusted to report its own score, but it can be trusted to report which buttons it
 * pressed. The server replays those inputs through this exact file and either gets the same
 * result or rejects the run. It also means a racing opponent's ball is not interpolated from
 * broadcast positions — it is simulated locally from their flaps, so it moves at full
 * framerate and is pixel-identical to what they see.
 *
 * Determinism is therefore load-bearing: fixed timestep, no Math.random, no Date.now, and
 * every moving hazard driven off the ball's own step counter. Do not introduce any of those
 * three into this file.
 */
'use strict';
'use strict';

const DT = 1 / 120;
const RB = 17, RIM_R = 7, RIM_HALF = 52;   // ball radius, rim tube radius, half hoop width

/* These seven numbers ARE the game. Levels, art and input can all be rebuilt; if these are
   wrong it simply is not fun, and nothing else rescues it. */
const DEFAULTS = { gravity: 850, lift: 450, side: 180, bounce: 0.95, grip: 0.75, drag: 0.17, rimSoft: 0.42 };

/* A world owns its palette, so adding Denver or Boston later is a data change rather than
   a rendering change. The ball stays basketball-orange everywhere — it is the one object
   that should never take on a team's colours. */
const WORLDS = {
  house: { name: 'The gym', sub: '', pal: {
    bg1:'#241a12', bg2:'#332317', wall:'#6B5240', edge:'rgba(232,220,200,.30)',
    rim:'#C24A24', glass:'#6E96A6', accent:'#E8DCC8', grain:'rgba(232,220,200,.05)' } },
  dallas: { name: 'Dallas', sub: 'Hardwood & horses', pal: {
    bg1:'#08131F', bg2:'#122A44', wall:'#1E4470', edge:'rgba(184,196,202,.55)',
    rim:'#00538C', glass:'#B8C4CA', accent:'#B8C4CA', grain:'rgba(184,196,202,.06)' } },
};

/* Hand-placed, not generated. A generator gives infinite mediocre holes; deliberate ones
   tell you far more about whether the mechanic deserves building on.
   Each level declares its world, its size, its INNER geometry (borders are generated), and
   its zones — the things that make a world feel like somewhere rather than a box. */
/* Progression, deliberately: each hole introduces ONE idea, the next combines it with what
   you already know, and the last few open up into two routes — a short line that asks for
   precision and a longer one that forgives. A world that teaches nothing is just a list. */
const LEVELS = [
  { name: "Warm-up", world: "house", par: 4, w: 1000, h: 600,
    ball: { x: 120, y: 430 }, hoop: { x: 780, y: 300 },
    inner: [[420,600,420,470]] },

  { name: "The long two", world: "house", par: 10, w: 2600, h: 700,
    ball: { x: 110, y: 560 }, hoop: { x: 2380, y: 300 },
    inner: [[520,700,520,420],[900,0,900,300],[1300,700,1300,380],[1300,380,1700,380],[2000,0,2000,340]] },

  { name: "Upstairs", world: "house", par: 12, w: 682, h: 806,
    ball: { x: 81, y: 732 }, hoop: { x: 508, y: 149 },
    inner: [[0,558,434,558],[260,347,682,347]] },

  { name: "Sundown", world: "dallas", par: 6, w: 1300, h: 700,
    ball: { x: 130, y: 600 }, hoop: { x: 1120, y: 280 },
    inner: [[560,700,560,430],[860,0,860,300]] },

  { name: "The fadeaway", world: "dallas", par: 10, w: 1900, h: 1100,
    ball: { x: 110, y: 1020 }, hoop: { x: 1740, y: 220 },
    inner: [[0,900,1000,900],[1000,900,1000,240],[200,720,520,720],[700,460,1050,460]],
    zones: [
      {"t":"bronco","x":880,"y":1060,"dx":0.4,"dy":-0.92,"power":2100} ] },

  { name: "Tumbleweed", world: "dallas", par: 10, w: 2100, h: 900,
    ball: { x: 130, y: 800 }, hoop: { x: 1940, y: 300 },
    inner: [[700,900,700,560],[1300,0,1300,420]],
    zones: [
      {"t":"weed","x1":820,"y1":820,"x2":1220,"y2":820,"r":34,"period":260},
      {"t":"weed","x1":1420,"y1":300,"x2":1820,"y2":300,"r":30,"period":190} ] },

  { name: "T-shirt cannon", world: "dallas", par: 10, w: 2200, h: 1000,
    ball: { x: 130, y: 900 }, hoop: { x: 2040, y: 280 },
    inner: [[640,1000,640,640],[1180,0,1180,460],[1660,1000,1660,620]],
    zones: [
      {"t":"cannon","x":60,"y":420,"dx":1,"dy":0,"range":1000,"period":300,"phase":0},
      {"t":"cannon","x":2140,"y":760,"dx":-1,"dy":0,"range":1100,"period":260,"phase":130} ] },

  { name: "Roped", world: "dallas", par: 11, w: 1440, h: 648,
    ball: { x: 94, y: 576 }, hoop: { x: 1325, y: 216 },
    inner: [[432,648,432,432],[864,0,864,302]],
    zones: [
      {"t":"lasso","x":619,"y":245,"r":144},
      {"t":"lasso","x":1094,"y":403,"r":144} ] },

  { name: "Crude", world: "dallas", par: 12, w: 780, h: 840,
    ball: { x: 90, y: 780 }, hoop: { x: 648, y: 168 },
    inner: [[0,588,492,588],[264,336,780,336]],
    zones: [
      {"t":"gush","x":564,"y":372,"w":120,"h":420,"force":1500} ] },

  { name: "Eight seconds", world: "dallas", par: 12, w: 1600, h: 800,
    ball: { x: 112, y: 720 }, hoop: { x: 1472, y: 208 },
    inner: [[608,800,608,544],[944,352,1360,352]],
    zones: [
      {"t":"bronco","x":512,"y":768,"dx":0.6,"dy":-0.8,"power":900},
      {"t":"bronco","x":1200,"y":768,"dx":0.3,"dy":-0.95,"power":980} ] },

  { name: "Step-back", world: "dallas", par: 17, w: 930, h: 930,
    ball: { x: 87, y: 868 }, hoop: { x: 806, y: 155 },
    inner: [[0,694,322,694],[608,471,930,471]],
    zones: [
      {"t":"stepback","id":1,"x":471,"y":694,"w":161},
      {"t":"stepback","id":2,"x":310,"y":471,"w":161},
      {"t":"stepback","id":3,"x":558,"y":260,"w":149},
      {"t":"gush","x":37,"y":310,"w":105,"h":558,"force":1450} ] },

  { name: "Stockyards", world: "dallas", par: 17, w: 1820, h: 1050,
    ball: { x: 105, y: 980 }, hoop: { x: 1694, y: 210 },
    inner: [[392,1050,392,784],[700,784,1820,784],[700,490,1330,490],[1540,490,1540,252]],
    zones: [
      {"t":"gush","x":490,"y":434,"w":133,"h":574,"force":1500},
      {"t":"lasso","x":1050,"y":266,"r":140},
      {"t":"weed","x1":805,"y1":742,"x2":1225,"y2":742,"r":22,"period":280},
      {"t":"bronco","x":1624,"y":756,"dx":-0.1,"dy":-0.99,"power":1050} ] },
];

/* Border walls, generated from the level's own dimensions so a map cannot leak. */
function segsOf(li) {
  const L = LEVELS[li];
  if (!L._segs) {
    L._segs = [[0,0,L.w,0],[0,L.h,L.w,L.h],[0,0,0,L.h],[L.w,0,L.w,L.h]].concat(L.inner || []);
  }
  return L._segs;
}

const hoopOf = (li) => {
  const h = LEVELS[li].hoop;
  return { x: h.x, y: h.y, lx: h.x - RIM_HALF, rx: h.x + RIM_HALF };
};

function makeState(li) {
  const L = LEVELS[li];
  return { x: L.ball.x, y: L.ball.y, vx: 0, vy: 0, spin: 0, rot: 0, flaps: 0, sank: false, li,
    rope: null, ropeR: 0, ropeA: 0, ropeW: 0, freed: -1, kick: null,
    /* t drives every moving hazard. It counts STEPS, never wall-clock: a cannon timed off
       Date.now() would fire at a different moment in a replay and the verification would
       reject an honest run. broke is a bitmask rather than a Set because the solver clones
       states with a shallow spread — a Set would be shared between branches and one
       explored path would silently consume platforms on all the others. */
    t: 0, broke: 0 };
}

function flap(st, P, dir) {
  if (st.sank) return;
  if (st.rope != null) {
    // let go: keep the swing's momentum and add the flap on top. Releasing at the right
    // point of the arc is the skill, exactly as it is on a real rope swing.
    st.freed = st.rope; st.rope = null;
  }
  st.vy = -P.lift;
  st.vx += dir * P.side;
  st.spin = dir * 7;
  st.flaps++;
}

function closestOnSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: x1 + t * dx, y: y1 + t * dy };
}

function resolve(st, P, cx, cy, r, restitution) {
  const dx = st.x - cx, dy = st.y - cy;
  const d = Math.hypot(dx, dy), min = RB + r;
  if (d >= min || d === 0) return;
  const nx = dx / d, ny = dy / d;
  st.x = cx + nx * min; st.y = cy + ny * min;
  const vn = st.vx * nx + st.vy * ny;
  if (vn >= 0) return;
  st.vx -= (1 + restitution) * vn * nx;
  st.vy -= (1 + restitution) * vn * ny;
  // tangential loss, or a ball landing on the rim skates along it forever
  const tx = -ny, ty = nx, vt = st.vx * tx + st.vy * ty;
  st.vx -= vt * (1 - P.grip) * tx;
  st.vy -= vt * (1 - P.grip) * ty;
  st.spin = vt * 0.02;
}

/* Where a moving hazard is at step t. Exported so the renderer draws exactly what the
   physics collides with, rather than a lookalike that drifts out of sync. */
function weedAt(z, t) {
  const u = (Math.sin((t / z.period) * Math.PI * 2) + 1) / 2;
  return { x: z.x1 + (z.x2 - z.x1) * u, y: z.y1 + (z.y2 - z.y1) * u };
}
function shotAt(z, t) {
  const k = ((t + (z.phase || 0)) % z.period) / z.period;
  return { x: z.x + z.dx * z.range * k, y: z.y + z.dy * z.range * k, k };
}

/* Zones run before integration so their forces join gravity in the same step, rather than
   being applied to a position that has already moved. All of them are pure functions of
   the ball's state and fixed level data — nothing here reads a clock or a random number,
   which is what keeps a replay honest. */
function zones(st, P, L) {
  if (!L.zones) return;
  for (const z of L.zones) {
    if (z.t === 'gush') {
      if (st.x > z.x && st.x < z.x + z.w && st.y > z.y && st.y < z.y + z.h) {
        st.vy -= z.force * DT;
        st.vx += ((z.x + z.w / 2) - st.x) * 1.6 * DT;   // gently centred in the column
      }
    } else if (z.t === 'weed') {
      // a tumbleweed shunts you rather than ending your run: losing your line costs flaps,
      // which is punishment enough in a game scored by flaps
      const w = weedAt(z, st.t);
      const d = Math.hypot(st.x - w.x, st.y - w.y), min = RB + z.r;
      if (d < min && d > 0) {
        const nx = (st.x - w.x) / d, ny = (st.y - w.y) / d;
        st.x = w.x + nx * min; st.y = w.y + ny * min;
        const vn = st.vx * nx + st.vy * ny;
        if (vn < 0) { st.vx -= 1.7 * vn * nx; st.vy -= 1.7 * vn * ny; }
      }
    } else if (z.t === 'cannon') {
      const sh = shotAt(z, st.t);
      const d = Math.hypot(st.x - sh.x, st.y - sh.y);
      if (d < RB + 13 && d > 0) {
        st.vx += ((st.x - sh.x) / d) * 520 + z.dx * 340;
        st.vy += ((st.y - sh.y) / d) * 520 + z.dy * 340;
      }
    } else if (z.t === 'stepback') {
      /* Consumption is handled in the collision pass below, not here. Testing "is the ball
         overlapping the platform" before integration never fires: the collision resolves the
         ball to exactly z.y - RB, so the overlap is zero by the time this runs. */
    } else if (z.t === 'bronco') {
      // a pad that throws you at one fixed angle, every time — the whole joke is that it
      // does not care how you arrived
      // A generous trigger on purpose: a launcher you cannot reliably land on is not a
      // choice, it is a coin flip. The pad is drawn at this size too, so what you see is
      // what fires.
      if (Math.abs(st.x - z.x) < 78 && Math.abs(st.y - z.y) < 58 && st.kick !== z) {
        st.vx = z.dx * z.power; st.vy = z.dy * z.power; st.kick = z;
      }
    }
  }
  // lasso: caught into an orbit, released by flapping. Handled after the loop so a ball
  // cannot be grabbed by two posts in the same step.
  if (st.rope == null) {
    for (let i = 0; i < L.zones.length; i++) {
      const z = L.zones[i];
      if (z.t !== 'lasso' || st.freed === i) continue;
      const d = Math.hypot(st.x - z.x, st.y - z.y);
      if (d < z.r && d > 24) {
        st.rope = i; st.ropeR = d;
        st.ropeA = Math.atan2(st.y - z.y, st.x - z.x);
        // keep the speed you arrived with, redirected along the circle
        const speed = Math.hypot(st.vx, st.vy);
        const tx = -Math.sin(st.ropeA), ty = Math.cos(st.ropeA);
        st.ropeW = (st.vx * tx + st.vy * ty >= 0 ? 1 : -1) * (speed / Math.max(40, d));
        break;
      }
    }
  }
}

function step(st, P) {
  if (st.sank) return st;
  const L = LEVELS[st.li], h = hoopOf(st.li);
  st.px = st.x; st.py = st.y;          // where we were, for the rim-plane crossing test
  st.t++;
  zones(st, P, L);

  if (st.rope != null) {
    const z = L.zones[st.rope];
    // pendulum: gravity's tangential component drives it, so a rope under the post swings
    st.ropeW += (-P.gravity / Math.max(60, st.ropeR)) * Math.cos(st.ropeA) * DT;
    st.ropeW *= 0.999;
    st.ropeA += st.ropeW * DT;
    st.x = z.x + Math.cos(st.ropeA) * st.ropeR;
    st.y = z.y + Math.sin(st.ropeA) * st.ropeR;
    st.vx = -Math.sin(st.ropeA) * st.ropeW * st.ropeR;
    st.vy = Math.cos(st.ropeA) * st.ropeW * st.ropeR;
    st.rot += st.ropeW * DT;
    return st;                     // roped: no gravity, no collisions, just the swing
  }
  st.vy += P.gravity * DT;
  const k = Math.max(0, 1 - P.drag * DT);
  st.vx *= k; st.vy *= k;
  st.x += st.vx * DT; st.y += st.vy * DT;
  st.rot += st.spin * DT;

  for (const s of segsOf(st.li)) {
    const c = closestOnSeg(st.x, st.y, s[0], s[1], s[2], s[3]);
    resolve(st, P, c.x, c.y, 0, P.bounce);
  }
  if (L.zones) for (const z of L.zones) {
    if (z.t !== 'stepback' || (st.broke & (1 << (z.id & 30)))) continue;
    const c = closestOnSeg(st.x, st.y, z.x - z.w / 2, z.y, z.x + z.w / 2, z.y);
    const touching = Math.hypot(st.x - c.x, st.y - c.y) < RB;
    const fromAbove = st.py <= z.y && st.vy > 0;
    resolve(st, P, c.x, c.y, 0, P.bounce);
    // one bounce, then the floor leaves — that bounce is the point, it is what launches you
    if (touching && fromAbove) st.broke |= 1 << (z.id & 30);
  }
  // the rim is two tubes — which is exactly why a shot can rattle in, or spit out
  const soft = P.bounce * (1 - P.rimSoft);
  resolve(st, P, h.lx, h.y, RIM_R, soft);
  resolve(st, P, h.rx, h.y, RIM_R, soft);
  // backboard, standing behind the rim
  const bb = closestOnSeg(st.x, st.y, h.rx + 8, h.y - 4, h.rx + 8, h.y - 96);
  resolve(st, P, bb.x, bb.y, 0, P.bounce * 0.9);

  /* A basket is the ball CROSSING the rim plane downward, not merely being under it.
     Testing "below the rim and moving down" counted a ball that rose up through the net
     from underneath and then fell back — you could score from below the hoop entirely.
     So: were we above the plane last step, are we below it now, and where exactly did we
     cross? Interpolating the crossing point also stops a fast shot from being judged on
     whichever side of the rim it happened to land after the step. */
  if (st.py <= h.y && st.y > h.y && st.vy > 0) {
    const t = (h.y - st.py) / (st.y - st.py || 1);
    const cx = st.px + (st.x - st.px) * t;
    if (cx > h.lx + RIM_R && cx < h.rx - RIM_R) st.sank = true;
  }
  return st;
}

/* Replay a whole attempt from its inputs. inputs = [{s: stepIndex, d: -1|1}, ...] */
function simulate(li, P, inputs, maxSteps) {
  const st = makeState(li);
  const at = new Map();
  for (const i of inputs) { if (!at.has(i.s)) at.set(i.s, []); at.get(i.s).push(i.d); }
  for (let s = 0; s < maxSteps; s++) {
    const fl = at.get(s);
    if (fl) for (const d of fl) flap(st, P, d);
    step(st, P);
    if (st.sank) return { sank: true, steps: s + 1, flaps: st.flaps, x: st.x, y: st.y };
  }
  return { sank: false, steps: maxSteps, flaps: st.flaps, x: st.x, y: st.y };
}

export { DT, RB, RIM_R, RIM_HALF, DEFAULTS, WORLDS, LEVELS, segsOf, hoopOf, makeState, flap, step, simulate, weedAt, shotAt };
