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
const RB = 17, RIM_R = 7, RIM_HALF = 52;
const BACKBOARD_SOFT = 0.38;   // fraction of the ball's normal bounce the glass returns   // ball radius, rim tube radius, half hoop width

/* These seven numbers ARE the game. Levels, art and input can all be rebuilt; if these are
   wrong it simply is not fun, and nothing else rescues it. */
const DEFAULTS = { gravity: 850, lift: 450, side: 180, bounce: 0.95, grip: 0.75, drag: 0.17, rimSoft: 0.42 };

/* A world owns its palette, so adding Denver or Boston later is a data change rather than
   a rendering change. The ball stays basketball-orange everywhere — it is the one object
   that should never take on a team's colours. */
const WORLDS = {
  house: {
    teaser: 'Just you, a ball, and a hoop. Learn the flap.',
    name: 'The gym', sub: 'Where it started', team: '',
    pal: { bg1:'#241a12', bg2:'#332317', wall:'#6B5240', edge:'rgba(232,220,200,.30)',
           rim:'#C24A24', glass:'#6E96A6', accent:'#E8DCC8', grain:'rgba(232,220,200,.05)' },
    /* `air` describes the room behind the play, and the renderer reads only these keys — so a
       new city is a data entry, not a new drawing routine. sky/haze paint the backdrop,
       ridge is a silhouette profile, motes are the things drifting in the light. */
    air: { sky:['#1a120c','#2b1e14'], haze:'rgba(232,220,200,.03)', ridge:'none',
           motes:'dust', banners:0, floor:'boards', lamp:'#F2D9A8' },
  },

  dallas: {
    teaser: 'Welcome to Dallas, where the derricks run hot, the ropes are always out, and nobody stays on a horse for long.',
    name: 'Dallas', sub: 'Hardwood & horses', team: 'Mavericks',
    pal: { bg1:'#08131F', bg2:'#122A44', wall:'#1E4470', edge:'rgba(184,196,202,.55)',
           rim:'#00538C', glass:'#B8C4CA', accent:'#B8C4CA', grain:'rgba(184,196,202,.06)' },
    air: { sky:['#050B14','#123056'], haze:'rgba(184,196,202,.05)', ridge:'skyline',
           motes:'dust', banners:0, floor:'boards', lamp:'#CFE0EA', stars: 1 },
  },

  boston: {
    /* Dead spots are the mechanic and the folklore at once: the old Garden parquet really did
       have places the ball came up flat, and the home side was said to know every one. */
    teaser: 'Welcome to Boston, where the parquet has dead spots and the home side knows every one of them.',
    name: 'Boston', sub: 'Know the floor', team: 'Celtics',
    pal: { bg1:'#0A1810', bg2:'#123021', wall:'#1D5237', edge:'rgba(226,214,178,.55)',
           rim:'#BA9653', glass:'#CFE3D4', accent:'#E2D6B2', grain:'rgba(226,214,178,.05)' },
    air: { sky:['#06120C','#0F2A1C'], haze:'rgba(226,214,178,.045)', ridge:'rafters',
           motes:'dust', banners:17, floor:'parquet', lamp:'#F5E7BF' },
  },

  denver: {
    /* Thin air, and it is not decoration: less drag means the ball carries, so every hole
       here is judged with a lighter touch than the same shape at sea level. */
    teaser: 'Welcome to Denver, where the air is a little thinner \u2014 the ball carries further than you think, and so do your mistakes.',
    name: 'Denver', sub: 'A mile of thin air', team: 'Nuggets',
    phys: { drag: 0.45, gravity: 0.94 },
    pal: { bg1:'#0B1020', bg2:'#1B2350', wall:'#33407F', edge:'rgba(254,200,72,.5)',
           rim:'#FEC524', glass:'#C7CEE8', accent:'#FEC524', grain:'rgba(199,206,232,.05)' },
    air: { sky:['#070B1A','#2A2F63'], haze:'rgba(199,206,232,.06)', ridge:'mountains',
           motes:'snow', banners:0, floor:'boards', lamp:'#FFE9A8', stars: 1 },
  },
};

/* Hand-placed, not generated. A generator gives infinite mediocre holes; deliberate ones
   tell you far more about whether the mechanic deserves building on.
   Each level declares its world, its size, its INNER geometry (borders are generated), and
   its zones — the things that make a world feel like somewhere rather than a box. */
/* Progression, deliberately: each hole introduces ONE idea, the next combines it with what
   you already know, and the last few open up into two routes — a short line that asks for
   precision and a longer one that forgives. A world that teaches nothing is just a list. */
const LEVELS = [
  /* ---------------- The gym: where it started ---------------- */
  { name: "Warm-up", world: "house", par: 4, w: 1000, h: 600,
    ball: { x: 120, y: 430 }, hoop: { x: 780, y: 300 },
    inner: [[420,600,420,470]] },
  { name: "The long two", world: "house", par: 10, w: 2600, h: 700,
    ball: { x: 110, y: 560 }, hoop: { x: 2380, y: 300 },
    inner: [[520,700,520,420],[900,0,900,300],[1300,700,1300,380],[1300,380,1700,380],[2000,0,2000,340]] },
  { name: "Upstairs", world: "house", par: 12, w: 682, h: 806,
    ball: { x: 81, y: 732 }, hoop: { x: 508, y: 149 },
    inner: [[0,558,434,558],[260,347,682,347]] },

  /* ---------------- Dallas: hardwood & horses ---------------- */
  { name: "Sundown", world: "dallas", par: 6, w: 1300, h: 700,
    ball: { x: 130, y: 600 }, hoop: { x: 1120, y: 280 },
    inner: [[560,700,560,430],[860,0,860,300]] },
  { name: "Crude", world: "dallas", par: 7, w: 1400, h: 1500,
    ball: { x: 130, y: 1420 }, hoop: { x: 1120, y: 200 },
    inner: [[800,0,800,1240],[400,1500,400,1300]],
    zones: [
      {"t":"gush","x":850,"y":320,"w":520,"h":1160,"force":2000} ] },
  { name: "Step-back", world: "dallas", par: 8, w: 2400, h: 1200,
    ball: { x: 130, y: 720 }, hoop: { x: 2290, y: 520 },
    inner: [[0,780,400,780],[300,700,2160,700],[400,780,400,1200],[2160,780,2160,1200],[2160,780,2400,780]],
    zones: [
      {"t":"stepback","id":1,"x":640,"y":780,"w":210},
      {"t":"stepback","id":2,"x":1020,"y":780,"w":210},
      {"t":"stepback","id":3,"x":1400,"y":780,"w":210},
      {"t":"stepback","id":4,"x":1780,"y":780,"w":210} ] },
  { name: "The fadeaway", world: "dallas", par: 10, w: 1900, h: 1100,
    ball: { x: 110, y: 1020 }, hoop: { x: 1740, y: 220 },
    inner: [[0,900,1000,900],[1000,900,1000,240],[200,720,520,720],[700,460,1050,460]],
    zones: [
      {"t":"bronco","x":880,"y":1060,"dx":0.4,"dy":-0.92,"power":2100} ] },
  { name: "Eight seconds", world: "dallas", par: 11, w: 1800, h: 1000,
    ball: { x: 120, y: 920 }, hoop: { x: 1660, y: 220 },
    inner: [[0,820,900,820],[900,820,900,200],[220,600,560,600],[640,380,1000,380]],
    zones: [
      {"t":"bronco","x":780,"y":960,"dx":0.4,"dy":-0.92,"power":2100} ] },
  { name: "Stockyards", world: "dallas", par: 11, w: 2600, h: 1500,
    ball: { x: 120, y: 1420 }, hoop: { x: 2440, y: 260 },
    inner: [[620,0,620,1240],[1180,300,1180,1500],[1180,300,1900,300],[1900,300,1900,700],[2120,760,2600,760]],
    zones: [
      {"t":"gush","x":660,"y":360,"w":500,"h":1140,"force":2000},
      {"t":"lasso","x":1560,"y":560,"r":250},
      {"t":"bronco","x":2300,"y":720,"dx":0.05,"dy":-0.99,"power":1500} ] },
  { name: "T-shirt cannon", world: "dallas", par: 12, w: 2100, h: 900,
    ball: { x: 120, y: 838 }, hoop: { x: 1980, y: 250 },
    inner: [[400,0,400,762],[1680,0,1680,762],[400,762,1680,762]],
    zones: [
      {"t":"cannon","x":1660,"y":826,"dx":-1,"dy":0,"range":1240,"period":200,"phase":0},
      {"t":"cannon","x":420,"y":826,"dx":1,"dy":0,"range":1240,"period":280,"phase":100} ] },
  { name: "Roped", world: "dallas", par: 13, w: 2400, h: 1400,
    ball: { x: 140, y: 1180 }, hoop: { x: 2280, y: 300 },
    inner: [[0,1240,520,1240],[520,1240,520,1400],[1900,620,2400,620],[1900,620,1900,1400],[340,200,2000,200]],
    zones: [
      {"t":"lasso","x":900,"y":560,"r":260},
      {"t":"lasso","x":1560,"y":470,"r":240} ] },
  { name: "Tumbleweed", world: "dallas", par: 21, w: 1500, h: 900,
    ball: { x: 110, y: 830 }, hoop: { x: 1380, y: 250 },
    inner: [[340,0,340,748],[1140,0,1140,748],[340,748,1140,748]],
    zones: [
      {"t":"weed","x1":460,"y1":828,"x2":1020,"y2":828,"r":44,"period":300},
      {"t":"weed","x1":1020,"y1":828,"x2":460,"y2":828,"r":40,"period":210} ] },

  /* ---------------- Boston: know the floor ---------------- */
  { name: "The parquet", world: "boston", par: 10, w: 2100, h: 1400,
    ball: { x: 120, y: 1320 }, hoop: { x: 1880, y: 240 },
    inner: [[420,0,420,1160],[1400,0,1400,1160],[1400,340,1900,340]],
    zones: [
      {"t":"dead","x":520,"y":1400,"w":340},
      {"t":"dead","x":960,"y":1400,"w":340},
      {"t":"gush","x":1440,"y":400,"w":440,"h":1000,"force":2000} ] },
  { name: "Garden floor", world: "boston", par: 11, w: 1500, h: 800,
    ball: { x: 110, y: 720 }, hoop: { x: 1380, y: 240 },
    inner: [[300,0,300,640],[1120,0,1120,640]],
    zones: [
      {"t":"dead","x":420,"y":800,"w":300},
      {"t":"dead","x":800,"y":800,"w":280} ] },
  { name: "Sixteen banners", world: "boston", par: 15, w: 1900, h: 1000,
    ball: { x: 120, y: 920 }, hoop: { x: 1780, y: 260 },
    inner: [[380,0,380,840],[1240,0,1240,840],[1240,840,1560,840]],
    zones: [
      {"t":"dead","x":460,"y":1000,"w":320},
      {"t":"dead","x":860,"y":1000,"w":320},
      {"t":"lasso","x":1600,"y":420,"r":220} ] },

  /* ---------------- Denver: a mile of thin air ---------------- */
  { name: "Mile high", world: "denver", par: 7, w: 1600, h: 700,
    ball: { x: 130, y: 600 }, hoop: { x: 1440, y: 260 },
    inner: [[700,700,700,420],[1100,0,1100,300]] },
  { name: "Altitude", world: "denver", par: 10, w: 2200, h: 1600,
    ball: { x: 120, y: 1520 }, hoop: { x: 2040, y: 260 },
    inner: [[700,0,700,1340],[1300,320,1300,1600],[1300,320,2000,320],[2000,320,2000,700]],
    zones: [
      {"t":"gush","x":740,"y":380,"w":540,"h":1220,"force":2050},
      {"t":"lasso","x":1680,"y":560,"r":250} ] },
  { name: "Timberline", world: "denver", par: 17, w: 1700, h: 900,
    ball: { x: 110, y: 830 }, hoop: { x: 1580, y: 250 },
    inner: [[360,0,360,748],[1260,0,1260,748],[360,748,1260,748]],
    zones: [
      {"t":"weed","x1":480,"y1":828,"x2":1140,"y2":828,"r":46,"period":280} ] },
];

/* Border walls, generated from the level's own dimensions so a map cannot leak. */
function segsOf(li) {
  const L = LEVELS[li];
  if (!L._segs) {
    L._segs = [[0,0,L.w,0],[0,L.h,L.w,L.h],[0,0,0,L.h],[L.w,0,L.w,L.h]].concat(L.inner || []);
  }
  return L._segs;
}

/* A world may bend the feel — Denver's thin air, say. Both the browser and the server derive
   params through this one function from level data alone, so a replay on the server lands on
   exactly the numbers the player had. Anything that varies per world MUST come through here;
   a value read from anywhere else breaks verification the moment a world uses it. */
function paramsFor(li, base) {
  const L = LEVELS[li], w = WORLDS[L.world]
  const P = { ...(base || DEFAULTS) }
  const m = (w && w.phys) || null
  if (m) for (const k of Object.keys(m)) P[k] = P[k] * m[k]
  return P
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
  // Resolves world physics itself — callers pass BASE params, never an already-resolved set,
  // or the world's multipliers apply twice.
  P = paramsFor(li, P);
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

export { DT, RB, RIM_R, RIM_HALF, BACKBOARD_SOFT, DEFAULTS, WORLDS, LEVELS, segsOf, hoopOf, paramsFor, makeState, flap, step, simulate, weedAt, shotAt };
