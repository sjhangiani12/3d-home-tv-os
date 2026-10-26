/**
 * The block, live: a hand-painted isometric diorama of the streets around home (the TV's home screen). Traffic,
 * people, the subway station (bridge /mta.json), two Citi Bike docks (bridge /citibike.json), the weather
 * (Open-Meteo), and the home's lamps (bridge SSE) lighting its windows and the dollhouse.
 *
 * Privacy: the code draws a generic block. The real names (station, docks, address, rooms, lamps),
 * coordinates and layout seed come from /shared/block-home.json, which stays out of git like the apartment
 * model beside it. See README "Your block".
 *
 * Query: ?tv=1 (inside the TV launcher: no page dock, chip, drawer or mock controls; the native app drives it
 * through window.appart3dEmbed.post), ?pix=2|3 (render at 1/n and scale up, for a slow TV), ?shadows=0,
 * ?mock=1 (weather/time buttons).
 * Hash: #day #dusk #night #rain #snow #wind (forced look), #home #inside #street (start view).
 * Plain JS on purpose: a port of the approved mock, kept close to it while the design settles.
 */
import * as THREE from "three";
import { loadHomeConfig, resolveLocation, fetchTrains, fetchBikes, fetchWeather, connectDevices, deviceAction } from "../shared/feeds.js";
import * as P from "./paint.js";

// Colors and lights as in the mock (three r128 look): no color management, linear output, π-scaled lights.
THREE.ColorManagement.enabled = false;
const Q = new URLSearchParams(location.search);
const TV = Q.has("tv"), MOCK = Q.has("mock"), SHADOWS = Q.get("shadows") !== "0";
const W = 1920, H = 1080, PIX = Math.min(4, Math.max(1, Number(Q.get("pix")) || 1));
const CFG = await loadHomeConfig();
const LOC = resolveLocation(CFG, Q);
const NAMES = {
  place: CFG.place || "YOUR BLOCK",
  address: CFG.address || "Home",
  homeLabel: CFG.homeLabel || "Home",
  station: Object.assign({ name: "Station", line: "", stop: null }, CFG.station || {}),
  // Each dock says what it is and which avenue it stands on; the near one is a block over, the far one
  // across the avenue. `side` is the line on the sign, `name` the heading of its panel.
  docks: CFG.docks || [{ name: "Citi Bike", side: "3 AV" }, { name: "Citi Bike", side: "2 AV" }],
  rooms: CFG.rooms || [],
};
const PI = Math.PI;
if (TV) document.body.classList.add("tv");
document.title = CFG.title || document.title;
document.querySelector("#clock .place").textContent = NAMES.place;
document.querySelector("#drawer .addr").textContent = NAMES.address;
if (!MOCK) document.getElementById("mock").hidden = true;
const stage = document.getElementById("stage");
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
}
addEventListener("resize", fit); fit();

// ---------- seeded randomness, so the block looks the same on every load
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let rng = mulberry32(Number(CFG.seed) || 4242);
const R = (a, b) => a + (b - a) * rng();
const RI = (a, b) => Math.floor(R(a, b + 1));
const pick = (a) => a[Math.floor(rng() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- renderer
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setSize(W / PIX, H / PIX, false);
renderer.shadowMap.enabled = SHADOWS;
renderer.shadowMap.type = THREE.BasicShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(12, W / H, 100, 3000);

// ---------- the map (meters; x east, z south). Distances are squeezed so the station's avenue fits beside
// the home's (the second avenue); home sits on the fourth street, two docks on the fifth and on the fourth avenue.
// The roads carry no names: the geometry is a squeezed invention, so any name hung on it would be a lie — and
// the three things worth naming (the station, the two docks) name themselves on their own signs.
const AVES = [
  { x: -190, w: 22, dir: -1 },
  { x: -80, w: 28, two: true },
  { x: 0, w: 28, dir: -1 },
  { x: 200, w: 28, dir: 1, bike: true },
  { x: 380, w: 30, dir: -1 },
];
const STS = [
  { z: -240, w: 16, dir: -1 },
  { z: -160, w: 26, two: true },
  { z: -80, w: 16, dir: -1 },
  { z: 0, w: 16, dir: 1 },
  { z: 80, w: 16, dir: -1 },
  { z: 160, w: 16, dir: 1 },
  { z: 240, w: 16, dir: -1 },
];
const AREA = { x0: -260, x1: 460, z0: -290, z1: 290 };
const SW = 4.5, CURB = 0.18, FH = 3.3, CW = 3.4;
// Our lot, on the north side of the fourth street. It sits well into the block rather than near the corner,
// the way a walk-up on a long Manhattan side street does: there is a good stretch of neighbours either side
// of it before you reach an avenue. Everything that points at the house reads its centre off HX, so the lot
// can be slid along the block without a dozen magic numbers going stale.
const HOME = { x0: 66, x1: 79, z0: 12.5, z1: 37, floors: 6, floor: 4 };
const HX = (HOME.x0 + HOME.x1) / 2;
const TRENCH = { x0: -92, x1: -68, z0: -72, z1: -8, y: -7 };

function spans(lines, key, lo, hi) {
  const out = []; let cur = lo;
  for (const l of lines) { const a = l[key] - l.w / 2, b = l[key] + l.w / 2; if (a > cur) out.push([cur, a]); cur = b; }
  if (hi > cur) out.push([cur, hi]);
  return out;
}
const xSpans = spans(AVES, "x", AREA.x0, AREA.x1), zSpans = spans(STS, "z", AREA.z0, AREA.z1);

// ---------- textures: one window cell per 16x16 px, 16x16 cells, so a facade repeats it at world scale
function windowTextures() {
  // One window per 16 world px, painted at 4x so that up close — on the stoop, in the doorway — a
  // softened edge stays an edge and not a smear.
  const SC = 4, S = 256 * SC;
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = S; return c; };
  const d = mk(), e = mk(), g = d.getContext("2d"), h = e.getContext("2d");
  g.fillStyle = "#efe3cd"; g.fillRect(0, 0, S, S);
  h.fillStyle = "#000"; h.fillRect(0, 0, S, S);
  g.scale(SC, SC); h.scale(SC, SC);
  for (let cy = 0; cy < 16; cy++) for (let cx = 0; cx < 16; cx++) P.paintWindowCell(g, h, cx * 16, cy * 16, rng, pick);
  g.setTransform(1, 0, 0, 1, 0, 0); P.grain(g, S, 40_000);
  // The edges want to blur into the facade, so filter rather than point-sample.
  const tex = (c) => {
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: tex(d), lit: tex(e) };
}
const WT = windowTextures();
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,214,140,0.9)"); gr.addColorStop(0.5, "rgba(255,190,110,0.35)"); gr.addColorStop(1, "rgba(255,180,100,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------- materials
const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
const FAC = P.FAC;
const TOWER_FAC = [6, 9, 11, 12, 7, 5];
const facMats = FAC.map((c) => lam(c, { map: WT.map, emissive: 0xffffff, emissiveMap: WT.lit, emissiveIntensity: 0 }));
const BASE = P.BASE;
const M = {
  asphalt: lam(BASE.asphalt), glass: new THREE.MeshLambertMaterial({ color: "#7fb3c4", transparent: true, opacity: 0.16, depthWrite: false }),
  sidewalk: lam(BASE.sidewalk), yard: lam(BASE.yard), roof: lam(BASE.roof), roof2: lam(BASE.roof2),
  mark: lam(BASE.mark), yellow: lam(BASE.yellow), bikeLane: lam(BASE.bikeLane), dock: lam("#6d6f75"),
  tile: lam("#efe8d6", { emissive: "#fff3d6", emissiveIntensity: 0.35 }), tileBand: lam("#2f7d4f", { emissive: "#2f7d4f", emissiveIntensity: 0.4 }), platform: lam("#b3ada2", { emissive: "#ffffff", emissiveIntensity: 0.12 }), rail: lam("#3a3532"), trackbed: lam("#4c443d"),
  wood: lam("#8a6a4a"), woodRoof: lam("#6b5038"), stoop: lam("#8c7f72"), door: lam("#3a2a22"),
  pole: lam("#3b3d44"), lampHead: new THREE.MeshBasicMaterial({ color: "#fff0c4" }),
  globe: new THREE.MeshBasicMaterial({ color: "#3fd37a" }), awning: ["#2f6e4f", "#a33a32", "#24486e", "#c08a2c", "#5b3e6e"].map((c) => lam(c)),
};
P.repaint(M);

// ---------- geometry builder: plain arrays merged into a few big meshes (few draw calls)
class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; }
  quad(a, b, c, d, n, ua, ub, uc, ud) {
    for (const [v, uv] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[0], uv[1]); }
  }
  mesh(mat, opts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    const m = new THREE.Mesh(g, mat);
    m.castShadow = !!(opts && opts.cast); m.receiveShadow = true;
    scene.add(m); return m;
  }
}
const Z2 = [0, 0];
function box(acc, x0, x1, y0, y1, z0, z1, o) {
  o = o || {};
  const ou = (o.ou || 0) / 16, ov = (o.ov || 0) / 16, S = CW * 16, F = FH * 16;
  const U = (s) => s / S + ou, V = (y) => y / F + ov;
  const w = x1 - x0, d = z1 - z0;
  if (!o.noSides) {
    acc.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [U(0), V(y0)], [U(w), V(y0)], [U(w), V(y1)], [U(0), V(y1)]);
    acc.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [U(0), V(y0)], [U(w), V(y0)], [U(w), V(y1)], [U(0), V(y1)]);
    acc.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [U(0), V(y0)], [U(d), V(y0)], [U(d), V(y1)], [U(0), V(y1)]);
    acc.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [U(0), V(y0)], [U(d), V(y0)], [U(d), V(y1)], [U(0), V(y1)]);
  }
  if (o.top !== null) (o.top || acc).quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], Z2, Z2, Z2, Z2);
}
function flat(acc, x0, x1, z0, z1, y) { acc.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], Z2, Z2, Z2, Z2); }

const A = { lightStrip: new Acc(), asphalt: new Acc(), glass: new Acc(), sidewalk: new Acc(), yard: new Acc(), roof: new Acc(), roof2: new Acc(), mark: new Acc(), yellow: new Acc(), bike: new Acc(), dock: new Acc(), wood: new Acc(), woodRoof: new Acc(), tile: new Acc(), tileBand: new Acc(), platform: new Acc(), rail: new Acc(), trackbed: new Acc(), pole: new Acc() };
const facAcc = FAC.map(() => new Acc());
const awnAcc = M.awning.map(() => new Acc());

// Road surface: everything at y=0 except the station cutaway under the station's avenue (glass over it).
{
  const T = TRENCH, a = AREA;
  flat(A.asphalt, a.x0, a.x1, a.z0, T.z0, 0);
  flat(A.asphalt, a.x0, a.x1, T.z1, a.z1, 0);
  flat(A.asphalt, a.x0, T.x0, T.z0, T.z1, 0);
  flat(A.asphalt, T.x1, a.x1, T.z0, T.z1, 0);
  flat(A.glass, T.x0, T.x1, T.z0, T.z1, 0.01);
  // the station box: tiled walls (green band), side platforms, two tracks
  const y = T.y;
  A.tile.quad([T.x0, y, T.z0], [T.x0, y, T.z1], [T.x0, 0, T.z1], [T.x0, 0, T.z0], [1, 0, 0], Z2, Z2, Z2, Z2);
  A.tile.quad([T.x1, y, T.z1], [T.x1, y, T.z0], [T.x1, 0, T.z0], [T.x1, 0, T.z1], [-1, 0, 0], Z2, Z2, Z2, Z2);
  A.tile.quad([T.x1, y, T.z0], [T.x0, y, T.z0], [T.x0, 0, T.z0], [T.x1, 0, T.z0], [0, 0, 1], Z2, Z2, Z2, Z2);
  A.tile.quad([T.x0, y, T.z1], [T.x1, y, T.z1], [T.x1, 0, T.z1], [T.x0, 0, T.z1], [0, 0, -1], Z2, Z2, Z2, Z2);
  A.tileBand.quad([T.x0 + 0.02, -3.2, T.z0], [T.x0 + 0.02, -3.2, T.z1], [T.x0 + 0.02, -2.6, T.z1], [T.x0 + 0.02, -2.6, T.z0], [1, 0, 0], Z2, Z2, Z2, Z2);
  A.tileBand.quad([T.x1 - 0.02, -3.2, T.z1], [T.x1 - 0.02, -3.2, T.z0], [T.x1 - 0.02, -2.6, T.z0], [T.x1 - 0.02, -2.6, T.z1], [-1, 0, 0], Z2, Z2, Z2, Z2);
  box(A.platform, T.x0, T.x0 + 4.2, y, y + 1.1, T.z0, T.z1);
  box(A.platform, T.x1 - 4.2, T.x1, y, y + 1.1, T.z0, T.z1);
  flat(A.trackbed, T.x0 + 4.2, T.x1 - 4.2, T.z0, T.z1, y);
  // NYC station detail: green columns along the platform edges, yellow edge strips, light strips overhead.
  for (const px of [T.x0 + 4.4, T.x1 - 4.4]) {
    for (let z = T.z0 + 3; z < T.z1 - 2; z += 4.5) box(A.tileBand, px - 0.18, px + 0.18, y + 1.1, -0.4, z - 0.18, z + 0.18);
    box(A.yellow, px - (px < -80 ? 0.6 : -0.2) - 0.2, px - (px < -80 ? 0.6 : -0.2) + 0.2, y + 1.1, y + 1.13, T.z0, T.z1);
  }
  for (const lx of [T.x0 + 2, T.x1 - 2]) box(A.lightStrip, lx - 0.25, lx + 0.25, -0.7, -0.55, T.z0 + 2, T.z1 - 2);
  for (const tx of [-83, -77]) {
    box(A.rail, tx - 0.85, tx - 0.7, y, y + 0.25, T.z0, T.z1);
    box(A.rail, tx + 0.7, tx + 0.85, y, y + 0.25, T.z0, T.z1);
  }
}

// Lane markings, crosswalks and the 2nd Ave bike lane.
function dashes(axis, fixed, lo, hi, acc, len, gap, wid) {
  for (let s = lo; s < hi; s += len + gap) {
    const e = Math.min(hi, s + len);
    if (axis === "z") flat(acc, fixed - wid / 2, fixed + wid / 2, s, e, 0.03); else flat(acc, s, e, fixed - wid / 2, fixed + wid / 2, 0.03);
  }
}
function between(spansList, fn) { for (const [a, b] of spansList) fn(a, b); }
for (const av of AVES) {
  between(zSpans, (a, b) => {
    if (av.two) { flat(A.yellow, av.x - 0.35, av.x - 0.15, a, b, 0.03); flat(A.yellow, av.x + 0.15, av.x + 0.35, a, b, 0.03); }
    else for (let i = 1; i < 4; i++) dashes("z", av.x - av.w / 2 + 2.4 + i * 3.5 + (av.bike ? 0 : 0), a, b, A.mark, 3, 6, 0.18);
    if (av.bike) flat(A.bike, av.x + av.w / 2 - 2.4, av.x + av.w / 2 - 0.4, a, b, 0.025);
  });
}
for (const st of STS) {
  between(xSpans, (a, b) => {
    if (st.two) { flat(A.yellow, a, b, st.z - 0.35, st.z - 0.15, 0.03); flat(A.yellow, a, b, st.z + 0.15, st.z + 0.35, 0.03); }
  });
}
for (const av of AVES) for (const st of STS) {
  for (const side of [-1, 1]) {
    const cx = av.x + side * (av.w / 2 + 2.2);
    for (let z = st.z - st.w / 2 + 0.6; z < st.z + st.w / 2 - 0.4; z += 1.1) flat(A.mark, cx - 1.5, cx + 1.5, z, z + 0.55, 0.03);
    const cz = st.z + side * (st.w / 2 + 2.2);
    for (let x = av.x - av.w / 2 + 0.6; x < av.x + av.w / 2 - 0.4; x += 1.1) flat(A.mark, x, x + 0.55, cz - 1.5, cz + 1.5, 0.03);
  }
}

// ---------- blocks: sidewalk slab, backyards, buildings along every frontage
const trees = [], lamps = [], towers = [];
const ourBlock = (bx0, bz0) => Math.abs(bx0 - 14) < 0.1 && Math.abs(bz0 - 8) < 0.1;
// The block opposite is not a solid wall of walk-ups: a playground faces the house across the street, so
// the view out of the front windows is a hard court and some trees. Its lot is a gap in that block's row.
const PARK = { x0: HX - 25, x1: HX + 1, z0: -37, z1: -12.5 };
const acrossBlock = (bx0, bz0) => Math.abs(bx0 - 14) < 0.1 && Math.abs(bz0 + 72) < 0.1;
function floorsMid() { const r = rng(); return r < 0.76 ? RI(4, 6) : r < 0.94 ? RI(7, 10) : RI(12, 18); }
function floorsAve() { const r = rng(); return r < 0.45 ? RI(5, 8) : r < 0.8 ? RI(9, 16) : RI(18, 30); }
// Keep the view open (as an illustrator would): low buildings in front of the station and of home.
const CAPS = [
  [-179, -94, -72, 72, 5], [-66, -14, 8, 72, 6], [-66, -14, -72, -8, 7],
  [51, 101, 37, 72, 4], [54, 92, 12, 37, 6], [46, 101, -40, -8, 5],
];
function capAt(x0, x1, z0, z1) {
  let cap = 99;
  for (const [a, b, c, d, f] of CAPS) if (x1 > a && x0 < b && z1 > c && z0 < d) cap = Math.min(cap, f);
  return cap;
}
function building(x0, x1, z0, z1, floors, ave, aveSide) {
  floors = Math.min(floors, capAt(x0, x1, z0, z1));
  const h = floors * FH;
  const ci = floors > 16 ? pick(TOWER_FAC) : RI(0, FAC.length - 1);
  box(facAcc[ci], x0, x1, CURB, h, z0, z1, { top: rng() < 0.6 ? A.roof : A.roof2, ou: RI(0, 15), ov: RI(0, 15) });
  // cornice lip on walk-ups
  if (floors <= 7 && rng() < 0.7) box(A.roof2, x0 - 0.25, x1 + 0.25, h, h + 0.5, z0 - 0.25, z1 + 0.25);
  const w = x1 - x0, d = z1 - z0;
  if (floors >= 5 && floors <= 16 && w > 6 && d > 8 && rng() < 0.42) towers.push([x0 + R(2, w - 2), h, z0 + R(2.5, d - 2.5)]);
  if (floors >= 6 && rng() < 0.55) { const bx = x0 + R(1, Math.max(1.2, w - 4)), bz = z0 + R(1, Math.max(1.2, d - 4)); box(facAcc[9], bx, bx + 3, h, h + 2.8, bz, bz + 3, { top: A.roof }); }
  if (ave && floors < 30 && rng() < 0.55) {
    const ai = RI(0, M.awning.length - 1), y0 = 2.7, y1 = 3.1;
    if (aveSide === "w") box(awnAcc[ai], x0 - 1.6, x0, y0, y1, z0 + 0.6, z1 - 0.6);
    else box(awnAcc[ai], x1, x1 + 1.6, y0, y1, z0 + 0.6, z1 - 0.6);
  }
}
function row(xa, xb, zA, zB, mk) { let x = xa; while (x < xb - 2) { const lw = Math.min(R(6, 13), xb - x); mk(x, x + lw); x += lw; } }
function fillBlock(bx0, bx1, bz0, bz1) {
  box(A.sidewalk, bx0, bx1, 0, CURB, bz0, bz1);
  const x0 = bx0 + SW, x1 = bx1 - SW, z0 = bz0 + SW, z1 = bz1 - SW;
  if (x1 - x0 < 6 || z1 - z0 < 6) return;
  flat(A.yard, x0, x1, z0, z1, CURB + 0.01);
  const Wd = x1 - x0, D = z1 - z0;
  const big = Wd > 60, endW = big ? Math.min(24, Wd * 0.18) : Wd;
  const strips = big ? [[x0, x0 + endW, "w"], [x1 - endW, x1, "e"]] : [[x0, x1, "w"]];
  for (const [sx0, sx1, side] of strips) {
    let z = z0;
    while (z < z1 - 3) { const lw = Math.min(R(9, 18), z1 - z); const inset = rng() < 0.3 ? R(0, 4) : 0; building(side === "w" ? sx0 : sx0 + inset, side === "w" ? sx1 - inset : sx1, z, z + lw, floorsAve(), true, side); z += lw; }
  }
  if (big) {
    const mx0 = x0 + endW, mx1 = x1 - endW, rowD = Math.min(26, D / 2 - 2);
    for (const side of ["n", "s"]) {
      const mk = (a, b) => {
        const dd = rowD * R(0.78, 1);
        building(a, b, side === "n" ? z0 : z1 - dd, side === "n" ? z0 + dd : z1, floorsMid(), false);
      };
      if (side === "n" && ourBlock(bx0, bz0)) { row(mx0, HOME.x0, 0, 0, mk); row(HOME.x1, mx1, 0, 0, mk); }
      else if (side === "s" && acrossBlock(bx0, bz0)) { row(mx0, PARK.x0, 0, 0, mk); row(PARK.x1, mx1, 0, 0, mk); }
      else row(mx0, mx1, 0, 0, mk);
    }
  }
  // street trees on the side-street sidewalks; a few on the avenues
  for (const tz of [bz0 + 1.4, bz1 - 1.4]) for (let x = bx0 + 9; x < bx1 - 9; x += R(8, 11)) if (rng() < 0.82 && !(ourBlock(bx0, bz0) && tz < bz0 + 3 && x > HX - 3.5 && x < HX + 3.5)) trees.push([x, tz]);
  for (const tx of [bx0 + 1.4, bx1 - 1.4]) for (let z = bz0 + 10; z < bz1 - 10; z += R(13, 17)) if (rng() < 0.45) trees.push([tx, z]);
  // street lights at the corners and along the curbs
  for (const [lx, lz] of [[bx0 + 0.6, bz0 + 0.6], [bx1 - 0.6, bz0 + 0.6], [bx0 + 0.6, bz1 - 0.6], [bx1 - 0.6, bz1 - 0.6]]) lamps.push([lx, lz]);
  for (let x = bx0 + 30; x < bx1 - 20; x += 32) { lamps.push([x, bz0 + 0.6]); lamps.push([x, bz1 - 0.6]); }
}
for (const [bx0, bx1] of xSpans) for (const [bz0, bz1] of zSpans) fillBlock(bx0, bx1, bz0, bz1);

// The playground itself: grass, a hard court painted on it, a chain-link line along the street and a few
// trees at the back. No building, which is the point — it is the gap in the block the house looks into.
{
  const p = PARK, court = new Acc();
  flat(A.yard, p.x0, p.x1, p.z0, p.z1, CURB + 0.02);
  flat(court, p.x0 + 2.5, p.x1 - 2.5, p.z0 + 3.5, p.z1 - 3, CURB + 0.04);
  court.mesh(lam("#4a7a5c"));
  for (let x = p.x0; x < p.x1 + 0.01; x += 2.4) box(A.pole, x - 0.07, x + 0.07, CURB, CURB + 1.7, p.z1 - 0.07, p.z1 + 0.07);
  box(A.pole, p.x0 - 0.07, p.x1 + 0.07, CURB + 1.6, CURB + 1.7, p.z1 - 0.05, p.z1 + 0.05);
  for (const tx of [p.x0 + 2, HX - 12, p.x1 - 2]) trees.push([tx, p.z0 + 1.8]);
}

// Subway entrances: stair kiosks with the green globes, at both ends of the station.
const kiosks = [[-97.5, -74], [-62.5, -74], [-97.5, -14], [-62.5, -14]];
for (const [kx, kz] of kiosks) {
  box(A.pole, kx - 1.2, kx + 1.2, CURB, CURB + 1.1, kz - 2.2, kz + 2.2, { top: A.dock });
  box(A.pole, kx - 0.08, kx + 0.08, CURB, CURB + 3, kz - 2.3, kz - 2.14);
}

// ---------- our building: separate meshes so it can open up when the camera flies in
const homeMat = lam("#e8c98f", { map: WT.map });
const homeAcc = new Acc(), homeRoofAcc = new Acc();
box(homeAcc, HOME.x0, HOME.x1, CURB, HOME.floors * FH, HOME.z0, HOME.z1, { top: homeRoofAcc, ou: 3, ov: 0 });
box(homeRoofAcc, HOME.x0 - 0.3, HOME.x1 + 0.3, HOME.floors * FH, HOME.floors * FH + 0.6, HOME.z0 - 0.3, HOME.z1 + 0.3);
const homeMesh = homeAcc.mesh(homeMat, { cast: true });
const homeRoofMat = lam("#c0643f");
const homeRoof = homeRoofAcc.mesh(homeRoofMat, { cast: true });
// stoop and door on the street
{
  const sx = HX, z = HOME.z0;
  const st = new Acc();
  for (let i = 0; i < 4; i++) box(st, sx - 1.5, sx + 1.5, CURB, CURB + 0.3 * (i + 1), z - 2.4 + i * 0.6, z);
  st.mesh(M.stoop, { cast: true });
  const dr = new Acc(); box(dr, sx - 0.8, sx + 0.8, CURB + 1.2, CURB + 3.6, z - 0.06, z + 0.02); dr.mesh(M.door);
}
// lit windows of the apartment: back (camera side) = the two bedrooms, front (street) = living room
const homeWin = [];
{
  const y0 = (HOME.floor - 1) * FH + CURB + 0.9, y1 = y0 + 1.9;
  const mk = (x, z, room, facing) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, y1 - y0), new THREE.MeshBasicMaterial({ color: "#3b4553" }));
    m.position.set(x, (y0 + y1) / 2, z); if (facing < 0) m.rotation.y = Math.PI;
    scene.add(m); homeWin.push({ m, room });
  };
  for (const [dx, room] of [[-4.5, "bed1"], [-1.7, "bed1"], [1.8, "bed2"], [4.6, "bed2"]]) mk(HX + dx, HOME.z1 + 0.04, room, 1);
  for (const dx of [-4.2, 0, 4.2]) mk(HX + dx, HOME.z0 - 0.04, "living", -1);
}

// meshes from the accumulators
facAcc.forEach((a, i) => a.p.length && a.mesh(facMats[i], { cast: true }));
awnAcc.forEach((a, i) => a.p.length && a.mesh(M.awning[i]));
A.asphalt.mesh(M.asphalt); A.sidewalk.mesh(M.sidewalk, { cast: false }); A.yard.mesh(M.yard);
A.roof.mesh(M.roof); A.roof2.mesh(M.roof2, { cast: true }); A.mark.mesh(M.mark); A.yellow.mesh(M.yellow); A.bike.mesh(M.bikeLane);
A.tile.mesh(M.tile); A.tileBand.mesh(M.tileBand); A.platform.mesh(M.platform); A.rail.mesh(M.rail); A.trackbed.mesh(M.trackbed);
A.pole.mesh(M.pole, { cast: true });
A.lightStrip.mesh(new THREE.MeshBasicMaterial({ color: "#fff6dc" }));
const glassMesh = A.glass.mesh(M.glass); glassMesh.renderOrder = 2; glassMesh.receiveShadow = false;

// ---------- instanced props: water towers, trees, street lights
const dummy = new THREE.Object3D();
function inst(geo, mat, n, cast) { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.castShadow = !!cast; m.receiveShadow = true; scene.add(m); return m; }
{
  const tank = inst(new THREE.CylinderGeometry(1.7, 1.7, 3.2, 8), M.wood, towers.length, true);
  const cone = inst(new THREE.ConeGeometry(1.95, 1.4, 8), M.woodRoof, towers.length, true);
  const legs = inst(new THREE.BoxGeometry(2.6, 2.2, 2.6), M.pole, towers.length, true);
  towers.forEach(([x, y, z], i) => {
    dummy.position.set(x, y + 1.1, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); legs.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + 3.8, z); dummy.updateMatrix(); tank.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + 6.1, z); dummy.updateMatrix(); cone.setMatrixAt(i, dummy.matrix);
  });
  legs.material = new THREE.MeshLambertMaterial({ color: "#3b3d44", transparent: true, opacity: 0.85 });
}
const canopyMat = lam(BASE.canopy);
const trunkM = inst(new THREE.CylinderGeometry(0.22, 0.28, 2.6, 5), lam(BASE.trunk), trees.length, true);
const canopyM = inst(new THREE.IcosahedronGeometry(2.3, 0), canopyMat, trees.length, true);
const treeData = trees.map(([x, z], i) => {
  const s = R(0.8, 1.25), ph = R(0, 6.28);
  dummy.position.set(x, CURB + 1.3, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); trunkM.setMatrixAt(i, dummy.matrix);
  canopyM.setColorAt(i, new THREE.Color().setHSL(R(0.24, 0.31), R(0.35, 0.5), R(0.27, 0.36)));
  return { x, z, s, ph };
});
if (canopyM.instanceColor) canopyM.instanceColor.needsUpdate = true;
const poleM = inst(new THREE.BoxGeometry(0.18, 5.2, 0.18), M.pole, lamps.length, false);
const headM = inst(new THREE.BoxGeometry(0.7, 0.25, 0.7), M.lampHead, lamps.length, false);
const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
const glowM = inst(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), glowMat, lamps.length, false);
glowM.renderOrder = 3; glowM.receiveShadow = false;
lamps.forEach(([x, z], i) => {
  dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
  dummy.position.set(x, CURB + 2.6, z); dummy.updateMatrix(); poleM.setMatrixAt(i, dummy.matrix);
  dummy.position.set(x, CURB + 5.2, z); dummy.updateMatrix(); headM.setMatrixAt(i, dummy.matrix);
  dummy.position.set(x, 0.06, z); dummy.updateMatrix(); glowM.setMatrixAt(i, dummy.matrix);
});
// green globes by the subway stairs
{
  const g = inst(new THREE.SphereGeometry(0.45, 6, 4), M.globe, kiosks.length, false);
  kiosks.forEach(([x, z], i) => { dummy.position.set(x, CURB + 3.2, z - 2.22); dummy.updateMatrix(); g.setMatrixAt(i, dummy.matrix); });
}

// ---------- traffic
const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const CAR_TYPES = [
  { k: "sedan", len: 4.6, wid: 1.85, h: 0.85, cab: 2.3, ch: 0.62, w: 30 },
  { k: "suv", len: 4.9, wid: 1.95, h: 1.05, cab: 2.8, ch: 0.68, w: 18 },
  { k: "taxi", len: 4.7, wid: 1.85, h: 0.85, cab: 2.3, ch: 0.62, w: 26 },
  { k: "van", len: 6.2, wid: 2.1, h: 2.3, cab: 0, ch: 0, w: 8 },
  { k: "bus", len: 12, wid: 2.55, h: 2.9, cab: 0, ch: 0, w: 0 },
];
const CAR_COLORS = ["#e9ebee", "#1e1f24", "#9aa0a8", "#7b1f24", "#25426e", "#5b5f66", "#2f4a3a", "#c7c2b6"];
function carType() { let t = rng() * 82; for (const c of CAR_TYPES) { if ((t -= c.w) < 0) return c; } return CAR_TYPES[0]; }
function carColor(t) { return t.k === "taxi" ? "#f2c230" : t.k === "van" ? pick(["#f1f1ee", "#e9e6dc", "#a9b0b8"]) : t.k === "bus" ? "#e6eaee" : pick(CAR_COLORS); }

const lanes = [];
function addLane(axis, fixed, dir, avenue, ref) {
  const lo = axis === "z" ? AREA.z0 : AREA.x0, hi = axis === "z" ? AREA.z1 : AREA.x1;
  const lane = { axis, fixed, dir, lo, hi, L: hi - lo, cars: [], stops: [], avenue };
  const cross = axis === "z" ? STS.map((s) => [s.z, s.w]) : AVES.map((a) => [a.x, a.w]);
  for (const [c, w] of cross) {
    const front = dir > 0 ? c - w / 2 - 1.2 - lo : hi - (c + w / 2 + 1.2);
    if (front > 0 && front < lane.L) lane.stops.push(front);
  }
  lane.stops.sort((a, b) => a - b);
  lanes.push(lane); return lane;
}
for (const av of AVES) {
  if (av.two) { for (const i of [0, 1]) { addLane("z", av.x - 1.9 - i * 3.5, 1, true); addLane("z", av.x + 1.9 + i * 3.5, -1, true); } }
  else { const n = av.bike ? 3 : 4; for (let i = 0; i < n; i++) addLane("z", av.x - av.w / 2 + 4.2 + i * 3.5, av.dir, true); }
}
for (const st of STS) {
  if (st.two) { for (const i of [0, 1]) { addLane("x", st.z - 1.9 - i * 3.5, -1, false); addLane("x", st.z + 1.9 + i * 3.5, 1, false); } }
  else addLane("x", st.z + (st.dir > 0 ? 1.2 : -1.2), st.dir, false);
}
const moving = [];
for (const lane of lanes) {
  const density = lane.avenue ? 26 : 42;
  for (let s = R(0, 12); s < lane.L - 6; s += R(density * 0.6, density * 1.5)) {
    let t = carType(); if (lane.avenue && rng() < 0.04) t = CAR_TYPES[4];
    const car = { lane, t, s, v: R(6, 10), vmax: R(9, 12.5), color: carColor(t) };
    lane.cars.push(car); moving.push(car);
  }
  lane.cars.sort((a, b) => b.s - a.s);
}
// parked cars along side-street curbs (a NYC block is lined with them)
const parked = [];
for (const st of STS) {
  if (st.two) continue;
  between(xSpans, (a, b) => {
    for (const side of [-1, 1]) {
      const z = st.z + side * (st.w / 2 - 1.25);
      for (let x = a + 7; x < b - 8; x += R(5.3, 7.5)) {
        if (rng() < 0.18) continue;
        if (side > 0 && st.z === 80 && x > 16 && x < 48) continue; // the west Citi Bike dock
        if (side > 0 && st.z === 0 && x > 34 && x < 58) continue; // the curb in front of home stays clear
        const t = rng() < 0.15 ? CAR_TYPES[3] : rng() < 0.4 ? CAR_TYPES[1] : CAR_TYPES[0];
        parked.push({ x, z, axis: "x", dir: 1, t, color: carColor(t) });
      }
    }
  });
}
for (const av of AVES) {
  if (av.two) continue;
  between(zSpans, (a, b) => {
    const x = av.x - av.w / 2 + 1.25;
    for (let z = a + 8; z < b - 8; z += R(5.6, 8)) {
      if (rng() < 0.3) continue;
      if (av.x === 200 && z > 43 && z < 73) continue; // Citi Bike dock on 2nd Ave
      const t = rng() < 0.2 ? CAR_TYPES[3] : CAR_TYPES[0];
      parked.push({ x, z, axis: "z", dir: 1, t, color: carColor(t) });
    }
  });
}
const NCARS = moving.length + parked.length;
const carMat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
const bodyM = inst(unit, carMat, NCARS, true);
const cabM = inst(unit, new THREE.MeshLambertMaterial({ color: "#ffffff" }), NCARS, true);
const headMat = new THREE.MeshBasicMaterial({ color: "#fff3c9" }), tailMat = new THREE.MeshBasicMaterial({ color: "#d8352f" });
const hlM = inst(unit, headMat, NCARS, false), tlM = inst(unit, tailMat, NCARS, false);
const tmpC = new THREE.Color();
[...moving, ...parked].forEach((c, i) => {
  bodyM.setColorAt(i, tmpC.set(c.color));
  cabM.setColorAt(i, tmpC.set(c.t.k === "taxi" ? "#2a2c33" : "#2c3440"));
  c.i = i;
});
bodyM.instanceColor.needsUpdate = true; cabM.instanceColor.needsUpdate = true;
const fwd = new THREE.Vector3(), pos = new THREE.Vector3();
function placeCar(c, x, z, axis, dir) {
  const t = c.t, i = c.i;
  const yaw = axis === "x" ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  fwd.set(Math.cos(yaw), 0, -Math.sin(yaw));
  dummy.rotation.set(0, yaw, 0);
  dummy.position.set(x, 0.32, z); dummy.scale.set(t.len, t.h, t.wid); dummy.updateMatrix(); bodyM.setMatrixAt(i, dummy.matrix);
  if (t.cab) { dummy.position.set(x - fwd.x * 0.25, 0.32 + t.h, z - fwd.z * 0.25); dummy.scale.set(t.cab, t.ch, t.wid * 0.92); }
  else { dummy.position.set(x + fwd.x * (t.len / 2 - 0.9), 0.32 + t.h * 0.55, z + fwd.z * (t.len / 2 - 0.9)); dummy.scale.set(1.0, t.h * 0.35, t.wid * 1.01); }
  dummy.updateMatrix(); cabM.setMatrixAt(i, dummy.matrix);
  dummy.position.set(x + fwd.x * (t.len / 2 + 0.02), 0.55, z + fwd.z * (t.len / 2 + 0.02)); dummy.scale.set(0.08, 0.22, t.wid * 0.8); dummy.updateMatrix(); hlM.setMatrixAt(i, dummy.matrix);
  dummy.position.set(x - fwd.x * (t.len / 2 + 0.02), 0.6, z - fwd.z * (t.len / 2 + 0.02)); dummy.updateMatrix(); tlM.setMatrixAt(i, dummy.matrix);
}
parked.forEach((c) => placeCar(c, c.x, c.z, c.axis, c.dir));
function signalGreen(avenue, t) { const p = t % 64; return avenue ? p < 34 : p >= 37 && p < 61; }
function updateTraffic(dt, t, weatherSlow) {
  for (const lane of lanes) {
    const green = signalGreen(lane.avenue, t);
    const cars = lane.cars;
    for (let k = 0; k < cars.length; k++) {
      const c = cars[k];
      let target = c.vmax * weatherSlow;
      if (k > 0) { const ahead = cars[k - 1]; const gap = ahead.s - c.s - (ahead.t.len + c.t.len) / 2; if (gap < 2.5) target = 0; else if (gap < 14) target = Math.min(target, (gap - 2.5) * 0.9); }
      if (!green) {
        const front = c.s + c.t.len / 2;
        for (const stop of lane.stops) { const d = stop - front; if (d > -0.5 && d < 28) { if (d < 1.2 && c.v > 6) break; target = Math.min(target, Math.max(0, d - 0.3) * 0.7); break; } }
      }
      const dv = target - c.v; c.v += clamp(dv, -9 * dt, 2.6 * dt); if (c.v < 0) c.v = 0;
      c.s += c.v * dt;
    }
    // wrap the front car to the back of its lane
    while (cars.length && cars[0].s > lane.L + 6) { const c = cars.shift(); c.s -= lane.L + 12; c.v = c.vmax * 0.8; cars.push(c); }
    for (const c of cars) {
      const p = lane.dir > 0 ? lane.lo + c.s : lane.hi - c.s;
      if (lane.axis === "z") placeCar(c, lane.fixed, p, "z", lane.dir); else placeCar(c, p, lane.fixed, "x", lane.dir);
    }
  }
  bodyM.instanceMatrix.needsUpdate = cabM.instanceMatrix.needsUpdate = hlM.instanceMatrix.needsUpdate = tlM.instanceMatrix.needsUpdate = true;
}

// ---------- people on the sidewalks (and a few on Citi Bikes in the 2nd Ave lane)
const walkers = [];
const VIEW = { x0: -150, x1: 280, z0: -170, z1: 200 };
for (const [bx0, bx1] of xSpans) for (const [bz0, bz1] of zSpans) {
  if (bx1 < VIEW.x0 || bx0 > VIEW.x1 || bz1 < VIEW.z0 || bz0 > VIEW.z1) continue;
  const near = ourBlock(bx0, bz0) ? 26 : 12;
  const loop = { x0: bx0 + 2.4, x1: bx1 - 2.4, z0: bz0 + 2.4, z1: bz1 - 2.4 };
  const L = 2 * (loop.x1 - loop.x0) + 2 * (loop.z1 - loop.z0);
  const n = Math.round(near * L / 400);
  for (let i = 0; i < n; i++) walkers.push({ loop, L, s: R(0, L), dir: rng() < 0.5 ? 1 : -1, v: R(1.1, 1.6), off: R(-0.9, 0.9), ph: R(0, 6.3), umb: rng() < 0.72 });
}
const riders = [];
for (let i = 0; i < 7; i++) riders.push({ s: R(0, AREA.z1 - AREA.z0), v: R(4.5, 6.5), e: rng() < 0.45 });
const NP = walkers.length + riders.length;
const bodyP = inst(new THREE.BoxGeometry(0.55, 1.0, 0.38).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: "#fff" }), NP, true);
const headP = inst(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshLambertMaterial({ color: "#fff" }), NP, false);
const umbP = inst(new THREE.ConeGeometry(0.75, 0.35, 6), new THREE.MeshLambertMaterial({ color: "#fff" }), NP, true);
const COATS = ["#2b2f3a", "#6b2f2f", "#3f5a7a", "#c9a24a", "#4a6b45", "#8a8f99", "#d8d2c4", "#a3542f", "#253050", "#7a5a8a"];
const SKIN = ["#f1c9a5", "#d9a77c", "#b07a52", "#7d5236", "#e8b48f"];
const UMB = ["#1f1f24", "#b0322d", "#2a5ba8", "#e0b23a", "#2f7a52", "#efe9dc"];
for (let i = 0; i < NP; i++) { bodyP.setColorAt(i, tmpC.set(pick(COATS))); headP.setColorAt(i, tmpC.set(pick(SKIN))); umbP.setColorAt(i, tmpC.set(pick(UMB))); }
riders.forEach((r, k) => bodyP.setColorAt(walkers.length + k, tmpC.set(pick(COATS))));
bodyP.instanceColor.needsUpdate = headP.instanceColor.needsUpdate = umbP.instanceColor.needsUpdate = true;

// Citi Bike docks and the bikes in them. The west one stands in the parking lane of the street south of
// home, a block further west than the house — one avenue over, where the real one is. The east one is on
// the next avenue. Both sit inside the kerb, in the roadbed, the way the city actually docks them.
const DOCKS = [
  { name: NAMES.docks[0].name, side: NAMES.docks[0].side, slots: 26, ebikes: 10, classic: 12, axis: "x", x0: -60.5, fixed: 74.2, anchor: [-47, 22, 74] },
  { name: NAMES.docks[1].name, side: NAMES.docks[1].side, slots: 26, ebikes: 10, classic: 1, axis: "z", x0: 44.5, fixed: 187.6, anchor: [188, 4, 58] },
];
const bikeFrames = [];
for (const d of DOCKS) {
  for (let i = 0; i < d.slots; i++) {
    const s = d.x0 + i * 1.05;
    const [x, z] = d.axis === "x" ? [s, d.fixed] : [d.fixed, s];
    box(A.dock, x - 0.08, x + 0.08, 0, 1.0, z - 0.08, z + 0.08);
    bikeFrames.push({ dock: d, i, x, z });
  }
  const [bx0, bz0] = d.axis === "x" ? [d.x0 - 1, d.fixed - 0.6] : [d.fixed - 0.6, d.x0 - 1];
  const [bx1, bz1] = d.axis === "x" ? [d.x0 + d.slots * 1.05, d.fixed + 0.6] : [d.fixed + 0.6, d.x0 + d.slots * 1.05];
  box(A.dock, bx0, bx1, 0, 0.12, bz0, bz1);
}
A.dock.mesh(M.dock, { cast: true });
const NB = bikeFrames.length + riders.length;
// A bike: a colored frame (blue classic, white e-bike) on two black wheels; it reads up close too.
const bikeM = inst(new THREE.BoxGeometry(1.25, 0.34, 0.14).translate(0, 0.6, 0), new THREE.MeshLambertMaterial({ color: "#fff" }), NB, true);
const seatM = inst(new THREE.BoxGeometry(0.34, 0.1, 0.22).translate(-0.32, 0.86, 0), lam("#24242a"), NB, false);
const wheelM = inst(new THREE.CylinderGeometry(0.34, 0.34, 0.07, 10).rotateX(Math.PI / 2), lam("#1c1c22"), NB * 2, true);
function placeBikeAt(k, x, y, z, yaw, sc) {
  dummy.rotation.set(0, yaw, 0); dummy.scale.set(sc, sc, sc);
  dummy.position.set(x, y, z); dummy.updateMatrix(); bikeM.setMatrixAt(k, dummy.matrix); seatM.setMatrixAt(k, dummy.matrix);
  const cx = Math.cos(yaw), cz = -Math.sin(yaw);
  for (const [j, o] of [[0, 0.58], [1, -0.58]]) { dummy.position.set(x + cx * o * sc, y + 0.34 * sc, z + cz * o * sc); dummy.updateMatrix(); wheelM.setMatrixAt(k * 2 + j, dummy.matrix); }
}
const BIKE_BLUE = "#1d64c4", EBIKE = "#e6ebf1";
function layoutDock(d, popIndex) {
  const n = Math.min(d.slots, d.ebikes + d.classic);
  bikeFrames.filter((b) => b.dock === d).forEach((b) => {
    const k = bikeFrames.indexOf(b);
    const has = b.i < n;
    bikeM.setColorAt(k, tmpC.set(b.i < d.ebikes ? EBIKE : BIKE_BLUE));
    b.has = has; if (b.i === popIndex) b.pop = 1;
    placeBike(k, b, 0);
  });
  bikeM.instanceColor.needsUpdate = true;
}
function placeBike(k, b, t) {
  const yaw = b.dock.axis === "x" ? Math.PI / 2 : 0;
  const lift = b.pop ? Math.max(0, b.pop) * 2.2 : 0;
  placeBikeAt(k, b.x, lift, b.z, yaw, b.has ? 1 : 0.0001);
}
DOCKS.forEach((d) => layoutDock(d));
riders.forEach((r, k) => bikeM.setColorAt(bikeFrames.length + k, tmpC.set(r.e ? EBIKE : BIKE_BLUE)));
bikeM.instanceColor.needsUpdate = true;

function walkerPos(w, out) {
  const { loop } = w; const a = loop.x1 - loop.x0, b = loop.z1 - loop.z0;
  let s = ((w.s % w.L) + w.L) % w.L, x, z, yaw;
  if (s < a) { x = loop.x0 + s; z = loop.z0 - w.off; yaw = 0; }
  else if ((s -= a) < b) { x = loop.x1 + w.off; z = loop.z0 + s; yaw = -Math.PI / 2; }
  else if ((s -= b) < a) { x = loop.x1 - s; z = loop.z1 + w.off; yaw = Math.PI; }
  else { s -= a; x = loop.x0 - w.off; z = loop.z1 - s; yaw = Math.PI / 2; }
  if (w.dir < 0) yaw += Math.PI;
  out.x = x; out.z = z; out.yaw = yaw;
}
const wp = { x: 0, z: 0, yaw: 0 };
function updatePeople(dt, t, wx) {
  const rain = wx === "rain", snow = wx === "snow", wind = wx === "wind";
  const speed = snow ? 0.75 : rain ? 1.15 : 1;
  walkers.forEach((w, i) => {
    w.s += w.dir * w.v * speed * dt * 1.4;
    walkerPos(w, wp);
    const bob = Math.abs(Math.sin(t * 7 + w.ph)) * 0.08;
    const lean = wind ? 0.18 : 0;
    dummy.rotation.set(0, wp.yaw, 0); dummy.rotation.z = lean;
    dummy.position.set(wp.x, CURB + bob, wp.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bodyP.setMatrixAt(i, dummy.matrix);
    dummy.position.set(wp.x, CURB + 1.2 + bob, wp.z); dummy.updateMatrix(); headP.setMatrixAt(i, dummy.matrix);
    const u = rain && w.umb ? 1 : 0.0001;
    dummy.position.set(wp.x, CURB + 2.05 + bob, wp.z); dummy.scale.set(u, u, u); dummy.updateMatrix(); umbP.setMatrixAt(i, dummy.matrix);
  });
  const lane = AVES[3], x = lane.x + lane.w / 2 - 1.4;
  riders.forEach((r, k) => {
    r.s += r.v * speed * dt; if (r.s > AREA.z1 - AREA.z0) r.s -= AREA.z1 - AREA.z0;
    const z = AREA.z0 + r.s, i = walkers.length + k;
    dummy.rotation.set(0, -Math.PI / 2, 0); dummy.scale.set(1, 1, 1);
    placeBikeAt(bikeFrames.length + k, x, 0, z, -Math.PI / 2, 1);
    dummy.rotation.set(0, -Math.PI / 2, 0); dummy.scale.set(1, 1, 1);
    dummy.position.set(x, 0.55, z - 0.1); dummy.scale.set(1, 0.85, 1); dummy.updateMatrix(); bodyP.setMatrixAt(i, dummy.matrix);
    dummy.scale.set(1, 1, 1); dummy.position.set(x, 1.6, z - 0.1); dummy.updateMatrix(); headP.setMatrixAt(i, dummy.matrix);
    dummy.scale.set(0.0001, 0.0001, 0.0001); dummy.updateMatrix(); umbP.setMatrixAt(i, dummy.matrix);
  });
  bodyP.instanceMatrix.needsUpdate = headP.instanceMatrix.needsUpdate = umbP.instanceMatrix.needsUpdate = true;
}

// ---------- the train (4 cars, squeezed) in the station cutaway
const trainMat = lam("#d9dce0", { emissive: "#ffffff", emissiveIntensity: 0.12 }), bandMat = new THREE.MeshLambertMaterial({ color: "#2b3038", emissive: "#fff1c8", emissiveIntensity: 0 });
function makeTrain(x) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.3, 14.2), trainMat); car.position.set(0, 1.85, i * 14.8); g.add(car);
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.86, 0.9, 13.4), bandMat); band.position.set(0, 2.5, i * 14.8); g.add(band);
  }
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#00933c" }));
  g.add(b); g.userData.bullet = b;
  g.position.set(x, TRENCH.y + 0.2, 0); scene.add(g); return g;
}
const STOP_C = (TRENCH.z0 + TRENCH.z1) / 2, MID = 22.2;
const trains = {
  down: { g: makeTrain(-83), dir: 1, next: 4 * 60 + 12 },
  up: { g: makeTrain(-77), dir: -1, next: 2 * 60 + 5 },
};
trains.down.g.userData.bullet.position.set(0, 2.5, 3 * 14.8 + 7.15);
trains.up.g.userData.bullet.position.set(0, 2.5, -7.15);
const DWELL = 40, APPROACH = 22;
function placeTrain(tr, now) {
  const s = tr.next - now;
  if (-s > DWELL + 30) { tr.next = tr.queued != null ? tr.queued : liveTrains ? now + 9999 : now + R(4, 8) * 60; tr.queued = null; }
  let off;
  if (s > APPROACH) off = 420; else if (s > 0) off = 0.6 * s * s; else if (-s < DWELL) off = 0; else { const u = -s - DWELL; off = -Math.min(420, 0.65 * u * u); }
  // off > 0: still coming, off < 0: gone past; downtown comes from the north (smaller z)
  const center = tr.dir > 0 ? STOP_C - off : STOP_C + off;
  tr.g.position.z = center - MID;
  tr.g.visible = Math.abs(off) < 300;
}

// ---------- weather particles
const wxGroup = new THREE.Group(); scene.add(wxGroup);
const RAIN_N = 2600, SNOW_N = 2400, LEAF_N = 500;
const rainPos = new Float32Array(RAIN_N * 6), rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: "#b9cbe0", transparent: true, opacity: 0.55 }));
const snowPos = new Float32Array(SNOW_N * 3), snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: "#ffffff", size: 2, sizeAttenuation: false }));
const leafPos = new Float32Array(LEAF_N * 3), leafGeo = new THREE.BufferGeometry();
leafGeo.setAttribute("position", new THREE.BufferAttribute(leafPos, 3));
const leaves = new THREE.Points(leafGeo, new THREE.PointsMaterial({ color: "#c97a2e", size: 2, sizeAttenuation: false }));
wxGroup.add(rain, snow, leaves);
const scenery = P.createScenery(scene, AREA);
const BOX = { x0: -140, x1: 260, z0: -160, z1: 190, y: 90 };
const rnd = (a, b) => a + Math.random() * (b - a);
for (let i = 0; i < RAIN_N; i++) { const x = rnd(BOX.x0, BOX.x1), y = rnd(0, BOX.y), z = rnd(BOX.z0, BOX.z1); rainPos.set([x, y, z, x + 0.4, y + 2.2, z - 0.2], i * 6); }
for (let i = 0; i < SNOW_N; i++) snowPos.set([rnd(BOX.x0, BOX.x1), rnd(0, BOX.y), rnd(BOX.z0, BOX.z1)], i * 3);
for (let i = 0; i < LEAF_N; i++) leafPos.set([rnd(BOX.x0, BOX.x1), rnd(0, 30), rnd(BOX.z0, BOX.z1)], i * 3);
function updateWeather(dt, t, wx) {
  rain.visible = wx === "rain"; snow.visible = wx === "snow"; leaves.visible = wx === "wind";
  if (rain.visible) {
    for (let i = 0; i < RAIN_N; i++) {
      const o = i * 6; let y = rainPos[o + 1] - 70 * dt;
      if (y < 0) { y += BOX.y; const x = rnd(BOX.x0, BOX.x1), z = rnd(BOX.z0, BOX.z1); rainPos[o] = x; rainPos[o + 2] = z; rainPos[o + 3] = x + 0.4; rainPos[o + 5] = z - 0.2; }
      rainPos[o + 1] = y; rainPos[o + 4] = y + 2.2;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  if (snow.visible) {
    for (let i = 0; i < SNOW_N; i++) {
      const o = i * 3; snowPos[o + 1] -= 4.5 * dt; snowPos[o] += Math.sin(t * 0.8 + i) * 0.6 * dt;
      if (snowPos[o + 1] < 0) { snowPos[o + 1] += BOX.y; snowPos[o] = rnd(BOX.x0, BOX.x1); snowPos[o + 2] = rnd(BOX.z0, BOX.z1); }
    }
    snowGeo.attributes.position.needsUpdate = true;
  }
  if (leaves.visible) {
    for (let i = 0; i < LEAF_N; i++) {
      const o = i * 3; leafPos[o] += (18 + (i % 7)) * dt; leafPos[o + 1] += Math.sin(t * 3 + i) * 2.5 * dt - 0.6 * dt; leafPos[o + 2] += Math.cos(t * 2 + i) * 1.5 * dt;
      if (leafPos[o] > BOX.x1 || leafPos[o + 1] < 0) { leafPos[o] = BOX.x0; leafPos[o + 1] = rnd(2, 30); leafPos[o + 2] = rnd(BOX.z0, BOX.z1); }
    }
    leafGeo.attributes.position.needsUpdate = true;
  }
}

// ---------- light: sun / moon, sky, window glow
const hemi = new THREE.HemisphereLight("#cfe6ff", "#6b5a48", 0.62); scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff3dc", 0.85);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 1400 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
const LOOKS = P.LOOKS;
let look = null, todMode = "auto", wx = "clear", snowCover = 0;
function nycHour() { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()); return parseInt(p, 10); }
function currentTod() { if (todMode !== "auto") return todMode; const h = nycHour(); return h >= 7 && h < 17 ? "day" : (h >= 17 && h < 19) || h === 6 ? "dusk" : "night"; }
const target = new THREE.Vector3(38, 0, 0);
function applyLook() {
  const tod = currentTod(), L = LOOKS[tod];
  const wet = wx === "rain" || wx === "snow";
  const dim = wet ? 0.72 : 1;
  scene.background = P.skyTexture(tod, wet);
  hemi.color.set(L.hemiSky); hemi.groundColor.set(L.hemiGround); hemi.intensity = L.hemiI * (wet ? 0.92 : 1) * PI;
  sun.color.set(L.sun); sun.intensity = L.sunI * (wet ? 0.35 : 1) * dim * PI;
  const az = L.az * Math.PI / 180, el = L.el * Math.PI / 180;
  sun.position.set(target.x + Math.sin(az) * Math.cos(el) * 600, Math.sin(el) * 600, target.z + Math.cos(az) * Math.cos(el) * 600);
  sun.target.position.copy(target);
  facMats.forEach((m) => { m.emissiveIntensity = L.win * 0.9; });
  bandMat.emissiveIntensity = L.win * 0.6;
  glowMat.opacity = L.lamp * 0.8;
  M.lampHead.color.set(L.lamp > 0 ? "#fff0c4" : "#c9c4b8");
  headMat.color.set(L.lamp > 0 ? "#fff3c9" : "#d9d6cc");
  M.asphalt.color.set(BASE.asphalt).multiplyScalar(wx === "rain" ? 0.72 : 1);
  look = L;
  updateHomeWindows();
}
function updateSnowCover(dt) {
  snowCover = clamp(snowCover + (wx === "snow" ? 0.05 : -0.08) * dt, 0, 1);
  const white = new THREE.Color("#f4f6f8");
  M.roof.color.set(BASE.roof).lerp(white, snowCover * 0.9);
  M.roof2.color.set(BASE.roof2).lerp(white, snowCover * 0.9);
  M.sidewalk.color.set(BASE.sidewalk).lerp(white, snowCover * 0.75);
  M.yard.color.set(BASE.yard).lerp(white, snowCover * 0.95);
  canopyMat.color.set(BASE.canopy).lerp(new THREE.Color("#ffffff"), 0).multiplyScalar(1 + snowCover * 0.6);
  if (wx !== "rain") M.asphalt.color.set(BASE.asphalt).lerp(new THREE.Color("#8b8f96"), snowCover * 0.35);
}

// ---------- the apartment, as a dollhouse (shown after the camera goes through the door)
const HOUSE = new THREE.Vector3(1500, 0, 0);
const house = new THREE.Group(); house.position.copy(HOUSE); house.visible = false; scene.add(house);
const pm = (c) => new THREE.MeshPhongMaterial({ color: c, shininess: 6 });
const HM = { floor: pm("#b98a5e"), wall: pm("#efe7d8"), wallTop: pm("#3a3540"), rug: pm("#7a8fa6"), bed: pm("#e9e2d4"), duvet: pm("#5b7a9a"), duvet2: pm("#a65d4a"), wood: pm("#6e4f37"), sofa: pm("#56606f"), counter: pm("#d8d3c8"), dark: pm("#2a2a30"), plant: pm("#4f7d45"), tile: pm("#cfd6d8") };
function hb(mat, x0, x1, y0, y1, z0, z1) { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.castShadow = m.receiveShadow = true; house.add(m); return m; }
// floor plate 13 x 24.5 (the lot), street side at z=0
hb(HM.floor, 0, 13, -0.3, 0, 0, 24.5);
hb(HM.tile, 9.5, 13, 0.01, 0.02, 11, 16);
const WH = 1.5, WT2 = 0.18;
const walls = [
  [0, 13, 0, 0], [0, 13, 24.5, 24.5], [0, 0, 0, 24.5], [13, 13, 0, 24.5],
  [0, 4.5, 10, 10], [6, 13, 10, 10], [0, 6.2, 16, 16], [7.4, 9.5, 16, 16], [9.5, 13, 11, 11], [9.5, 9.5, 11, 16],
  [6.8, 6.8, 16, 24.5], [6.8, 6.8, 10, 11.6],
];
for (const [x0, x1, z0, z1] of walls) {
  const t = WT2 / 2;
  hb(HM.wall, Math.min(x0, x1) - t, Math.max(x0, x1) + t, 0, WH, Math.min(z0, z1) - t, Math.max(z0, z1) + t);
  hb(HM.wallTop, Math.min(x0, x1) - t, Math.max(x0, x1) + t, WH, WH + 0.04, Math.min(z0, z1) - t, Math.max(z0, z1) + t);
}
// living room + kitchen (front)
hb(HM.rug, 1.2, 6.2, 0.01, 0.03, 3.2, 7.8);
hb(HM.sofa, 1.4, 6, 0, 0.75, 7.4, 8.6); hb(HM.sofa, 1.4, 6, 0.75, 1.1, 8.3, 8.6);
hb(HM.wood, 2.6, 4.8, 0, 0.42, 4.6, 5.8);
hb(HM.dark, 2, 5.4, 0.5, 1.3, 0.3, 0.45); hb(HM.wood, 1.8, 5.6, 0, 0.5, 0.25, 0.75);
hb(HM.counter, 9.2, 12.8, 0, 0.92, 0.25, 0.9); hb(HM.counter, 12.2, 12.8, 0, 0.92, 0.9, 6);
hb(HM.counter, 8.6, 11.2, 0, 0.92, 3.6, 5.2);
hb(HM.plant, 6.6, 7.2, 0, 1.1, 8.8, 9.4);
// Bedroom 1 (back left): bed, desk
hb(HM.bed, 0.6, 3.4, 0, 0.55, 19.6, 24); hb(HM.duvet, 0.6, 3.4, 0.55, 0.65, 19.6, 22.8);
hb(HM.wood, 4.4, 6.4, 0, 0.75, 23, 24.2); hb(HM.dark, 4.9, 5.9, 0.75, 1.15, 23.6, 23.7);
hb(HM.wood, 0.4, 2.6, 0, 1.8, 16.3, 16.9);
// Bedroom 2 (back right): bed
hb(HM.bed, 9.6, 12.6, 0, 0.55, 19.4, 24); hb(HM.duvet2, 9.6, 12.6, 0.55, 0.65, 19.4, 22.6);
hb(HM.wood, 7.2, 8.6, 0, 0.8, 23.2, 24.2);
// the lamps
const ROOMS = [
  { id: "living", name: "Living room", label: [4, 0.2, 5.5], lamps: [
    { id: 1, name: "Kitchen pendant 1", on: true, b: 50, at: [9.4, 2.2, 4.4], pendant: true },
    { id: 2, name: "Kitchen pendant 2", on: true, b: 50, at: [10.6, 2.2, 4.4], pendant: true },
  ] },
  { id: "bed1", name: "Bedroom 1", label: [3.4, 0.2, 18.4], lamps: [
    { id: 3, name: "Bed lamp", on: false, b: 70, at: [3.9, 0.95, 23.4] },
    { id: 4, name: "Desk lamp", on: false, b: 80, at: [6.0, 1.25, 23.5] },
  ] },
  { id: "bed2", name: "Bedroom 2", label: [9.9, 0.2, 18.2], lamps: [
    { id: 5, name: "Floor lamp", on: false, b: 60, at: [8.0, 1.1, 23.7] },
    { id: 6, name: "Candle", on: false, b: 40, at: [12.6, 1.3, 18.9] },
  ] },
];
// The home's own room and lamp names, and its Hue light ids, fill the rooms' slots in order.
ROOMS.forEach((r, i) => {
  const c = NAMES.rooms[i];
  if (!c) return;
  if (c.name) r.name = c.name;
  (c.lamps || []).forEach((l, j) => { if (r.lamps[j]) Object.assign(r.lamps[j], { id: l.id, name: l.name || r.lamps[j].name }); });
});
const LAMPS = ROOMS.flatMap((r) => r.lamps.map((l) => Object.assign(l, { room: r.id })));
for (const l of LAMPS) {
  const [x, y, z] = l.at;
  if (l.pendant) hb(HM.dark, x - 0.02, x + 0.02, y, 2.9, z - 0.02, z + 0.02);
  else hb(HM.dark, x - 0.05, x + 0.05, y - 0.8 > 0 ? y - 0.8 : 0, y, z - 0.05, z + 0.05);
  l.bulb = new THREE.Mesh(new THREE.SphereGeometry(l.pendant ? 0.28 : 0.22, 8, 6), new THREE.MeshBasicMaterial({ color: "#6b6670" }));
  l.bulb.position.set(x, y, z); house.add(l.bulb);
  l.light = new THREE.PointLight("#ffcf8a", 0, 7.5, 1.6); l.light.position.set(x, y + 0.2, z); house.add(l.light);
  l.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffd75e", transparent: true, opacity: 0 }));
  l.ring.position.set(x, 0.05, z); house.add(l.ring);
}
const houseAmb = new THREE.AmbientLight("#8e8aa6", 0); scene.add(houseAmb);
function lampColor(l) { return l.tone === "read" ? "#ffe2b5" : l.tone === "relax" ? "#ffb468" : "#ffcf8a"; }
function updateLamps() {
  for (const l of LAMPS) {
    l.light.intensity = l.on ? (0.6 + l.b / 60) * PI * 3 : 0;
    l.light.color.set(lampColor(l));
    l.bulb.material.color.set(l.on ? lampColor(l) : "#6b6670");
  }
  updateHomeWindows(); renderDrawer(); renderChip();
}
function roomOn(id) { const ls = LAMPS.filter((l) => l.room === id && l.on); return ls.length ? ls.reduce((a, l) => a + l.b, 0) / ls.length : 0; }
function updateHomeWindows() {
  if (!look) return;
  const glass = new THREE.Color("#3b4553");
  for (const w of homeWin) {
    const b = roomOn(w.room);
    const k = b ? (0.35 + 0.65 * look.win) * (0.5 + b / 200) : 0;
    w.m.material.color.copy(glass).lerp(new THREE.Color("#ffcf7a"), clamp(k, 0, 1));
  }
}

// ---------- signs and street names (HTML over the canvas)
const labels = document.getElementById("labels");
const signs = [];
function sign(html, at, cls) { const el = document.createElement("div"); el.className = cls || "sign"; el.innerHTML = html; labels.appendChild(el); const s = { el, at: new THREE.Vector3(...at), city: cls !== "room" }; signs.push(s); return s; }
const trainSign = sign("", [-52, 10, -58]);
const dockSigns = DOCKS.map((d) => sign("", d.anchor));
const homeSign = sign("", [HX, HOME.floors * FH + 6, 25]);
// What the speakers play. The card is pinned to the left margin, on the bottom edge, rather than floating
// over the roofs: it is the widest sign on screen and it changes with every track, so hanging it over the
// middle of the block covered the block. The tie to the house is the notes rising off the roof instead.
const musicSign = sign("", [8, HOME.floors * FH + 2, 30]);
musicSign.pinned = true;
musicSign.el.classList.add("pinned");
const notesSign = sign(`<i>♪</i><i>♫</i><i>♪</i>`, [HX, HOME.floors * FH + 1, 12], "notes");
const roomSigns = ROOMS.map((r) => { const s = sign(r.name, [HOUSE.x + r.label[0], 1.8, HOUSE.z + r.label[2]], "room"); s.city = false; return s; });
function mins(s) { return s <= 30 ? "Now" : `${Math.ceil(s / 60)} min`; }
function shown(tr, now) { const s = tr.next - now; return s >= -DWELL ? s : tr.queued != null ? tr.queued - now : s; }
function routeOf(tr, now) { return (tr.next - now >= -DWELL ? tr.route : tr.queuedRoute) || "6"; }
// The line in its circle, so a route number never reads as minutes.
const bullet = (r, sm) => `<span class="bullet${sm ? " sm" : ""}">${String(r || "6").replace("X", "")}</span>`;
function renderSigns(now) {
  const d = shown(trains.down, now), u = shown(trains.up, now);
  const row = (label, tr, s) => `<div class="row" style="justify-content:space-between;gap:18px;margin-top:6px"><span class="s">${label}</span>${s < -DWELL || s > 5400 ? `<span class="t">–</span>` : `<span class="row" style="gap:8px">${bullet(routeOf(tr, now), true)}<span class="t">${mins(Math.max(0, s))}</span></span>`}</div>`;
  trainSign.el.innerHTML = `<div class="row"><span class="t">${NAMES.station.name}</span><span class="s" style="font-size:15px">${NAMES.station.line.split(" · ").pop()}</span></div>${row("Downtown", trains.down, d)}${row("Uptown", trains.up, u)}`;
  DOCKS.forEach((dk, i) => {
    dockSigns[i].el.innerHTML = `<div class="s" style="font-size:16px;letter-spacing:.08em">${dk.name} · ${dk.side}</div>
      <div class="row" style="gap:14px;margin-top:4px"><span class="big"><span class="bolt">⚡</span>${dk.ebikes}</span><span class="big" style="color:${BIKE_BLUE}">${dk.classic}</span></div>
      <div class="s" style="font-size:15px">e-bikes · classic</div>`;
  });
  const on = LAMPS.filter((l) => l.on).length;
  homeSign.el.innerHTML = `<div class="row"><span class="dot ${on ? "" : "off"}"></span><span class="t">${NAMES.homeLabel}</span></div>`;
  renderMusic();
  renderChip();
  if (poi) renderDetail(now);
}
const v3 = new THREE.Vector3();
function projectSigns() {
  for (const s of signs) {
    const show = !s.off && (mode === "home" ? !s.city : s.city && mode === "city" && !flying && s.el !== detailHost);
    // A pinned card sits where the CSS puts it; the camera has no say, so don't write a transform over it.
    if (s.pinned) { s.el.style.opacity = show ? "1" : "0"; continue; }
    v3.copy(s.at).project(camera);
    const vis = show && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
    s.el.style.opacity = vis ? "1" : "0";
    if (vis) s.el.style.transform = `translate(${(v3.x + 1) / 2 * W}px, ${(1 - v3.y) / 2 * H}px) translate(-50%, ${s.el.classList.contains("sign") ? "-100%" : "-50%"})`;
  }
}

// ---------- camera poses and the fly-in
const dirOf = (az, el) => new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
// The overview is panned, not re-aimed: camera and target move together along the ground so the block slides
// left in frame and the station's sign sits near the edge rather than a third of the way in. `+x, +z` reads as
// screen-right in this isometric, so this is one sideways step, no change of angle.
const PAN = new THREE.Vector3(20.5, 0, 15.9);
const OVERVIEW = { pos: target.clone().add(PAN).add(dirOf(0.68, 0.79).multiplyScalar(900)), target: target.clone().add(PAN), fov: 12 };
const HIGH = { pos: new THREE.Vector3(HX, 70, -62), target: new THREE.Vector3(HX, 6, 12.5), fov: 32 };
const STREET = { pos: new THREE.Vector3(HX, 1.8, -5), target: new THREE.Vector3(HX, 5.2, 12.5), fov: 58 };
const DOOR = { pos: new THREE.Vector3(HX, 1.9, 9.4), target: new THREE.Vector3(HX, 1.9, 14), fov: 72 };
const IN_C = new THREE.Vector3(9.2, 0, 14.3), IN_OFF = new THREE.Vector3(-15.5, 23, 21.5);
const INSIDE = { pos: HOUSE.clone().add(IN_C).add(IN_OFF), target: HOUSE.clone().add(IN_C), fov: 41 };
// Where the apartment is revealed from, coming out of the black. It used to be an eye-level pose just inside
// the door, which continued the walk in — but the apartment is a cutaway with no ceiling, so from down there
// it read as an edge-on slab hanging in an empty sky, and the room labels piled up on one line. So: the same
// angle as the settled view, just closer and wider. The reveal is a step back, and the first frame is already
// the apartment rather than something that looks broken.
const INSIDE_IN = { pos: HOUSE.clone().add(IN_C).add(IN_OFF.clone().multiplyScalar(0.52)), target: HOUSE.clone().add(IN_C), fov: 58 };
const cam = { pos: OVERVIEW.pos.clone(), target: OVERVIEW.target.clone(), fov: OVERVIEW.fov };
function applyCam() {
  camera.position.copy(cam.pos); camera.lookAt(cam.target); camera.fov = cam.fov;
  const dist = cam.pos.distanceTo(cam.target);
  camera.near = clamp(dist * 0.18, 0.15, 300); camera.far = dist * 2.4 + 700;
  camera.updateProjectionMatrix();
}
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function tween(to, ms) {
  const from = { pos: cam.pos.clone(), target: cam.target.clone(), fov: cam.fov };
  return new Promise((res) => {
    const t0 = performance.now();
    const step = () => {
      const k = ease(clamp((performance.now() - t0) / ms, 0, 1));
      cam.pos.lerpVectors(from.pos, to.pos, k); cam.target.lerpVectors(from.target, to.target, k); cam.fov = lerp(from.fov, to.fov, k);
      if (k < 1) requestAnimationFrame(step); else res();
    };
    step();
  });
}
const setPose = (p) => { cam.pos.copy(p.pos); cam.target.copy(p.target); cam.fov = p.fov; };
const fadeEl = document.getElementById("fade");
const fade = (v) => new Promise((res) => { fadeEl.style.opacity = v; setTimeout(res, 300); });
let mode = "city", flying = false, wantClose = false;
const cityHud = ["chip", "looks", "wxmarks", "dock", "mock"].map((id) => document.getElementById(id));
async function openHome() {
  if (flying || mode !== "city") return;
  flying = true; cityHud.forEach((e) => e.classList.add("hide"));
  drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
  await tween(HIGH, 1300);
  await tween(STREET, 1000);
  await tween(DOOR, 650);
  if (TV) {
    // On the TV the app shows the real apartment (its 3D view) from here; the page waits at the door.
    mode = "door"; flying = false;
    toNative({ type: "atDoor" });
    if (wantClose) { wantClose = false; closeHome(); }
    return;
  }
  await fade(1);
  house.visible = true; houseAmb.intensity = 0.55 * PI; mode = "home";
  setPose(INSIDE_IN);
  // Compile the apartment's materials while the screen is still black: the first frame that draws it would
  // otherwise cost a few hundred milliseconds on the TV, and that hitch would land in plain sight.
  renderer.compile(scene, camera);
  // The step back starts under the black and the black lifts into it, so nothing is ever shown standing still.
  const settle = tween(INSIDE, 1100);
  await fade(0);
  await settle;
  flying = false;
  focusDrawer(0);
  if (wantClose) { wantClose = false; closeHome(); }
}
async function closeHome() {
  if (flying) { wantClose = true; return; }
  if (mode === "door") {
    flying = true;
    await tween(STREET, 600);
    await tween(OVERVIEW, 1500);
    mode = "city"; flying = false; cityHud.forEach((e) => e.classList.remove("hide"));
    return;
  }
  if (mode !== "home") return;
  flying = true;
  drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
  await tween(INSIDE_IN, 700);
  await fade(1);
  house.visible = false; houseAmb.intensity = 0; mode = "city";
  setPose(DOOR);
  await fade(0);
  await tween(STREET, 600);
  await tween(OVERVIEW, 1500);
  flying = false; cityHud.forEach((e) => e.classList.remove("hide"));
  chip.focus();
}

// ---------- drawer and remote control
const drawer = document.getElementById("drawer"), roomsEl = document.getElementById("rooms"), chip = document.getElementById("chip");
function renderDrawer() {
  const focusedId = document.activeElement && document.activeElement.dataset.lamp;
  roomsEl.innerHTML = ROOMS.map((r) => `<div class="roomgrp"><h3>${r.name}</h3>${r.lamps.map((l) =>
    `<button type="button" class="lamp${l.on ? " on" : ""}" data-lamp="${l.id}" aria-pressed="${l.on}"><span>${l.name}</span><span class="sw" aria-hidden="true"></span><span class="bar"><i style="width:${l.on ? l.b : 0}%"></i></span></button>`).join("")}</div>`).join("");
  roomsEl.style.display = "flex"; roomsEl.style.flexDirection = "column"; roomsEl.style.gap = "18px";
  if (focusedId) { const el = roomsEl.querySelector(`[data-lamp="${focusedId}"]`); if (el) el.focus(); }
}
function renderChip() {
  const on = LAMPS.filter((l) => l.on).length;
  document.getElementById("chiptxt").textContent = on ? `Lights · ${on} on` : "Lights · all off";
  document.getElementById("chipdots").innerHTML = ROOMS.map((r) => `<span class="dot ${roomOn(r.id) ? "" : "off"}" title="${r.name}"></span>`).join("");
}
const lampById = (id) => LAMPS.find((l) => String(l.id) === String(id));
roomsEl.addEventListener("click", (e) => { const b = e.target.closest("[data-lamp]"); if (!b) return; const l = lampById(b.dataset.lamp); l.on = !l.on; l.tone = null; updateLamps(); });
roomsEl.addEventListener("focusin", (e) => { const b = e.target.closest("[data-lamp]"); LAMPS.forEach((l) => { l.focus = b && String(l.id) === b.dataset.lamp; }); });
document.getElementById("scenes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-scene]"); if (!b) return;
  const sc = b.dataset.scene;
  if (sc === "off") LAMPS.forEach((l) => { l.on = false; });
  else {
    const lit = LAMPS.filter((l) => l.on); const targets = lit.length ? lit : LAMPS.filter((l) => l.room === "living");
    targets.forEach((l) => { l.on = true; l.b = sc === "read" ? 100 : 57; l.tone = sc; });
  }
  updateLamps();
});
chip.addEventListener("click", openHome);
const apps = [...document.querySelectorAll(".app")];
function focusDrawer(i) { const items = drawerItems(); (items[i] || items[0]).focus(); }
const drawerItems = () => [...drawer.querySelectorAll(".pill, .lamp")];
addEventListener("keydown", (e) => {
  const k = e.key;
  if (mode === "poi" && poi && poi.id === "music" && !flying && musicKey(k)) { e.preventDefault(); return; }
  if (TV) {
    e.preventDefault();
    if (mode === "poi") { if (k === "Escape" || k === "Backspace") zoomOut(); return; }
    if (mode !== "city" || flying) return;
    if (k.startsWith("Arrow")) { if (!sel) select(lastSel || homePoi); else navigate(k); }
    else if (k === "Enter" || k === " ") enter(sel);
    return;
  }
  if (mode === "home") {
    if (k === "Escape" || k === "Backspace") { e.preventDefault(); closeHome(); return; }
    const items = drawerItems(), i = items.indexOf(document.activeElement);
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      const pills = items.filter((x) => x.classList.contains("pill"));
      let j = i;
      if (k === "ArrowDown") j = i < pills.length ? pills.length : i + 1; else j = i <= pills.length ? 0 : i - 1;
      focusDrawer(clamp(j, 0, items.length - 1));
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      const el = document.activeElement;
      if (el && el.classList.contains("lamp")) { e.preventDefault(); const l = lampById(el.dataset.lamp); l.on = true; l.b = clamp(l.b + (k === "ArrowRight" ? 10 : -10), 1, 100); updateLamps(); }
      else if (el && el.classList.contains("pill")) { e.preventDefault(); const pills = items.filter((x) => x.classList.contains("pill")); focusDrawer(clamp(i + (k === "ArrowRight" ? 1 : -1), 0, pills.length - 1)); }
    }
    return;
  }
  if (mode === "poi") { if (k === "Escape" || k === "Backspace") { e.preventDefault(); zoomOut(); } return; }
  if (mode !== "city" || flying) return;
  // Same ring as the TV: the signs, the Lights chip and the dock tiles are one plane of buttons.
  if (k.startsWith("Arrow")) { e.preventDefault(); if (!sel) select(lastSel || homePoi); else navigate(k); }
  else if (k === "Enter" || k === " ") { if (sel) { e.preventDefault(); enter(sel); } }
});

// ---------- points of interest
const detailHost = document.createElement("div");
detailHost.id = "detail"; detailHost.className = "detail hide";
stage.appendChild(detailHost);
const POIS = [
  { id: "lights", el: chip, hud: true },
  { id: "home", el: homeSign.el },
  { id: "music", el: musicSign.el, target: new THREE.Vector3(HX, HOME.floors * FH, 30), dist: 150, elev: 0.75 },
  { id: "train", el: trainSign.el, target: new THREE.Vector3(-80, -5, -40), dist: 84, elev: 0.86 },
  { id: "bikesW", el: dockSigns[0].el, dock: DOCKS[0], target: new THREE.Vector3(-47, 0, 74.2), dist: 40, elev: 1.25 },
  { id: "bikesE", el: dockSigns[1].el, dock: DOCKS[1], target: new THREE.Vector3(187.6, 0, 58), dist: 40, elev: 1.25 },
  // The two mark rows sit in the ring like anything else: the row is the stop, OK walks its set in place
  // without flying the camera anywhere.
  { id: "sky", el: document.getElementById("looks") },
  { id: "wx", el: document.getElementById("wxmarks") },
  // The dock tiles sit in the same ring as the signs, so Down off the block lands on them and Up comes
  // back. Inside the TV app they are display:none and `reachable` drops them; the native dock takes over.
  ...apps.map((el, i) => ({ id: `app${i}`, el, app: true })),
];
const homePoi = POIS.find((p) => p.id === "home");
let sel = null, poi = null, lastSel = null;
// The Lights chip lifts, so it takes `.focus`; everything else — the map signs and the mark rows — says
// "selected" in place and takes `.sel`.
function select(p) { POIS.forEach((x) => x.el.classList.toggle(x.hud ? "focus" : "sel", x === p)); sel = p; if (p) lastSel = p; }
function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
/** On screen and reachable: not hidden by the TV, not faded out with the rest of the HUD. */
const reachable = (el) => el.offsetParent !== null && el.style.opacity !== "0" && !el.closest(".hide");
/** Spatial move: the nearest button in that direction (off-axis distance counts double). */
function navigate(dir) {
  const from = centerOf(sel.el);
  let best = null, bestD = Infinity;
  for (const p of POIS) {
    if (p === sel || !reachable(p.el)) continue;
    const c = centerOf(p.el), dx = c.x - from.x, dy = c.y - from.y;
    const main = dir === "ArrowRight" ? dx : dir === "ArrowLeft" ? -dx : dir === "ArrowDown" ? dy : -dy;
    if (main <= 8) continue;
    const d = main + 2 * Math.abs(dir === "ArrowRight" || dir === "ArrowLeft" ? dy : dx);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) select(best);
  else if (dir === "ArrowDown") { select(null); toNative({ type: "focusDock" }); }
}
const poseFor = (p) => ({ pos: p.target.clone().add(dirOf(0.68, p.elev).multiplyScalar(p.dist)), target: p.target.clone(), fov: 30 });
async function enter(p) {
  if (!p || flying) return;
  if (p.app) return; // the dock tiles are a mock; selecting one is all they do
  if (p.id === "lights") { if (TV) toNative({ type: "openLights" }); else openHome(); return; }
  if (p.id === "home") { if (TV) toNative({ type: "viewHome" }); else openHome(); return; }
  if (p.id === "sky") { cycleTod(); return; }
  if (p.id === "wx") { cycleWx(); return; }
  flying = true; mode = "poi"; poi = p;
  glassMesh.visible = p.id !== "train";
  toNative({ type: "poi", on: true });
  cityHud.forEach((e) => e.classList.add("hide"));
  renderDetail(clockS);
  await tween(poseFor(p), 1500);
  detailHost.classList.remove("hide");
  flying = false;
}
async function zoomOut() {
  if (mode !== "poi" || flying) return;
  flying = true; detailHost.classList.add("hide");
  await tween(OVERVIEW, 1400);
  mode = "city"; poi = null; flying = false; glassMesh.visible = true;
  cityHud.forEach((e) => e.classList.remove("hide"));
  toNative({ type: "poi", on: false });
}
let detailHtml = "";
function renderDetail(now) {
  if (!poi) return;
  if (poi.id !== "music") detailHtml = "";
  if (poi.id === "train") {
    const rows = (label, tr) => {
      const list = (tr.list && tr.list.length ? tr.list : [{ route: tr.route || "6", at: tr.next }]).filter((a) => a.at - now > -DWELL).slice(0, 3);
      return `<div class="drow"><span class="dlabel">${label}</span>${list.length ? list.map((a) => `<span class="dtrain">${bullet(a.route, true)}<b>${mins(Math.max(0, a.at - now))}</b></span>`).join("") : "<b>–</b>"}</div>`;
    };
    detailHost.innerHTML = `<div class="dhead"><span class="t">${NAMES.station.name}</span><span class="s">${NAMES.station.line}</span></div>${rows("Downtown", trains.down)}${rows("Uptown", trains.up)}<div class="dhint">Back to the block</div>`;
  } else if (poi.id === "music") {
    const np = nowPlaying();
    if (!np) { detailHost.innerHTML = `<div class="dhead"><span class="t">Music</span><span class="s">Nothing playing</span></div><div class="dhint">Back to the block</div>`; return; }
    const m = np.state.media;
    const rooms = [...SPEAKERS.values()].sort((a, b) => (b.state.volume ?? -1) - (a.state.volume ?? -1));
    musicRooms = rooms;
    musicSel = clamp(musicSel, 0, rooms.length);
    const ctl = np.capabilities && np.capabilities.media || [];
    const btn = (cmd, label, ok) => `<button type="button" class="tbtn${ok ? "" : " dis"}" data-cmd="${cmd}"${ok ? "" : " disabled"}>${label}</button>`;
    const html = `<div class="np">${artImg(m.artworkUrl, 32, "big")}<div class="nptxt"><div class="t">${esc(m.title || "Playing")}</div>
      <div class="s">${esc([m.artist, m.album].filter(Boolean).join(" · "))}</div><div class="src${m.app === "Spotify" ? " spotify" : ""}">${m.state === "paused" ? "Paused · " : ""}${esc(m.app || "Sonos")}</div>
      <div class="transport${musicSel === 0 ? " sel" : ""}">${btn("previous", "⏮", ctl.includes("previous"))}${btn("playPause", m.state === "playing" ? "❚❚" : "▶", ctl.includes("play"))}${btn("next", "⏭", ctl.includes("next"))}</div></div></div>
      <div class="spk">${rooms.map((d, i) => { const dm = d.state.media || {}; const here = (m.group || [np.name]).includes(d.name);
        return `<div class="spkrow${here && dm.state === "playing" ? " on" : ""}${musicSel === i + 1 ? " sel" : ""}" data-room="${i + 1}"><span class="nm">${esc(d.name)}</span><span class="vol"><i style="width:${d.state.volume ?? 0}%"></i></span><span class="st">${!d.state.reachable ? "offline" : here ? (dm.state === "playing" ? `♪ ${d.state.volume ?? ""}` : "paused") : dm.state === "playing" ? esc(dm.title || "other") : "idle"}</span></div>`; }).join("")}</div>
      <div class="dhint">${musicSel === 0 ? "OK play / pause · ← → skip" : "← → volume"} · ↑ ↓ choose · Back to the block</div>`;
    // Unchanged panel: keep its nodes (a click in progress keeps its target).
    if (html !== detailHtml) { detailHtml = html; detailHost.innerHTML = html; }
  } else {
    const d = poi.dock;
    detailHost.innerHTML = `<div class="dhead"><span class="t">${d.name}</span><span class="s">${d.side}</span></div>
      <div class="drow big"><span><span class="bolt">⚡</span>${d.ebikes}<small>e-bikes</small></span><span style="color:${BIKE_BLUE}">${d.classic}<small>classic</small></span>${d.free != null ? `<span>${d.free}<small>free docks</small></span>` : ""}</div>
      <div class="dhint">Live from Citi Bike · Back to the block</div>`;
  }
}
// Commands from the TV app (focus in/out of the block, Back, Home)
function command(type) {
  if (type === "focusIn") { if (mode === "city") select(lastSel || homePoi); return true; }
  if (type === "focusOut") { select(null); return true; }
  if (type === "back") { if (mode === "poi") zoomOut(); else if (mode === "city") { select(null); toNative({ type: "focusDock" }); } return true; }
  if (type === "reset") { select(null); if (mode === "poi") zoomOut(); return true; }
  return false;
}
// The mouse agrees with the remote: clicking a button selects it, then does whatever it does.
for (const p of POIS) {
  p.el.style.pointerEvents = "auto"; p.el.style.cursor = "pointer";
  if (p.id !== "lights") p.el.addEventListener("click", () => { select(p); enter(p); });
}

// mock controls
document.getElementById("mock").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.wx) { wx = b.dataset.wx; wxForced = true; wxTemp = null; wxLabel = null; syncMock(); applyLook(); tickClock(); }
  if (b.dataset.tod) { todMode = b.dataset.tod; syncMock(); applyLook(); tickClock(); }
});
document.getElementById("trainNow").addEventListener("click", () => { trains.down.next = clockS + APPROACH; });

// clock + weather line
const WX_TEXT = { clear: "CLEAR", rain: "RAIN", snow: "SNOW", wind: "WINDY" };
const WX_TEMP = { clear: 45, rain: 43, snow: 29, wind: 41 };
const TOD_TEXT = { day: "DAY", dusk: "DUSK", night: "NIGHT" };
const TODS = ["day", "dusk", "night"], WXS = ["clear", "rain", "snow", "wind"];
let lastLine = "";
function tickClock() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", weekday: "short", month: "short", day: "numeric" }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  document.getElementById("hhmm").textContent = `${get("hour")}:${get("minute")}`;
  document.getElementById("ampm").textContent = get("dayPeriod");
  if (todMode === "auto" && look !== LOOKS[currentTod()]) applyLook();
  // The look is named here rather than on the marks: one line carries the date, the sky and the weather,
  // and it never says "auto" — it says what the block is actually showing. A dot means you pinned it.
  // innerHTML, so the two values that come off the weather bridge go through `esc` (declared below, but
  // this only ever runs from the timer at the foot of the file).
  const sep = '<span class="sep">·</span>', pin = '<span class="pin"></span>';
  const line = esc(`${get("weekday")} ${get("month")} ${get("day")}`.toUpperCase()) + sep
    + TOD_TEXT[currentTod()] + (todMode === "auto" ? "" : pin) + sep
    + esc(String(wxLabel ?? WX_TEXT[wx]).toUpperCase()) + " " + esc(String(wxTemp ?? WX_TEMP[wx])) + "\u00B0"
    + (wxForced ? pin : "");
  if (line !== lastLine) { lastLine = line; document.getElementById("wxline").innerHTML = line; }
  renderMarks();
}

// ---------- the sky and weather marks
// Two rows under the dateline. They carry no label of their own, because the line above is already
// saying the words; these are only the marks, and the place the remote changes them from.
const MARK = {
  day: '<circle cx="12" cy="12" r="4"/><g stroke-linecap="round"><path d="M12 2.8v2.3M12 18.9v2.3M21.2 12h-2.3M5.1 12H2.8M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6M18.5 18.5l-1.6-1.6M7.1 7.1 5.5 5.5"/></g>',
  dusk: '<path d="M6.9 16.4a5.1 5.1 0 0 1 10.2 0"/><g stroke-linecap="round"><path d="M12 3.6v2.1M19.6 8.1l-1.5 1.5M4.4 8.1l1.5 1.5"/><path d="M2.6 16.4h2.6M18.8 16.4h2.6"/><path d="M3.4 20.2h5.2M11.2 20.2h3.4M17.2 20.2h3.4" opacity=".5"/></g>',
  night: '<path d="M20.1 14.8A8.3 8.3 0 0 1 9.4 4.1a8.6 8.6 0 1 0 10.7 10.7z"/>',
  clear: '<circle cx="12" cy="12" r="5.6"/>',
  rain: '<path d="M7.6 14.6a3.7 3.7 0 0 1 .5-7.4 5.4 5.4 0 0 1 10.2 1.6 3.1 3.1 0 0 1-.6 5.8"/><g stroke-linecap="round"><path d="M9.2 17.6 8.1 20.4M13 17.6l-1.1 2.8M16.8 17.6l-1.1 2.8"/></g>',
  snow: '<g stroke-linecap="round"><path d="M12 2.8v18.4M4 7.4l16 9.2M20 7.4 4 16.6"/><path d="M9.5 4.6 12 7.1l2.5-2.5M9.5 19.4 12 16.9l2.5 2.5M3.4 10.6l.6 3.4 3.3-.9M20.6 13.4l-.6-3.4-3.3.9"/></g>',
  wind: '<g stroke-linecap="round"><path d="M2.8 8.6h10.6a2.7 2.7 0 1 0-2.7-2.7"/><path d="M2.8 13.4h13.4a2.7 2.7 0 1 1-2.7 2.7"/><path d="M2.8 18.2h6.6"/></g>',
};
const looksEl = document.getElementById("looks"), wxMarksEl = document.getElementById("wxmarks");
function markRow(el, keys, active, held, text) {
  const next = keys[(keys.indexOf(active) + 1) % keys.length];
  el.classList.toggle("held", held);
  el.innerHTML = keys.map((k) => `<span class="m${k === active ? " on" : ""}"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${k === active ? 1.9 : 1.55}" stroke-linejoin="round">${MARK[k]}</svg><i></i></span>`).join("")
    + `<span class="hint">OK \u2192 ${text[next]}</span>`;
}
let markKey = "";
function renderMarks() {
  // Seven small SVGs; rebuild them only when something they show has actually changed, not every second.
  const tod = currentTod(), key = `${tod}|${todMode}|${wx}|${wxForced}`;
  if (key === markKey) return;
  markKey = key;
  markRow(looksEl, TODS, tod, todMode !== "auto", TOD_TEXT);
  markRow(wxMarksEl, WXS, wx, wxForced, WX_TEXT);
}
// OK walks the set and wraps. Pinning lasts the session on purpose — the screen is a window on the street
// first, so a reload, or the TV waking up tomorrow, comes back to the real sky. There is nothing here to
// put it back on auto, which is why the dateline grows a dot the moment you pin it.
function cycleTod() { todMode = TODS[(TODS.indexOf(currentTod()) + 1) % TODS.length]; syncMock(); applyLook(); tickClock(); }
function cycleWx() { wx = WXS[(WXS.indexOf(wx) + 1) % WXS.length]; wxForced = true; wxTemp = null; wxLabel = null; syncMock(); applyLook(); tickClock(); }
/** The mock panel is a second face on the same state; keep its pressed buttons honest. */
function syncMock() {
  document.querySelectorAll("[data-tod]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.tod === todMode));
  document.querySelectorAll("[data-wx]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.wx === wx));
}

// occasional Citi Bike comings and goings
function bikeEvent() {
  if (liveBikes) return;
  const d = pick(DOCKS);
  const n = d.ebikes + d.classic;
  if (n > 2 && Math.random() < 0.5) { if (d.classic > 0 && Math.random() < 0.6) d.classic--; else d.ebikes--; }
  else if (n < d.slots) { if (Math.random() < 0.5) d.classic++; else d.ebikes++; }
  layoutDock(d, Math.min(d.ebikes + d.classic, d.slots) - 1);
}
setInterval(bikeEvent, 9000);

// ---------- live data
let liveTrains = false, liveBikes = false, wxForced = false, wxTemp = null, wxLabel = null;
async function pollTrains() {
  const d = await fetchTrains(NAMES.station.stop);
  if (!d) return; // no bridge (plain preview): the sample schedule keeps running
  const nowS = Date.now() / 1000;
  for (const [k, list] of [["down", d.downtown], ["up", d.uptown]]) {
    const tr = trains[k];
    const next = list.find((a) => a.at > nowS - DWELL);
    const at = next ? clockS + (next.at - nowS) : clockS + 9999;
    const cur = tr.next - clockS;
    // A train at the platform or pulling out finishes its run; the next one waits its turn.
    if (liveTrains && cur <= 0 && cur > -(DWELL + 30) && (!next || next.at - nowS > 30)) { tr.queued = at; tr.queuedRoute = next ? next.route : ""; }
    else { tr.next = at; tr.route = next ? next.route : ""; tr.queued = null; }
    tr.list = list.filter((a) => a.at > nowS - 30).slice(0, 4).map((a) => ({ route: a.route, at: clockS + (a.at - nowS) }));
  }
  liveTrains = true;
}
async function pollBikes() {
  const d = await fetchBikes();
  if (!d) return; // sample counts
  d.stations.forEach((st, i) => {
    const dk = DOCKS.find((k) => k.name === st.name) || DOCKS[i];
    if (!dk) return;
    const before = dk.ebikes + dk.classic;
    dk.ebikes = st.ebikes; dk.classic = st.classic; dk.free = st.docks; dk.capacity = st.capacity;
    const after = dk.ebikes + dk.classic;
    if (after !== before || !liveBikes) layoutDock(dk, after > before && liveBikes ? Math.min(after, dk.slots) - 1 : undefined);
  });
  liveBikes = true;
}
async function pollWeather() {
  if (wxForced || !LOC) return;
  const c = await fetchWeather(LOC);
  if (!c) return; // keep the last look
  wxTemp = c.temp; wxLabel = c.label;
  if (c.kind !== wx) { wx = c.kind; applyLook(); }
  tickClock();
}
// Remote control of the music panel: row 0 = the group's transport, rows 1… = a room's volume.
let musicSel = 0, musicRooms = [];
async function sonosAct(id, action) {
  const d = await deviceAction(id, action);
  if (d) SPEAKERS.set(d.id, d);
  lastSigns = 0;
}
function musicCmd(cmd) {
  const np = nowPlaying(); if (!np) return;
  const ctl = np.capabilities && np.capabilities.media || [];
  if (cmd === "playPause" ? !ctl.includes("play") : !ctl.includes(cmd)) return;
  if (cmd === "playPause") np.state.media.state = np.state.media.state === "playing" ? "paused" : "playing";
  sonosAct(np.id, { type: "media", command: cmd });
}
function musicVolume(i, delta) {
  const d = musicRooms[i - 1]; if (!d || typeof d.state.volume !== "number") return;
  d.state.volume = clamp(d.state.volume + delta * 3, 0, 100);
  sonosAct(d.id, { type: "volume", value: d.state.volume });
}
/** A key in the music panel; true when used. */
function musicKey(k) {
  if (k === "ArrowUp" || k === "ArrowDown") { musicSel = clamp(musicSel + (k === "ArrowDown" ? 1 : -1), 0, musicRooms.length); lastSigns = 0; return true; }
  if (k === "ArrowLeft" || k === "ArrowRight") { if (musicSel === 0) musicCmd(k === "ArrowRight" ? "next" : "previous"); else musicVolume(musicSel, k === "ArrowRight" ? 1 : -1); return true; }
  if (k === "Enter" || k === " ") { if (musicSel === 0) musicCmd("playPause"); return true; }
  return false;
}
detailHost.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cmd]"); if (b) { musicSel = 0; musicCmd(b.dataset.cmd); return; }
  const row = e.target.closest("[data-room]"); if (!row) return;
  const i = Number(row.dataset.room), bar = row.querySelector(".vol").getBoundingClientRect();
  musicSel = i;
  const d = musicRooms[i - 1]; if (!d) return;
  if (e.clientX >= bar.left && e.clientX <= bar.right) { d.state.volume = Math.round(clamp((e.clientX - bar.left) / bar.width, 0, 1) * 100); sonosAct(d.id, { type: "volume", value: d.state.volume }); }
});

// The Sonos speakers (one device per room; a group's rooms share its media, media.group names them).
const SPEAKERS = new Map();
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** The group to show: one playing (most rooms first), else one paused. */
function nowPlaying() {
  const ds = [...SPEAKERS.values()].filter((d) => d.state.reachable && d.state.media && d.state.media.state !== "idle");
  const rank = (d) => (d.state.media.state === "playing" ? 100 : 0) + (d.state.media.group || [d.name]).length;
  return ds.sort((a, b) => rank(b) - rank(a))[0] || null;
}
// Covers drawn as pixel art: shrunk to n×n, shown scaled up with hard pixels.
const ART = new Map();
function artImg(url, n, cls) {
  if (!url) return `<span class="art ${cls || ""} none">♪</span>`;
  const key = `${url}|${n}`;
  if (!ART.has(key)) {
    ART.set(key, null);
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = n; const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, n, n); ART.set(key, c.toDataURL()); lastSigns = 0; };
    img.src = url;
  }
  const data = ART.get(key);
  return data ? `<img class="art ${cls || ""}" src="${data}" alt="">` : `<span class="art ${cls || ""} none">♪</span>`;
}
function renderMusic() {
  const np = nowPlaying();
  musicSign.off = !np; notesSign.off = !np || np.state.media.state !== "playing";
  if (!np) return;
  const m = np.state.media, rooms = m.group || [np.name];
  const html = `<div class="row">${artImg(m.artworkUrl, 16)}<div><div class="t">${esc(m.title || "Playing")}</div><div class="s">${esc(m.artist || m.app || "")}</div>
    <div class="s src">${m.state === "paused" ? "❚❚ " : "♪ "}${esc(m.app || "Sonos")} · ${rooms.length > 1 ? `${rooms.length} rooms` : esc(rooms[0])}</div></div></div>`;
  if (musicSign.el.innerHTML !== html) musicSign.el.innerHTML = html;
}

// The home's lamps: the bridge's event stream (a snapshot, then one event per change), cookie auth.
function applyDevice(d) {
  if (d && d.source === "sonos") { SPEAKERS.set(d.id, d); return; }
  const m = /^hue:light:(\d+)$/.exec(d.id || "");
  const l = m && LAMPS.find((x) => String(x.id) === m[1]);
  if (!l || !d.state) return;
  l.on = d.state.on === true;
  if (typeof d.state.brightness === "number") l.b = d.state.brightness;
  l.tone = null;
}
pollTrains(); pollBikes(); pollWeather();
connectDevices((d) => { applyDevice(d); updateLamps(); });
setInterval(pollTrains, 20_000); setInterval(pollBikes, 30_000); setInterval(pollWeather, 10 * 60_000);

// The TV launcher drives the page: Lights opens the home (fly-in), Back closes it, the selected lamp glows.
const toNative = (msg) => { try { if (window.appart3dAndroid) window.appart3dAndroid.postMessage(JSON.stringify(msg)); } catch { /* not in the app */ } };
window.appart3dEmbed = {
  post(cmd) {
    if (!cmd || typeof cmd !== "object") return false;
    if (cmd.type === "openHome") { openHome(); return true; }
    if (cmd.type === "closeHome") { closeHome(); return true; }
    if (cmd.type === "spotlightDevice") { LAMPS.forEach((l) => { l.focus = cmd.deviceId === `hue:light:${l.id}`; }); return true; }
    if (command(cmd.type)) return true;
    return false;
  },
};
let frames = 0, statT = performance.now(), readySent = false;

// ---------- main loop
let clockS = 0, last = performance.now(), lastSigns = 0;
const UP = new THREE.Vector3(0, 1, 0);
{
  const h = (location.hash || "").slice(1).toLowerCase();
  if (LOOKS[h]) todMode = h;
  if (WX_TEXT[h]) { wx = h; wxForced = true; }
  syncMock();
  if (h === "home") setTimeout(openHome, 300);
  if (h === "street") { flying = true; setPose(STREET); cityHud.forEach((e) => e.classList.add("hide")); }
  if (h === "inside") { mode = "home"; house.visible = true; houseAmb.intensity = 0.55 * PI; setPose(INSIDE); cityHud.forEach((e) => e.classList.add("hide")); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); }
}
applyLook(); updateLamps(); applyCam();
setInterval(tickClock, 1000); tickClock();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clockS += dt;
  updateTraffic(dt, clockS, wx === "snow" ? 0.6 : wx === "rain" ? 0.85 : 1);
  updatePeople(dt, clockS, wx);
  updateWeather(dt, clockS, wx);
  updateSnowCover(dt);
  scenery(dt, clockS, look.lamp);
  placeTrain(trains.down, clockS); placeTrain(trains.up, clockS);
  // trees sway (much more when it is windy)
  const amp = wx === "wind" ? 0.22 : 0.035;
  treeData.forEach((tr, i) => {
    const sway = Math.sin(clockS * (wx === "wind" ? 3.2 : 1.1) + tr.ph) * amp;
    dummy.position.set(tr.x + sway * 3, CURB + 3.6 * tr.s, tr.z); dummy.rotation.set(0, tr.ph, sway); dummy.scale.set(tr.s, tr.s * 0.95, tr.s); dummy.updateMatrix(); canopyM.setMatrixAt(i, dummy.matrix);
  });
  canopyM.instanceMatrix.needsUpdate = true;
  // docked bikes settling in
  bikeFrames.forEach((b, k) => { if (b.pop) { b.pop = Math.max(0, b.pop - dt * 1.6); placeBike(k, b); } });
  bikeM.instanceMatrix.needsUpdate = seatM.instanceMatrix.needsUpdate = wheelM.instanceMatrix.needsUpdate = true;
  // the selected lamp pulses in the dollhouse
  for (const l of LAMPS) l.ring.material.opacity = l.focus && mode === "home" ? 0.55 + Math.sin(now / 180) * 0.35 : 0;
  if (mode === "home" && !flying) {
    const c = HOUSE.clone().add(IN_C);
    cam.pos.copy(c).add(IN_OFF.clone().applyAxisAngle(UP, Math.sin(now / 5200) * 0.18));
    cam.target.copy(c);
  }
  applyCam();
  renderer.render(scene, camera);
  if (!readySent) { readySent = true; toNative({ type: "ready" }); }
  frames++;
  if (now - statT > 10_000) { console.log(`[appart3d-stats] block fps=${(frames * 1000 / (now - statT)).toFixed(1)} pix=${PIX} shadows=${SHADOWS}`); frames = 0; statT = now; }
  if (now - lastSigns > 250) { renderSigns(clockS); lastSigns = now; }
  projectSigns();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
