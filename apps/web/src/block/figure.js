/**
 * The neighbour's body. A skeleton of joints, a tapered tube between each pair and a ball at each
 * joint — see `rig()` below for why, and `spidey.html` for a turntable to look at him on.
 * Shared by the block (where he is a few dozen pixels of red) and by that viewer.
 */
import * as THREE from "three";

// The block runs the r128 look — no colour management, linear output — and sets this flag itself.
// It has to be set here too, because imports are hoisted: this module's bodies are built, and their
// vertex colours converted, before the first line of whatever imported it ever runs. Set it late and
// the suit comes out of a different colour space than the city it is swinging through.
THREE.ColorManagement.enabled = false;

// Two poses, each one merged vertex-coloured mesh (one draw call), built facing +x with +y up.
const SUIT_RED = "#c9272e", SUIT_BLUE = "#1d3f9e", SUIT_EYE = "#eef2fb", SUIT_LINE = "#140d18";
// The web lines. Dark enough to read as lines across a room, but kept a deep red rather than black:
// at twenty-five pixels the lines stop resolving and all that is left is their average, and the
// average of red and black is a brown smudge where the average of red and oxblood is still red.
const SUIT_WEB = "#4a0d13";
// Boxes make a Minecraft man. An axis-aligned brick can only be vertical or horizontal, so every
// joint becomes a corner and every limb a plank, and no amount of extra bricks fixes it. This is
// built the other way round: a skeleton of joints, a tapered tube drawn between each pair, a ball
// dropped at each joint. A limb can then point anywhere with no pivot bookkeeping, it is thicker at
// the shoulder than at the wrist the way an arm is, and the normals go round the limb instead of
// facing six ways — which is what makes it catch the light as a body rather than as a crate.
const rgA = new THREE.Vector3(), rgB = new THREE.Vector3(), rgD = new THREE.Vector3();
const rgU = new THREE.Vector3(), rgV = new THREE.Vector3(), rgT = new THREE.Vector3(), rgN = new THREE.Vector3();
function rig() {
  const pos = [], nor = [], col = [], cA = new THREE.Color(), cB = new THREE.Color(), cW = new THREE.Color();
  const put = (x, y, z, nx, ny, nz, c) => { pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c.r, c.g, c.b); };
  const quad = (p, q, s, t) => {
    put(p.x, p.y, p.z, p.nx, p.ny, p.nz, p.c); put(q.x, q.y, q.z, q.nx, q.ny, q.nz, q.c); put(s.x, s.y, s.z, s.nx, s.ny, s.nz, s.c);
    put(p.x, p.y, p.z, p.nx, p.ny, p.nz, p.c); put(s.x, s.y, s.z, s.nx, s.ny, s.nz, s.c); put(t.x, t.y, t.z, t.nx, t.ny, t.nz, t.c);
  };
  const api = {
    // A tapered tube between two joints. `w` and `d` squash the cross-section across the body and
    // front-to-back, so the same call makes a round arm and an oval rib-cage. `side` paints the
    // flanks: a red chest with blue sides is both the suit and the only thing that stops a red arm
    // from vanishing into a red chest at nine pixels wide.
    tube(a, b, ra, rb, hex, o = {}) {
      cA.set(hex); cB.set(o.side || hex); cW.set(o.web || hex);
      const w = o.w ?? 1, d = o.d ?? 1, cut = o.sideAt ?? 0.62, seg = o.seg ?? (o.web ? 12 : 8);
      rgA.fromArray(a); rgB.fromArray(b);
      const len = rgA.distanceTo(rgB) || 1e-4;
      rgD.subVectors(rgB, rgA).divideScalar(len);
      // Any frame perpendicular to the limb will do; this one picks the across-the-body axis first,
      // so for an upright limb `w` is always width and `d` is always depth.
      rgT.set(0, 1, 0); if (Math.abs(rgD.y) > 0.9) rgT.set(1, 0, 0);
      rgU.crossVectors(rgT, rgD).normalize();
      rgV.crossVectors(rgD, rgU);
      // One point on the sleeve, at angle `th` around it and fraction `t` along it, pushed out by
      // `k`. Everything below — the sleeve, the end caps, the web panels — is this function.
      const P = (th, t, k) => {
        const cs = Math.cos(th), sn = Math.sin(th), r = (ra + (rb - ra) * t) * k;
        rgN.set(0, 0, 0).addScaledVector(rgU, cs / w).addScaledVector(rgV, sn / d).normalize();
        return {
          x: rgA.x + rgD.x * len * t + (rgU.x * cs * w + rgV.x * sn * d) * r,
          y: rgA.y + rgD.y * len * t + (rgU.y * cs * w + rgV.y * sn * d) * r,
          z: rgA.z + rgD.z * len * t + (rgU.z * cs * w + rgV.z * sn * d) * r,
          nx: rgN.x, ny: rgN.y, nz: rgN.z, c: Math.abs(cs) > cut ? cB : cA,
        };
      };
      const dark = (p) => ({ x: p.x, y: p.y, z: p.z, nx: p.nx, ny: p.ny, nz: p.nz, c: cW });
      const TAU = Math.PI * 2;
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg * TAU, t1 = (i + 1) / seg * TAU;
        const pa = P(t0, 0, 1), qa = P(t1, 0, 1), qb = P(t1, 1, 1), pb = P(t0, 1, 1);
        // Under a webbed sleeve the whole thing is laid down dark first; the red panels go on top.
        if (o.web) quad(dark(pa), dark(qa), dark(qb), dark(pb));
        else quad(pa, qa, qb, pb);
        // Both ends are closed with a fan. A tube is a sleeve, and wherever the joint ball at its
        // end is a shade smaller than the sleeve — a wrist, the top of a boot, the base of the neck
        // — an open sleeve is a hole you can see straight through the body.
        const ca = o.web ? cW : pa.c, cb = o.web ? cW : pb.c;
        put(rgA.x, rgA.y, rgA.z, -rgD.x, -rgD.y, -rgD.z, ca);
        put(qa.x, qa.y, qa.z, -rgD.x, -rgD.y, -rgD.z, ca);
        put(pa.x, pa.y, pa.z, -rgD.x, -rgD.y, -rgD.z, ca);
        put(rgB.x, rgB.y, rgB.z, rgD.x, rgD.y, rgD.z, cb);
        put(pb.x, pb.y, pb.z, rgD.x, rgD.y, rgD.z, cb);
        put(qb.x, qb.y, qb.z, rgD.x, rgD.y, rgD.z, cb);
      }
      if (!o.web) return api;
      // The web. Not a texture and not a decal: each cell of the sleeve is drawn again a hair
      // smaller and a hair further out, so the dark sleeve underneath shows through the join — and
      // *that gap is the line*. It costs one quad per cell, needs no UVs, and the lines wrap round
      // a shoulder and bend with a limb for free, which a projected pattern never does.
      // A web is thread on cloth: the line has to be much thinner than the cell it bounds. At a
      // tenth of a cell it reads as webbing; at a sixth it reads as a waffle, and at a quarter the
      // suit has gone and he is wearing a net.
      const g = o.gap ?? 0.1, rings = Math.max(1, Math.round(len / (o.ring ?? 0.075)));
      for (let i = 0; i < seg; i++) for (let j = 0; j < rings; j++) {
        const t0 = (i + g) / seg * TAU, t1 = (i + 1 - g) / seg * TAU;
        const u0 = (j + g * 0.9) / rings, u1 = (j + 1 - g * 0.9) / rings;
        quad(P(t0, u0, 1.035), P(t1, u0, 1.035), P(t1, u1, 1.035), P(t0, u1, 1.035));
      }
      return api;
    },
    // A joint, and anything else that is a lump rather than a limb: the skull, a fist, the white of
    // an eye. `sx/sy/sz` stretch it; `roll` spins it about the facing axis, which is how an eye
    // slants without needing a frame of its own.
    ball(at, r, hex, o = {}) {
      cA.set(hex); cW.set(o.web || hex);
      const sx = (o.sx ?? 1) * r, sy = (o.sy ?? 1) * r, sz = (o.sz ?? 1) * r;
      const lat = o.lat ?? 5, lon = o.lon ?? 8, rl = (o.roll ?? 0) * Math.PI / 180;
      const cr = Math.cos(rl), sr = Math.sin(rl);
      // Same bargain as the sleeve: one point, addressed by its two angles and pushed out by `k`.
      // A mask drawn this way gets the web running round the skull the way the suit's does, with
      // the strands converging wherever the grid converges — which is exactly a spider's web.
      const P = (th, ph, k, c) => {
        const cp = Math.cos(ph), sp = Math.sin(ph), ct = Math.cos(th), st = Math.sin(th);
        const x = sx * cp * ct * k, y = sy * sp * k, z = sz * cp * st * k;
        // The normal of an ellipsoid is the gradient, not the radius: divide by the squashing.
        const nx = cp * ct / sx, ny = sp / sy, nz = cp * st / sz;
        const ny2 = ny * cr - nz * sr, nz2 = ny * sr + nz * cr;
        const nl = Math.hypot(nx, ny2, nz2) || 1;
        return { x: at[0] + x, y: at[1] + y * cr - z * sr, z: at[2] + y * sr + z * cr,
                 nx: nx / nl, ny: ny2 / nl, nz: nz2 / nl, c };
      };
      const TAU = Math.PI * 2, HP = Math.PI / 2, base = o.web ? cW : cA;
      for (let j = 0; j < lat; j++) for (let i = 0; i < lon; i++) {
        const p0 = -HP + j / lat * Math.PI, p1 = -HP + (j + 1) / lat * Math.PI;
        const t0 = i / lon * TAU, t1 = (i + 1) / lon * TAU;
        quad(P(t0, p0, 1, base), P(t0, p1, 1, base), P(t1, p1, 1, base), P(t1, p0, 1, base));
      }
      if (!o.web) return api;
      const g = o.gap ?? 0.1;
      for (let j = 0; j < lat; j++) for (let i = 0; i < lon; i++) {
        const p0 = -HP + (j + g) / lat * Math.PI, p1 = -HP + (j + 1 - g) / lat * Math.PI;
        const t0 = (i + g) / lon * TAU, t1 = (i + 1 - g) / lon * TAU;
        quad(P(t0, p0, 1.03, cA), P(t0, p1, 1.03, cA), P(t1, p1, 1.03, cA), P(t1, p0, 1.03, cA));
      }
      return api;
    },
    geo() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      return g;
    },
  };
  return api;
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// One body, two sets of joints. Everything that makes him recognisable lives here and not in the
// poses: red boots and gloves against blue legs, a red chest with blue flanks, and above all the two
// big white eyes with a dark rim, which are the single feature that survives being small.
function body(J) {
  const r = rig(), hr = J.headR;
  // The spider goes on the sternum, not on the chest joint — the joint is up at the collarbone, and
  // a spider there reads as a bow tie.
  const sternum = lerp3(J.pelvis, J.chest, 0.78);
  for (const s of ["L", "R"]) {
    const hip = J["hip" + s], knee = J["knee" + s], ank = J["ank" + s], toe = J["toe" + s];
    const sho = J["sho" + s], elb = J["elb" + s], wri = J["wri" + s], fist = J["fist" + s];
    // Every joint ball is a shade fatter than the two tubes it joins. Equal radii leave a notch on
    // the inside of any bend, which at a knee or an elbow reads as the limb being broken in two.
    //
    // No limb is one taper. A single cone from shoulder to elbow is a stick, and a figure made of
    // sticks is lanky however thick you make the sticks — thickening it evenly just gets a fatter
    // stick. What reads as muscle is the belly: each limb swells a third of the way along and
    // narrows again into the joint, so a bicep, a forearm and a calf each have a high point and the
    // silhouette curves instead of running straight. That costs one extra tube per limb.
    r.tube(hip, lerp3(hip, knee, 0.38), 0.092, 0.086, SUIT_BLUE)
     .tube(lerp3(hip, knee, 0.38), knee, 0.086, 0.064, SUIT_BLUE)
     .ball(knee, 0.068, SUIT_BLUE, { sy: 0.9 })
     // The calf belly sits high and the boot comes up the shin: a red foot stuck on a blue leg reads
     // as a sock, a red shin reads as a boot, and that is the whole difference.
     .tube(knee, lerp3(knee, ank, 0.34), 0.068, 0.080, SUIT_BLUE)
     .tube(lerp3(knee, ank, 0.34), lerp3(knee, ank, 0.55), 0.080, 0.062, SUIT_BLUE)
     // Everything red is webbed; the blue is left plain, as the suit is. That split is also what
     // keeps the webbing from swallowing the figure — half of him stays a flat block of colour.
     .tube(lerp3(knee, ank, 0.55), ank, 0.060, 0.048, SUIT_RED, { web: SUIT_WEB })
     .ball(ank, 0.054, SUIT_RED, { web: SUIT_WEB })
     .tube(lerp3(toe, ank, 1.3), toe, 0.052, 0.036, SUIT_RED, { w: 0.85, d: 0.7, web: SUIT_WEB })
     .ball(hip, 0.095, SUIT_BLUE, { sy: 0.85 })
     // The deltoid is a ball in its own right, wider than the arm below it. A shoulder the same width
     // as the bicep is what makes a drawn figure look adolescent.
     .ball(sho, 0.090, SUIT_RED, { sy: 0.95, web: SUIT_WEB, lat: 6, lon: 9 })
     .tube(sho, lerp3(sho, elb, 0.42), 0.066, 0.072, SUIT_RED, { web: SUIT_WEB })
     .tube(lerp3(sho, elb, 0.42), elb, 0.072, 0.050, SUIT_RED, { web: SUIT_WEB })
     .ball(elb, 0.056, SUIT_RED, { web: SUIT_WEB })
     .tube(elb, lerp3(elb, wri, 0.32), 0.052, 0.060, SUIT_RED, { web: SUIT_WEB })
     .tube(lerp3(elb, wri, 0.32), wri, 0.060, 0.038, SUIT_RED, { web: SUIT_WEB })
     .tube(wri, fist, 0.038, 0.048, SUIT_RED, { web: SUIT_WEB })
     .ball(fist, 0.058, SUIT_RED, { sx: 1.15, lat: 4, lon: 7, web: SUIT_WEB });
  }
  // The torso is still narrower than the shoulders and much narrower than the arms hang: the thing
  // that reads as a person at this size is the daylight between an arm and a rib, and a barrel chest
  // closes it. So the bulk goes into the V rather than into the width — the waist pinches at the
  // navel and flares to the chest, which is read as muscle from any distance, where an evenly thick
  // trunk is read as fat.
  // sideAt is a cosine against the across-the-body axis, so 0.45 put blue round seventy per cent of
  // the trunk and the red was a stripe. 0.74 keeps the blue on the flanks where the suit has it.
  const TRUNK = { w: 1.02, d: 0.82, side: SUIT_BLUE, sideAt: 0.74, web: SUIT_WEB, seg: 14 };
  r.tube(J.hipL, J.hipR, 0.100, 0.100, SUIT_BLUE, { d: 0.85 })
   .tube(J.pelvis, lerp3(J.pelvis, J.chest, 0.40), 0.106, 0.096, SUIT_RED, TRUNK)
   .tube(lerp3(J.pelvis, J.chest, 0.40), J.chest, 0.096, 0.158, SUIT_RED, TRUNK)
   .ball(J.chest, 0.150, SUIT_RED, { sx: 0.82, sy: 0.9, sz: 1.04, web: SUIT_WEB, lat: 6, lon: 10 })
   // The trapezius: a thick bar across the top of the chest, which is what fills the hollow a thin
   // neck leaves between the collarbone and the jaw.
   .tube(J.shoL, J.shoR, 0.098, 0.098, SUIT_RED, { d: 0.88, web: SUIT_WEB })
   .tube(J.chest, lerp3(J.neck, J.head, 0.45), 0.102, 0.078, SUIT_RED, { web: SUIT_WEB })
   // The mask. Finer web than the body — more cells over a smaller ball — because the head is what
   // anyone looks at, and it is the only place where the strands converge the way a real web does.
   .ball(J.head, hr, SUIT_RED, { sx: 1.02, sy: 1.12, sz: 0.9, lat: 9, lon: 14, web: SUIT_WEB, gap: 0.12 })
   // The spider, big enough to be a mark rather than a smudge. It sits on top of the webbing, so it
   // is drawn last and a little further out, and it is the one black thing on the chest.
   .ball([sternum[0] + 0.118, sternum[1], sternum[2]], 0.105, SUIT_LINE, { sx: 0.22, sy: 1.05, sz: 0.9, lat: 4, lon: 7 });
  for (const zs of [-1, 1]) {
    const e = [J.head[0] + hr * 0.70, J.head[1] + hr * 0.12, J.head[2] + zs * hr * 0.46];
    // Bigger than life, because the webbing now competes with them. The eyes are the one feature
    // that has to win at every distance: they are what makes a red shape Spider-Man rather than a
    // man in a red suit, and a web crossing the face takes that away unless they are the loudest
    // thing on the head.
    // Rim first, a shade larger and set back, so the white has an edge instead of melting into red.
    r.ball([e[0] - 0.016, e[1], e[2]], hr * 0.70, SUIT_LINE, { sx: 0.34, sy: 0.74, sz: 1.14, roll: -zs * 16, lat: 4, lon: 8 })
     .ball(e, hr * 0.60, SUIT_EYE, { sx: 0.34, sy: 0.72, sz: 1.08, roll: -zs * 16, lat: 4, lon: 8 });
  }
  return r.geo();
}
// Crouched on a ledge with the shooting arm already out: feet planted, knees up and apart, back
// curled forward over them, left hand hanging past the knee. What makes a shape read as a person
// from across a block is not detail but the gaps — between the legs, between the arms and the ribs,
// between the head and the shoulders — so every limb stays slim and clear of its neighbour.
const PERCH_G = body({
  headR: 0.125,
  // The head sits closer to the shoulders than a measured-out figure would put it. A neck of correct
  // length on a body this stylised reads as a long one, because there is no collarbone or jaw to
  // break it up — only a smooth tube, and a smooth tube always looks longer than it is.
  pelvis: [-0.05, 0.67, 0], chest: [0.07, 1.06, 0], neck: [0.12, 1.19, 0], head: [0.17, 1.31, 0],
  // The knee is forward of both the hip and the ankle, and level with the hip rather than below it:
  // a thigh that is nearly horizontal is the whole of what makes a crouch read as a crouch instead
  // of as standing with soft knees.
  hipL: [-0.04, 0.64, -0.085], hipR: [-0.04, 0.64, 0.085],
  kneeL: [0.36, 0.60, -0.15], kneeR: [0.36, 0.60, 0.15],
  ankL: [0.15, 0.09, -0.115], ankR: [0.15, 0.09, 0.115],
  toeL: [0.33, 0.045, -0.115], toeR: [0.33, 0.045, 0.115],
  // Shoulders and arms move out with the new bulk. The gap between a bicep and a rib has to stay
  // visible or the chest and the arms merge into one slab; widening the shoulder is how you buy that
  // gap back, and it happens to be what a built shoulder does anyway.
  shoL: [0.05, 1.13, -0.168], shoR: [0.05, 1.13, 0.168],
  elbL: [0.10, 0.82, -0.245], wriL: [0.21, 0.54, -0.245], fistL: [0.25, 0.45, -0.245],
  // The right arm is out and pointing, because this is also the pose the web is fired from: the line
  // has to leave a fist, and a fist at his hip means a line that appears to come out of his ribs. It
  // is held at chest height, below the chin — raised any higher it crosses the face from this angle,
  // and the face is the one part of him worth seeing.
  elbR: [0.28, 1.05, 0.225], wriR: [0.50, 0.99, 0.205], fistR: [0.59, 0.96, 0.20],
});
// The same crouch, settled: the shooting arm is down and the fist is on the roof in front of his
// feet, which is the pose that reads as *sitting on a corner* rather than waiting in one. The hand
// has to reach past the toes and touch y = 0 — an arm that stops in mid-air at knee height reads as
// a man balancing, and the point of the beat is that he is not. He stays in this until a third of a
// second before the thread goes, when he swaps to PERCH_G and the arm comes up: the raise is the
// wind-up, and firing on the same frame the arm moves is what made the web look like it teleported.
const CROUCH_G = body({
  headR: 0.125,
  // Rolled a little further forward than the perch — the weight is over the planted hand now, not
  // over the hips — and the head still carried high, because the one thing he is doing in this beat
  // is looking at where he is going next.
  pelvis: [-0.07, 0.62, 0], chest: [0.06, 1.00, 0], neck: [0.12, 1.13, 0], head: [0.19, 1.24, 0],
  hipL: [-0.06, 0.59, -0.085], hipR: [-0.06, 0.59, 0.085],
  kneeL: [0.34, 0.56, -0.155], kneeR: [0.34, 0.56, 0.155],
  ankL: [0.13, 0.09, -0.115], ankR: [0.13, 0.09, 0.115],
  toeL: [0.31, 0.045, -0.115], toeR: [0.31, 0.045, 0.115],
  shoL: [0.04, 1.07, -0.168], shoR: [0.04, 1.07, 0.168],
  // The left arm hangs inside the knee rather than outside it: outside, the forearm and the shin are
  // the same two parallel strokes at this size and the leg stops reading as a leg.
  elbL: [0.09, 0.76, -0.235], wriL: [0.18, 0.47, -0.205], fistL: [0.21, 0.38, -0.195],
  // Straight down past the knee and onto the roof, a little outside the foot so the arm is clear of
  // the shin. The fist ball is 0.058 across, so a fist centre at 0.055 sets the knuckles on the
  // surface instead of hovering over it.
  elbR: [0.31, 0.73, 0.245], wriR: [0.42, 0.21, 0.225], fistR: [0.45, 0.055, 0.22],
});
// On the web: one arm straight up the line, the other trailing, back arched, legs streaming behind
// and bent at the knee, and the two legs bent differently because a body in the air is never
// symmetrical. The fist is at y = HAND on the figure's own axis, which is where the web is tied —
// orienting +y along the rope therefore puts the line in his hand with no extra maths.
const SWING_G = body({
  headR: 0.135,
  pelvis: [-0.15, 0.76, 0], chest: [0.02, 1.13, 0], neck: [0.06, 1.20, 0], head: [0.13, 1.27, 0],
  hipL: [-0.17, 0.72, -0.105], hipR: [-0.17, 0.72, 0.105],
  kneeL: [-0.52, 0.78, -0.145], kneeR: [-0.57, 0.67, 0.125],
  ankL: [-0.92, 0.58, -0.17], ankR: [-1.00, 0.50, 0.135],
  toeL: [-1.09, 0.50, -0.19], toeR: [-1.17, 0.41, 0.145],
  shoL: [0.00, 1.21, -0.168], shoR: [0.01, 1.22, 0.168],
  elbL: [-0.40, 1.02, -0.245], wriL: [-0.74, 0.90, -0.235], fistL: [-0.85, 0.86, -0.23],
  // fistR stays at y = 2.00 exactly: the block ties the rope to HAND = 2.0 on this figure's own
  // axis, so moving it would put the web in mid-air beside his hand.
  elbR: [-0.03, 1.62, 0.105], wriR: [-0.02, 1.93, 0.045], fistR: [-0.01, 2.00, 0.02],
});
// Where the web leaves him, in his own units: the right fist of the perch pose, not a point on his
// chest. Used to start the thread so it comes out of the hand that is pointing at the corner.
const FIST = [0.59, 0.96];

export { SUIT_RED, SUIT_BLUE, SUIT_EYE, SUIT_LINE, rig, body, CROUCH_G, PERCH_G, SWING_G, FIST };
