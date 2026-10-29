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
import { loadHomeConfig, resolveLocation, fetchTrains, fetchBikes, fetchWeather, connectDevices, deviceAction, runScene } from "../shared/feeds.js";
import {
  canMedia, HUE_RECIPES, inMood, isLightLike, isMoodScene, isOn, isReachable, lampLevel, lightColor,
  mediaLoaded, mediaRooms, moodAdjusted, moodStatus, nowPlaying, roomGroups, roomPosition,
} from "@appart3d/home";
import * as P from "./paint.js";
import { SIT_G, CROUCH_G, PERCH_G, SWING_G, FIST } from "./figure.js";

// Colors and lights as in the mock (three r128 look): no color management, linear output, π-scaled lights.
THREE.ColorManagement.enabled = false;
const Q = new URLSearchParams(location.search);
const TV = Q.has("tv"), MOCK = Q.has("mock"), SHADOWS = Q.get("shadows") !== "0";
const W = 1920, H = 1080, PIX = Math.min(4, Math.max(1, Number(Q.get("pix")) || 1));
const CFG = await loadHomeConfig();
const LOC = resolveLocation(CFG, Q);
const NAMES = {
  place: CFG.place || "YOUR BLOCK",
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
document.querySelector("#drawer h2").textContent = NAMES.homeLabel;
if (!MOCK) document.getElementById("mock").hidden = true;
const stage = document.getElementById("stage");
/**
 * Inside the home rather than over the block. Not `mode === "home"`: the TV reaches the same view with
 * `mode === "door"`, because there the page is the floor the app's own apartment lands on. Everything that
 * is about the *frame* (backdrop, room labels, the slow drift) asks this; everything about the *remote*
 * (which keys the drawer takes) still asks `mode`, since on the TV the app owns the remote.
 */
function isInside() { return stage.classList.contains("inside"); }
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
// The TV draws its own app dock over the bottom ~280px of the frame and the web page cannot resize it,
// so the block is framed for the 800px above it instead: the frustum is shifted down by LIFT, which
// raises everything on screen by that many pixels without touching the scale or the perspective.
// `project()` reads the same matrix, so the signs ride up with the things they point at.
const LIFT = 128;
camera.setViewOffset(W, H, 0, LIFT, W, H);

// ---------- the map (meters; x east, z south). Distances are squeezed so the station's avenue fits beside
// the home's (the second avenue); home sits on the fourth street, two docks on the fifth and on the fourth avenue.
// The roads carry no names: the geometry is a squeezed invention, so any name hung on it would be a lie — and
// the three things worth naming (the station, the two docks) name themselves on their own signs.
// `lanes` is how many travel lanes the one-way avenues carry: enough to cover the roadbed from the
// parking lane to the bike lane, so no avenue reads as half-empty asphalt.
const AVES = [
  { x: -190, w: 22, dir: -1, lanes: 4 },
  { x: -80, w: 28, two: true },
  { x: 0, w: 28, dir: -1, lanes: 6, bike: true },
  { x: 200, w: 28, dir: 1, lanes: 6, bike: true },
  { x: 380, w: 30, dir: -1, lanes: 5 },
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
/**
 * The block is built 720×580 so the streets run off every edge of the frame and the city does not stop
 * where the picture does. The lens only reaches about 465×450 of it: at the far corners of AREA sit two
 * whole avenues, a cross street, and the trees, lamps and water towers along them, which no pose the
 * camera can take has ever shown. They were being driven, swayed, transformed and shadowed for nobody.
 *
 * This is the footprint of the frustum on the ground over every pose (x −171..295, z −209..246),
 * measured up to roof height and grown by a bus length, so a prop is only dropped once no part of it
 * could cross the edge of the frame. Verified by pixel diff, not by eye: hiding everything outside it
 * changes zero pixels from the overview, the high shot, the street and the door, while hiding what is
 * inside it changes tens of thousands.
 *
 * The block is still *generated* whole, in the same order — the seeded RNG decides the palette and the
 * skyline, and skipping a spawn would shift every draw after it and repaint the city. Cull after, never
 * during.
 */
const SEEN = { x0: -180, x1: 302, z0: -216, z1: 251 };
const unseen = (x, z) => x < SEEN.x0 || x > SEEN.x1 || z < SEEN.z0 || z > SEEN.z1;
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
  wood: lam("#8a6a4a"), woodRoof: lam("#6b5038"), stoop: lam("#8c7f72"),
  // The street door is green; its recessed panels are the same green a shade down, which is all the
  // relief a flat-shaded leaf needs at this distance.
  door: lam("#2f5d45"), doorPanel: lam("#255041"),
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
    // The street face, in one piece — or in four, around a doorway (`o.hole = [x0, x1, y0, y1]`), so the
    // way in is a hole in the wall with somewhere behind it rather than a leaf painted on a solid box.
    const face = (xa, xb, ya, yb) => acc.quad([xb, ya, z0], [xa, ya, z0], [xa, yb, z0], [xb, yb, z0], [0, 0, -1],
      [U(x1 - xb), V(ya)], [U(x1 - xa), V(ya)], [U(x1 - xa), V(yb)], [U(x1 - xb), V(yb)]);
    const h = o.hole;
    if (!h) face(x0, x1, y0, y1);
    else { face(x0, h[0], y0, y1); face(h[1], x1, y0, y1); face(h[0], h[1], y0, h[2]); face(h[0], h[1], h[3], y1); }
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
    else for (let i = 1; i < av.lanes; i++) dashes("z", av.x - av.w / 2 + 2.4 + i * 3.5, a, b, A.mark, 3, 6, 0.18);
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
const trees = [], lamps = [], towers = [], roofs = [];
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
  roofs.push({ x0, x1, z0, z1, h, floors });
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
// The doorway is a real hole in the façade, with a hall behind it. The hole is a shade *smaller* than the
// leaf, so a shut door overlaps the brick by a couple of centimetres. A hole wider than its door, which is
// what a real jamb is, leaves a slit of unlit interior all round it, and against the brick that reads as a
// black outline drawn on the door rather than as a reveal.
const DOOR_W = 1.6, DOOR_Y0 = CURB + 1.2, DOOR_Y1 = CURB + 3.6;
const JAMB = [HX - DOOR_W / 2 + 0.02, HX + DOOR_W / 2 - 0.02, DOOR_Y0, DOOR_Y1 - 0.02];
const homeMat = lam("#e8c98f", { map: WT.map });
const homeAcc = new Acc(), homeRoofAcc = new Acc();
box(homeAcc, HOME.x0, HOME.x1, CURB, HOME.floors * FH, HOME.z0, HOME.z1, { top: homeRoofAcc, ou: 3, ov: 0, hole: JAMB });
box(homeRoofAcc, HOME.x0 - 0.3, HOME.x1 + 0.3, HOME.floors * FH, HOME.floors * FH + 0.6, HOME.z0 - 0.3, HOME.z1 + 0.3);
const homeMesh = homeAcc.mesh(homeMat, { cast: true });
const homeRoofMat = lam("#c0643f");
const homeRoof = homeRoofAcc.mesh(homeRoofMat, { cast: true });
// The stoop and the way in, which is two doors, not one: the green street door, a vestibule with the
// mailboxes down its left-hand wall, then the white glass door with the basket of flowers on it, and the
// stairs behind that. Both leaves hang on hinges of their own rather than being baked into the building,
// so the walk in can open them: a group at each jamb, the leaf built off to one side of it, and
// `swingDoor` turns both.
const doorPivot = new THREE.Group(), innerPivot = new THREE.Group();
{
  const sx = HX, z = HOME.z0;
  const st = new Acc();
  for (let i = 0; i < 4; i++) box(st, sx - 1.5, sx + 1.5, CURB, CURB + 0.3 * (i + 1), z - 2.4 + i * 0.6, z);
  st.mesh(M.stoop, { cast: true });

  // ---- everything behind the façade, seen from inside it: every face is drawn inward (the camera is in
  // the box, not outside it), and every material is basic. A lamp in here would mean one more light in
  // every Lambert shader on the block, which is frames on the TV, for two rooms that are on screen for
  // three seconds. Flat warm colour against the sun-lit brick reads as lit from within anyway.
  const inFloor = (a, x0, x1, z0, z1, y) => a.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], Z2, Z2, Z2, Z2);
  const inCeil = (a, x0, x1, z0, z1, y) => a.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], Z2, Z2, Z2, Z2);
  const inSide = (a, x, y0, y1, z0, z1, s) => s > 0
    ? a.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], [1, 0, 0], Z2, Z2, Z2, Z2)
    : a.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], [-1, 0, 0], Z2, Z2, Z2, Z2);
  const inBack = (a, x0, x1, y0, y1, z) => a.quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], [0, 0, -1], Z2, Z2, Z2, Z2);
  const hallW = new Acc(), hallF = new Acc(), tread = new Acc(), riser = new Acc(), deep = new Acc();
  const DH = DOOR_Y1 - DOOR_Y0, T = 0.08;
  const f0 = DOOR_Y0, f1 = f0 + 2.6, vx0 = sx - 1.35, vx1 = sx + 1.35;
  // zi is the vestibule's far wall and the inner door's plane; vz1 is the back of the stair hall.
  const zi = z + 1.95, vz1 = z + 5.2;
  inFloor(hallF, vx0, vx1, z, vz1, f0);
  inCeil(hallW, vx0, vx1, z, vz1, f1);
  inSide(hallW, vx0, f0, f1, z, vz1, 1); inSide(hallW, vx1, f0, f1, z, vz1, -1);
  inBack(deep, vx0, vx1, f0, f1, vz1);
  // The wall between the two, with its own doorway: left of it, right of it, over it. Undersized like the
  // hole in the façade, for the same reason — the leaf must cover it, not sit inside it.
  const jx0 = sx - DOOR_W / 2 + 0.02, jx1 = sx + DOOR_W / 2 - 0.02;
  inBack(hallW, vx0, jx0, f0, f1, zi); inBack(hallW, jx1, vx1, f0, f1, zi); inBack(hallW, jx0, jx1, f0 + DH - 0.02, f1, zi);
  // The mailboxes: a strip of little brass doors down the left-hand wall of the vestibule, two rows of
  // five, which is the first thing in the frame once the green door is out of the way. Left-hand means
  // `vx1`: the camera walks in along +z, so its left is +x and what is on +x is on the left of the screen.
  const boxes = new Acc(), boxBack = new Acc();
  inSide(boxBack, vx1 - 0.02, f0 + 0.88, f0 + 1.6, z + 0.2, z + 1.24, -1);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
    const by = f0 + 0.93 + r * 0.33, bz = z + 0.25 + c * 0.195;
    inSide(boxes, vx1 - 0.05, by, by + 0.28, bz, bz + 0.165, -1);
  }
  // Ten steps climbing away into the dark of the landing — what the glass door opens on.
  const RISE = 0.19, RUN = 0.28, STEPS = 10, sz = vz1 - RUN * STEPS;
  for (let i = 0; i < STEPS; i++) {
    const y = f0 + RISE * (i + 1), sz0 = sz + RUN * i;
    inBack(riser, sx - 0.75, sx + 0.75, y - RISE, y, sz0);
    inFloor(tread, sx - 0.75, sx + 0.75, sz0, sz0 + RUN, y);
  }
  hallW.mesh(new THREE.MeshBasicMaterial({ color: "#c9ad82" }));
  hallF.mesh(new THREE.MeshBasicMaterial({ color: "#7d6244" }));
  tread.mesh(new THREE.MeshBasicMaterial({ color: "#9a7a52" }));
  riser.mesh(new THREE.MeshBasicMaterial({ color: "#5e4a35" }));
  deep.mesh(new THREE.MeshBasicMaterial({ color: "#241b14" }));
  boxBack.mesh(new THREE.MeshBasicMaterial({ color: "#4a4038" }));
  boxes.mesh(new THREE.MeshBasicMaterial({ color: "#b9924c" }));
  const lantern = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color: "#ffd9a0" }));
  lantern.position.set(sx, f0 + 2.05, z + 2.6); scene.add(lantern);
  const cord = new Acc();
  box(cord, sx - 0.015, sx + 0.015, f0 + 2.15, f1, z + 2.585, z + 2.615);
  cord.mesh(new THREE.MeshBasicMaterial({ color: "#3a2f24" }));

  // ---- the leaves. Both are built in their pivot's own coordinates — x running from the hinge, y 0 at the
  // threshold — so turning the group turns the lot. `face` lays a rectangle on both sides of a leaf, a hair
  // proud of it: a panel or a pane from the street and the same from behind, two quads, no hole to cut.
  const face = (a, x0, x1, y0, y1, d) => {
    a.quad([x1, y0, -T / 2 - d], [x0, y0, -T / 2 - d], [x0, y1, -T / 2 - d], [x1, y1, -T / 2 - d], [0, 0, -1], Z2, Z2, Z2, Z2);
    a.quad([x0, y0, T / 2 + d], [x1, y0, T / 2 + d], [x1, y1, T / 2 + d], [x0, y1, T / 2 + d], [0, 0, 1], Z2, Z2, Z2, Z2);
  };
  // `Acc.mesh` puts what it builds in the scene; these belong to a door, so take them back.
  const hang = (pivot, parts) => { for (const p of parts) pivot.add(p); scene.add(pivot); };

  // The street door: green, panelled, hinged on the right of the frame and swinging into the vestibule.
  doorPivot.position.set(sx - DOOR_W / 2, DOOR_Y0, z + 0.06);
  {
    const leafA = new Acc(), paneA = new Acc(), brassA = new Acc();
    box(leafA, 0, DOOR_W, 0, DH, -T / 2, T / 2);
    for (const [y0, y1] of [[0.18, 0.86], [0.96, 1.5], [1.6, 2.22]]) face(paneA, 0.16, DOOR_W - 0.16, y0, y1, 0.004);
    box(brassA, DOOR_W - 0.25, DOOR_W - 0.11, 1.0, 1.14, -T / 2 - 0.05, -T / 2 - 0.01);
    box(brassA, DOOR_W - 0.43, DOOR_W - 0.13, 1.04, 1.1, -T / 2 - 0.09, -T / 2 - 0.05);
    hang(doorPivot, [leafA.mesh(M.door, { cast: true }), paneA.mesh(M.doorPanel, { cast: true }), brassA.mesh(lam("#c79b4a"))]);
  }

  // The vestibule door: white, three panes of glass in a band near the top with the basket of flowers hung
  // over the middle one. Hinged on the left like the street door and swinging inwards, nearly flat against
  // the right-hand wall of the stair hall — the one way it can open without standing in the line the camera
  // walks, and without folding over the mailboxes.
  innerPivot.position.set(sx - DOOR_W / 2, DOOR_Y0, zi + 0.05);
  {
    const leafA = new Acc(), paneA = new Acc(), glassA = new Acc(), brassA = new Acc(), basketA = new Acc();
    box(leafA, 0, DOOR_W, 0, DH, -T / 2, T / 2);
    const GI = 0.13, MU = 0.055, PW = (DOOR_W - GI * 2 - MU * 2) / 3;
    for (let i = 0; i < 3; i++) face(glassA, GI + i * (PW + MU), GI + i * (PW + MU) + PW, 1.42, 2.06, 0.004);
    face(paneA, 0.17, DOOR_W - 0.17, 0.2, 0.74, 0.003);
    face(paneA, 0.17, DOOR_W - 0.17, 0.84, 1.3, 0.003);
    box(brassA, DOOR_W - 0.25, DOOR_W - 0.11, 1.0, 1.14, -T / 2 - 0.05, -T / 2 - 0.01);
    box(brassA, DOOR_W - 0.43, DOOR_W - 0.13, 1.04, 1.1, -T / 2 - 0.09, -T / 2 - 0.05);
    box(basketA, 0.57, 1.03, 1.44, 1.7, -T / 2 - 0.21, -T / 2 - 0.02);
    box(basketA, 0.785, 0.815, 1.7, 2.12, -T / 2 - 0.13, -T / 2 - 0.1);
    // The blooms: one instanced mesh, a spiral of little faceted balls over the basket, pinks and creams
    // and yellows with some leaf green among them. One draw call for the whole bunch.
    const N = 26, BLOOM = ["#f3a7bf", "#fbe7ef", "#f7d774", "#e86f9a", "#fdf6e6", "#7fae6a", "#5f8f55"];
    const blooms = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.052, 0), new THREE.MeshBasicMaterial(), N);
    const mx = new THREE.Matrix4(), bc = new THREE.Color(), bs = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const a = i * 2.399, r = Math.sqrt((i + 0.5) / N);
      mx.makeTranslation(0.8 + Math.cos(a) * r * 0.27, 1.81 + Math.sin(a) * r * 0.17, -T / 2 - 0.1 - (1 - r) * 0.1);
      mx.scale(bs.setScalar(0.75 + (i % 3) * 0.2));
      blooms.setMatrixAt(i, mx);
      blooms.setColorAt(i, bc.set(BLOOM[i % BLOOM.length]));
    }
    hang(innerPivot, [
      leafA.mesh(new THREE.MeshBasicMaterial({ color: "#efe7d8" })),
      paneA.mesh(new THREE.MeshBasicMaterial({ color: "#dcd2c0" })),
      glassA.mesh(new THREE.MeshBasicMaterial({ color: "#ffe3b4" })),
      brassA.mesh(new THREE.MeshBasicMaterial({ color: "#c79b4a" })),
      basketA.mesh(new THREE.MeshBasicMaterial({ color: "#c79a5e" })),
      blooms]);
  }
}
/**
 * Swing the way in: 0 shut, 1 wide, both leaves at once; the vestibule door follows a beat behind the
 * street one. Both open inwards, hinged on the same jamb, and both fold onto the right-hand wall — which
 * leaves the mailboxes on the left in the clear. A leaf swinging out over the stoop was tried first and is
 * wrong for this shot: it comes at the lens, and at any angle wide enough to clear the doorway it is the
 * biggest thing on screen. 106° is as far as either can go before its free edge meets the side wall.
 */
const DOOR_OPEN = -1.85, INNER_OPEN = -1.85, INNER_LAG = 0.45;
function swingDoor(to, ms, leaf = "both") {
  const outer = leaf !== "inner", inner = leaf !== "outer";
  const fromO = doorPivot.rotation.y, fromI = innerPivot.rotation.y;
  const endO = to * DOOR_OPEN, endI = to * INNER_OPEN;
  // Only when the two go together does the inner one wait its turn; asked for on its own it starts at once.
  const lag = leaf === "both" ? INNER_LAG : 0;
  const set = (k) => {
    if (outer) doorPivot.rotation.y = lerp(fromO, endO, k);
    if (inner) innerPivot.rotation.y = lerp(fromI, endI, clamp((k - lag) / (1 - lag), 0, 1));
  };
  if (!ms) { set(1); return Promise.resolve(); }
  return new Promise((res) => {
    const t0 = performance.now();
    const step = () => {
      const k = clamp((performance.now() - t0) / ms, 0, 1);
      // Eased out only: a door is heavy at the start and light by the end, and it must not bounce.
      set(1 - Math.pow(1 - k, 3));
      if (k < 1) requestAnimationFrame(step); else res();
    };
    step();
  });
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
  const seen = towers.filter(([x, , z]) => !unseen(x, z));
  const tank = inst(new THREE.CylinderGeometry(1.7, 1.7, 3.2, 8), M.wood, seen.length, true);
  const cone = inst(new THREE.ConeGeometry(1.95, 1.4, 8), M.woodRoof, seen.length, true);
  const legs = inst(new THREE.BoxGeometry(2.6, 2.2, 2.6), M.pole, seen.length, true);
  seen.forEach(([x, y, z], i) => {
    dummy.position.set(x, y + 1.1, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); legs.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + 3.8, z); dummy.updateMatrix(); tank.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + 6.1, z); dummy.updateMatrix(); cone.setMatrixAt(i, dummy.matrix);
  });
  legs.material = new THREE.MeshLambertMaterial({ color: "#3b3d44", transparent: true, opacity: 0.85 });
}
const canopyMat = lam(BASE.canopy);
// Every tree is still drawn from the bag in order — height, sway phase, then the three numbers of its
// green — because the bag is what makes the row of them look planted rather than stamped. Only then are
// the off-camera ones set aside.
const everyTree = trees.map(([x, z]) => ({
  x, z, s: R(0.8, 1.25), ph: R(0, 6.28),
  color: new THREE.Color().setHSL(R(0.24, 0.31), R(0.35, 0.5), R(0.27, 0.36)),
}));
const treeData = everyTree.filter((t) => !unseen(t.x, t.z));
const trunkM = inst(new THREE.CylinderGeometry(0.22, 0.28, 2.6, 5), lam(BASE.trunk), treeData.length, true);
const canopyM = inst(new THREE.IcosahedronGeometry(2.3, 0), canopyMat, treeData.length, true);
treeData.forEach((t, i) => {
  dummy.position.set(t.x, CURB + 1.3, t.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); trunkM.setMatrixAt(i, dummy.matrix);
  canopyM.setColorAt(i, t.color);
});
if (canopyM.instanceColor) canopyM.instanceColor.needsUpdate = true;
const litLamps = lamps.filter(([x, z]) => !unseen(x, z));
const poleM = inst(new THREE.BoxGeometry(0.18, 5.2, 0.18), M.pole, litLamps.length, false);
const headM = inst(new THREE.BoxGeometry(0.7, 0.25, 0.7), M.lampHead, litLamps.length, false);
const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
const glowM = inst(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), glowMat, litLamps.length, false);
glowM.renderOrder = 3; glowM.receiveShadow = false;
litLamps.forEach(([x, z], i) => {
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
  else { for (let i = 0; i < av.lanes; i++) addLane("z", av.x - av.w / 2 + 4.2 + i * 3.5, av.dir, true); }
}
for (const st of STS) {
  if (st.two) { for (const i of [0, 1]) { addLane("x", st.z - 1.9 - i * 3.5, -1, false); addLane("x", st.z + 1.9 + i * 3.5, 1, false); } }
  else addLane("x", st.z + (st.dir > 0 ? 1.2 : -1.2), st.dir, false);
}
for (const lane of lanes) {
  const density = lane.avenue ? 26 : 42;
  for (let s = R(0, 12); s < lane.L - 6; s += R(density * 0.6, density * 1.5)) {
    let t = carType(); if (lane.avenue && rng() < 0.04) t = CAR_TYPES[4];
    const car = { lane, t, s, v: R(6, 10), vmax: R(9, 12.5), color: carColor(t) };
    lane.cars.push(car);
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
// Two cars in five drive off-camera for ever (see SEEN). Every street keeps exactly the cars it was
// given; the ones no pose can reach are dropped before they become instances.
for (const lane of lanes) {
  // A lane is a line at a fixed coordinate running the whole area, so one test retires all of it.
  if (!(lane.axis === "z" ? unseen(lane.fixed, 0) : unseen(0, lane.fixed))) continue;
  lane.cars.length = 0;
}
const onstage = lanes.flatMap((l) => l.cars);
const parkedSeen = parked.filter((c) => !unseen(c.x, c.z));
const NCARS = onstage.length + parkedSeen.length;
const carMat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
const bodyM = inst(unit, carMat, NCARS, true);
const cabM = inst(unit, new THREE.MeshLambertMaterial({ color: "#ffffff" }), NCARS, true);
const headMat = new THREE.MeshBasicMaterial({ color: "#fff3c9" }), tailMat = new THREE.MeshBasicMaterial({ color: "#d8352f" });
const hlM = inst(unit, headMat, NCARS, false), tlM = inst(unit, tailMat, NCARS, false);
const tmpC = new THREE.Color();
[...onstage, ...parkedSeen].forEach((c, i) => {
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
parkedSeen.forEach((c) => placeCar(c, c.x, c.z, c.axis, c.dir));
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
// Every avenue with a bike lane gets riders in it, going the way the avenue goes.
const riders = [];
for (const av of AVES) {
  if (!av.bike) continue;
  const x = av.x + av.w / 2 - 1.4;
  for (let i = 0; i < 8; i++) riders.push({ x, dir: av.dir, s: R(0, AREA.z1 - AREA.z0), v: R(4.5, 6.5), e: rng() < 0.45 });
}
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
  const RUN = AREA.z1 - AREA.z0;
  riders.forEach((r, k) => {
    r.s += r.v * speed * dt; if (r.s > RUN) r.s -= RUN;
    const z = r.dir > 0 ? AREA.z0 + r.s : AREA.z1 - r.s, i = walkers.length + k;
    const yaw = r.dir > 0 ? -Math.PI / 2 : Math.PI / 2, back = z - 0.1 * r.dir, x = r.x;
    placeBikeAt(bikeFrames.length + k, x, 0, z, yaw, 1);
    dummy.rotation.set(0, yaw, 0);
    dummy.position.set(x, 0.55, back); dummy.scale.set(1, 0.85, 1); dummy.updateMatrix(); bodyP.setMatrixAt(i, dummy.matrix);
    dummy.scale.set(1, 1, 1); dummy.position.set(x, 1.6, back); dummy.updateMatrix(); headP.setMatrixAt(i, dummy.matrix);
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
/**
 * Day, dusk or night — from where the sun actually is over the home when the bridge has told us
 * (`sunElev`, the rule the apartment view already follows: day above +6°, night below −6°, dusk in
 * between), else from the clock. The clock version is off by over an hour at the solstices: in late
 * autumn the block painted DAY until 17:00 with the street already dark outside the window.
 */
let sunElev = null;
function currentTod() {
  if (todMode !== "auto") return todMode;
  if (sunElev !== null) return sunElev > 6 ? "day" : sunElev < -6 ? "night" : "dusk";
  const h = nycHour(); return h >= 7 && h < 17 ? "day" : (h >= 17 && h < 19) || h === 6 ? "dusk" : "night";
}
const target = new THREE.Vector3(38, 0, 0);
function applyLook() {
  const tod = currentTod(), L = LOOKS[tod];
  const wet = wx === "rain" || wx === "snow";
  const dim = wet ? 0.72 : 1;
  // Inside the home the backdrop is the studio one, not the sky; a weather poll landing while you are in
  // there must not paint the block's sky behind the model.
  if (!isInside()) scene.background = P.skyTexture(tod, wet);
  hemi.color.set(L.hemiSky); hemi.groundColor.set(L.hemiGround); hemi.intensity = L.hemiI * (wet ? 0.92 : 1) * PI;
  sun.color.set(L.sun); sun.intensity = L.sunI * (wet ? 0.35 : 1) * dim * PI;
  const az = L.az * Math.PI / 180, el = L.el * Math.PI / 180;
  sun.position.set(target.x + Math.sin(az) * Math.cos(el) * 600, Math.sin(el) * 600, target.z + Math.cos(az) * Math.cos(el) * 600);
  sun.target.position.copy(target);
  facMats.forEach((m) => { m.emissiveIntensity = L.win * 0.9; });
  bandMat.emissiveIntensity = L.win * 0.6;
  // The suit's own light comes *down* as the block gets dark, which is the opposite of what it looks
  // like it should do. The emissive is a flat white add — three.js does not run it through the vertex
  // colours — so it is a fixed number of lamps against a scene whose every other light has dropped.
  // The same 0.18 that is a faint sheen at noon is most of what you see of him at midnight: the red
  // goes salmon, the blue goes lilac, and the shading flattens out of him altogether. He still pops
  // after dark at 0.1, because the roof he is sitting on fell further than he did.
  // Keyed off the window glow rather than the name of the hour: it already measures how dark the block
  // is, and it follows the weather dimming for free. Day sits at win 0.3, night at 1.
  suitMat.emissiveIntensity = 0.18 - 0.08 * clamp((L.win - 0.3) / 0.7, 0, 1);
  glowMat.opacity = L.lamp * 0.8;
  // By day the pools under the lamps are transparent; additive blending costs the same whether it
  // adds light or nothing, so take them out of the frame instead of adding zero to it.
  glowM.visible = glowMat.opacity > 0.01;
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
const HM = { floor: pm("#b98a5e"), wall: pm("#efe7d8"), wallTop: pm("#3a3540"), rug: pm("#7a8fa6"), bed: pm("#e9e2d4"), duvet: pm("#5b7a9a"), duvet2: pm("#a65d4a"), wood: pm("#6e4f37"), sofa: pm("#56606f"), counter: pm("#d8d3c8"), dark: pm("#2a2a30"), plant: pm("#4f7d45"), tile: pm("#cfd6d8"), base: pm("#6d5a46"), baseRim: pm("#43372b") };
function hb(mat, x0, x1, y0, y1, z0, z1) { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.castShadow = m.receiveShadow = true; house.add(m); return m; }
// The base the apartment stands on. Without it the cutaway is a slab of floor hanging in mid-air, which is
// exactly what made it read as a floor plan pasted over the background rather than a model of the home. A
// margin of warm board on every side and a darker rim under it give it a bottom and a bit of weight.
hb(HM.base, -1.3, 14.3, -0.85, -0.3, -1.3, 25.8);
hb(HM.baseRim, -1.3, 14.3, -1.15, -0.85, -1.3, 25.8);
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
const LAMPS = ROOMS.flatMap((r) => r.lamps.map((l) => Object.assign(l, { room: r.id, did: `hue:light:${l.id}` })));
const LAMP_BY_DEV = new Map(LAMPS.map((l) => [l.did, l]));
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

/**
 * Every lamp in the drawer is a bridge device, and the drawer's presses are bridge actions: the block is
 * one more client of the home, not a picture of it. It used to flip a local flag and look convincing,
 * which meant the panel you reach from the city and the panel the TV draws did different things.
 *
 * With no bridge — the demo block, a preview — the devices below are made up and this page drives them
 * itself, by the same rules (`@appart3d/home`) the bridge plans with. One shape of lamp, not two.
 */
const DEVICES = new Map();
const ROOM_NAME = new Map(ROOMS.map((r) => [r.id, r.name]));
const ROOM_ORDER = ROOMS.map((r) => r.name);
for (const l of LAMPS)
  DEVICES.set(l.did, {
    id: l.did, name: l.name, kind: "light", source: "hue", room: ROOM_NAME.get(l.room),
    state: { on: l.on, reachable: true, brightness: l.b, kelvin: 2700 },
    capabilities: { brightness: true, kelvin: true },
  });
/** The mood the house is in (`relax` / `read`), as the bridge reports it. Null until it says otherwise. */
let MOOD = null;
/** True once the bridge has spoken: until then the presses below move the made-up devices instead. */
let LIVE = false;
const homeLamps = () => [...DEVICES.values()].filter(isLightLike);

function updateLamps() {
  for (const l of LAMPS) {
    const d = DEVICES.get(l.did);
    const on = !!d && isOn(d);
    // The colour is the lamp's own — its kelvin, or the colour it reports. A mood is not a tint this page
    // invents; it is a temperature the bulb is actually sitting at, and it arrives with the device.
    const c = on ? lightColor(d) : "#6b6670";
    l.light.intensity = on ? (0.6 + lampLevel(d) / 60) * PI * 3 : 0;
    l.light.color.set(on ? c : "#ffcf8a");
    l.bulb.material.color.set(c);
  }
  updateHomeWindows(); renderDrawer(); renderChip(); renderRoomSigns();
}
/** The room labels on the model carry the same lit/unlit dot as the chip, so the plan answers the drawer. */
function renderRoomSigns() {
  ROOMS.forEach((r, i) => { roomSigns[i].el.innerHTML = `<span class="dot ${roomOn(r.id) ? "" : "off"}"></span>${esc(r.name)}`; });
}
/** Average level of the lit lamps of one modelled room, for its windows and its sign. */
function roomOn(id) {
  const ls = LAMPS.map((l) => (l.room === id ? DEVICES.get(l.did) : null)).filter((d) => d && isOn(d));
  return ls.length ? ls.reduce((a, d) => a + lampLevel(d), 0) / ls.length : 0;
}
function updateHomeWindows() {
  if (!look) return;
  const glass = new THREE.Color("#3b4553");
  for (const w of homeWin) {
    const b = roomOn(w.room);
    const k = b ? (0.35 + 0.65 * look.win) * (0.5 + b / 200) : 0;
    w.m.material.color.copy(glass).lerp(new THREE.Color("#ffcf7a"), clamp(k, 0, 1));
  }
}

// ---------- the neighbour on the roofs
// A person-sized figure, so at this zoom he is about nine pixels of red: you can tell who it is from
// the colours and from the way he travels, and that is the whole joke. He is away far more than he is
// here — a minute of empty roofs, then one pass across the block, then gone again.
// The web is anchored on the roof he is going to, and the swing is an honest variable-length pendulum
// about that anchor: θ'' = -(g/L)·sinθ - 2(L'/L)·θ', with L reeled in as he comes round. Reeling in is
// what makes him speed up at the bottom and what pulls him onto the ledge instead of past it.
const SPIDEY = {
  away: 62,          // seconds off-screen between passes
  thwip: 150,          // metres a second the thread travels, so a long shot visibly takes longer
  clasp: 0.22,         // the beat after it bites, before he leans out and goes
  // The block's distances are squeezed (see the map), so a true 9.81 against a hundred-metre rope gives
  // a twenty-second period and he just sinks. Gravity is scaled to put the swing back on the clock the
  // geometry implies; the equation of motion, and so the shape of the arc, is unchanged.
  grav: 34,
  vmax: 27,            // metres per second along the arc, so the reel-in cannot fling him
  // Metres the *rope end* must stay above anything he crosses, so it has to be at least HAND * SCALE
  // — the distance his feet hang below it — plus a little daylight. Under that the solver clears the
  // rope over a roof and drags him through it.
  clear: 15,
  // Roof corners he perches on, as three points on the same corner, because the web, his feet and his
  // launch all want different ones. `grip` is the parapet corner itself, exactly on the building, and
  // it is where the thread bites — aimed anywhere inside the footprint the last stretch of web
  // disappears into the roof, which is what makes it look like it went through the wall rather than
  // caught the edge. `at` is his origin while he sits, and it is set by where his *hand* has to land,
  // not by his feet: the planted fist is 2.4 m in front of him, so an origin on the corner itself puts
  // the hand in mid-air past the lip. Four metres in sets the fist on the deck a stride inside the
  // parapet with his toes behind it. `edge` is a stride *outside*, the lip he steps off, because
  // starting a swing from inside the footprint drops him through his own roof.
  // `look` is the way he is facing while he sits there, and it is authored per corner rather than
  // derived, because the only thing it has to satisfy is the camera. This view is fixed and almost
  // isometric, and a crouch seen head-on or from behind is a man standing up — the bent knee and the
  // planted arm are only legible in profile. Each of these is the roof direction that projects
  // closest to horizontal on screen *and* points off the building, so he is also looking at something.
  // All three are on the west parapet of the same run of roofs down the avenue, because that is the
  // one line of buildings this camera sees the near face of: a perch on the far side of the street is
  // a figure behind a facade for most of the dwell. The avenue tower first, then two roofs a third of
  // its height, each a block further down.
  // `sit` is where he spends nearly all of the dwell, and it is a different point again: a sit only
  // works if his backside is on the lip and his legs are out over nothing, so it sits a metre inside
  // the parapet along `look` rather than four. He stands up and steps back to `at` for the launch.
  perches: [
    // The far corner of the tall tower, not the near one: from the near corner every swing he makes
    // leaves him behind ninety-six metres of his own building for a third of the arc. Here the outward
    // diagonal happens to be the flat one — it projects to almost exactly screen-left.
    { grip: [18.5, 95.7, 120.7], sit: [19.1, 95.7, 121.3], at: [21.3, 95.7, 123.5], edge: [17.0, 95.7, 119.2], look: [-1, 0, -1], dwell: 15 },
    // On these two the outward diagonal runs down the screen, which is straight at the camera, so he
    // looks out along -x instead: the same lip, read from the side. Sitting, that also means sitting
    // along the x face a couple of metres back from the corner rather than astride it — on the corner
    // itself half of him hangs off the other edge as well.
    { grip: [18.5, 46.2, 24.6], sit: [19.1, 46.2, 22.6], at: [22.0, 46.2, 21.8], edge: [17.0, 46.2, 26.1], look: [-1, 0, 0], dwell: 8.5 },
    { grip: [18.5, 49.5, -41.5], sit: [19.1, 49.5, -43.5], at: [22.0, 49.5, -44.3], edge: [17.0, 49.5, -40.0], look: [-1, 0, 0], dwell: 10 },
  ],
  // Low and well in front of the block, far enough toward the camera to start about a hundred and
  // twenty pixels below the bottom edge: the first web bites the corner of the tall tower and goes up
  // into frame ahead of him, then he comes through the floor of the picture after it, sweeping right
  // as he rises, instead of sliding in from the side. Screen-down here is -x and +z together, so both
  // have to move; the ratio (about 1:1.3) is what keeps the climb under the tower rather than across
  // it. Pushed further out he is off-screen for four seconds of a six-second swing, which is just a
  // long wait for nothing.
  enter: [-140, 95.7, 180],
  // A twenty-five-storey roof just past the left edge, and taller than the roof he leaves from: the
  // last web goes up and out, so he exits rising rather than sinking out of frame. The corner of that
  // roof, not a point beside it — the old value sat a metre and a half clear of the building on both
  // axes, so the last thread of the loop ended in open air.
  leave: [-174.5, 82.5, -115.6],
};

const HAND = 2.0;   // where the web sits in his fist, measured up from his feet
const REACH = 4.6;  // how short the rope is reeled before he catches the ledge by hand
// Knowingly out of scale: a real person across this block is nine pixels of red, which is a smudge.
// Blown up to about two storeys he reads as a figure in a red and blue suit — the webbing on the
// arms, the spider, the eyes — which is the whole point of him. Everything below measures in his own
// units and multiplies by SCALE, so this is the only knob, but it is not an independent one: he
// hangs HAND * SCALE below the end of the rope, so SPIDEY.clear has to cover that or the arc solver
// will happily route his feet through a roof it thinks the rope clears.
const SCALE = 5.4;
// He lets go near the bottom of the arc rather than riding the rope all the way in. Integrating a
// reeling pendulum down to θ = 0 is what produced the whip: the rope is shortest exactly where he is
// fastest, so the last fifth of the arc arrived in two frames and read as a teleport. Letting go at
// TH_LET and sailing the rest is both calmer to watch and what he actually does.
const TH_LET = 0.52, LAND_T = 0.6;
// Seconds at the end of a dwell spent in the raised-arm pose before the thread leaves his hand.
const RISE = 0.35;
// Seconds before that at which he stops looking out over the ledge and starts turning to face where
// he is going. A full turn at TURN_RATE takes about a second, so the turn is finished and settled
// before the arm comes up: body first, then the arm, then the thread. All three at once is a twitch.
const TURN = 1.5, TURN_RATE = 2.6;   // radians per second
// Seconds at the start of a dwell spent coming out of the landing crouch and shuffling to the lip.
const SETTLE = 1.2;
const smooth = (k) => k * k * (3 - 2 * k);
// Rotate a flat facing vector toward `want` by at most `max` radians. A plain lerp between two
// directions slows to nothing as it arrives and shortens the vector on the way; this keeps a constant
// turn rate, which is what makes it read as him looking round rather than as the model being eased.
function turnTo(face, want, max) {
  const a = Math.atan2(face.z, face.x);
  let d = Math.atan2(want.z, want.x) - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const s = a + clamp(d, -max, max);
  face.set(Math.cos(s), 0, Math.sin(s));
}
// A touch of self-light so the suit does not go the same grey as everything else it is lit by.
// applyLook trims it as the block darkens — see the comment there; the number set here is the
// daylight one.
const suitMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.18 });
const spidey = new THREE.Group();
const sitMesh = new THREE.Mesh(SIT_G, suitMat), crouchMesh = new THREE.Mesh(CROUCH_G, suitMat), perchMesh = new THREE.Mesh(PERCH_G, suitMat), swingMesh = new THREE.Mesh(SWING_G, suitMat);
// He casts. A figure on a roof with no shadow floats, and on a corner — where the roof behind him is
// edge-on and the thing behind *that* is a facade a block away — the shadow is the only cue left
// that says which surface he is on. One more caster in the shadow pass, and he is sitting down.
for (const m of [sitMesh, crouchMesh, perchMesh, swingMesh]) m.castShadow = true;
spidey.add(sitMesh, crouchMesh, perchMesh, swingMesh);
// Four poses, one of them at a time. Setting them one by one at each site is how a pose gets left
// on and two of him are drawn inside each other.
const POSES = { sit: sitMesh, crouch: crouchMesh, perch: perchMesh, swing: swingMesh };
function pose(which) { for (const k in POSES) POSES[k].visible = k === which; }
spidey.scale.setScalar(SCALE);
spidey.visible = false;
scene.add(spidey);
// A `THREE.Line` is one pixel wide at any distance, which is what a thread really looks like from
// here and also what makes it disappear on a TV across a room. The web is a five-sided open tube
// instead, scaled along its length each frame, so it has a width that can be chosen.
const webGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
webGeo.translate(0, 0.5, 0);   // base at the origin, so the tube runs 0..1 up +y and scales by length
const WEB_R = 0.15;            // metres of radius: a thread with a width, not a cable slung off a crane
const web = new THREE.Mesh(webGeo, new THREE.MeshBasicMaterial({ color: "#f4f6fb", transparent: true, opacity: 0.85 }));
web.frustumCulled = false; web.visible = false;
scene.add(web);

// Tallest thing standing under a point, so a swing can be made to clear the roofs it crosses. The
// buildings at either end are skipped: he leaves one and comes up the face of the other on purpose.
// The margin is generous because the perches deliberately overhang their parapets: the tower a perch
// belongs to still has to come back from this, or the clearance test will fight the roof he is
// standing on.
function roofUnder(x, z) {
  let hit = null;
  for (const r of roofs) if (x > r.x0 - 5 && x < r.x1 + 5 && z > r.z0 - 5 && z < r.z1 + 5 && (!hit || r.h > hit.h)) hit = r;
  return hit;
}
function heightAt(x, z, skip) {
  let h = 0;
  for (const r of roofs) if (!skip.includes(r) && x > r.x0 - 2 && x < r.x1 + 2 && z > r.z0 - 2 && z < r.z1 + 2 && r.h > h) h = r.h;
  return h;
}
// Clearing the roofs he crosses is not enough: the camera is low and to the south, so a tower can
// stand between him and the lens long after he has cleared it. This is the same test the eye does —
// walk the line of sight back to the camera and see if a block is in the way — as a slab test against
// each building's box.
const NOSKIP = [];
// Design-pixel line below which an arc is considered covered: above the sign cards, and well above
// y 800, where the TV's own app dock starts.
const FLOOR = 620;
function hidden(x, y, z, skip) {
  const dx = camera.position.x - x, dy = camera.position.y - y, dz = camera.position.z - z;
  const far = Math.hypot(dx, dy, dz);
  for (const r of roofs) {
    if (skip.includes(r)) continue;
    let t0 = 1, t1 = far;
    // x slab
    if (Math.abs(dx) < 1e-6) { if (x < r.x0 || x > r.x1) continue; }
    else { const a = (r.x0 - x) / dx * far, b = (r.x1 - x) / dx * far; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
    if (t0 > t1) continue;
    if (Math.abs(dy) < 1e-6) { if (y < 0 || y > r.h) continue; }
    else { const a = (0 - y) / dy * far, b = (r.h - y) / dy * far; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
    if (t0 > t1) continue;
    if (Math.abs(dz) < 1e-6) { if (z < r.z0 || z > r.z1) continue; }
    else { const a = (r.z0 - z) / dz * far, b = (r.z1 - z) / dz * far; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
    if (t0 <= t1) return true;
  }
  return false;
}
// One hop, solved once at start-up: the swing plane, the rope, and how hard he has to reel in to clear
// the block. Bigger `pow` means he hauls himself up sooner, so the arc rides higher.
const probe = new THREE.Vector3();
// `to` is where the thread bites — the parapet corner — and `land` is where he ends up standing, two
// metres in from it. They are a couple of metres apart against a hundred-metre rope, so the arc is the
// same either way; keeping them separate is what lets the web grip the edge while his feet are on the
// roof instead of the other way round.
function hop(from, to, land, floorTest = true) {
  const A = new THREE.Vector3(...to), P = new THREE.Vector3(...from), LAND = new THREE.Vector3(...(land || to));
  const skip = [roofUnder(P.x, P.z), roofUnder(A.x, A.z)].filter(Boolean);
  const u = new THREE.Vector3(P.x - A.x, 0, P.z - A.z);
  const s0 = u.length(); u.divideScalar(s0 || 1);
  const th0 = Math.atan2(s0, -(P.y - A.y));
  const L0 = Math.hypot(s0, P.y - A.y);
  // The rope never reels to nothing: it stops an arm's length short, which is where he catches the
  // ledge. Letting it go to zero is what makes a pendulum snap — all the angular momentum arrives at
  // once — and it also leaves nowhere for him to grab.
  const len = (th, pow) => REACH + (L0 - REACH) * Math.pow(th / th0, pow);
  const at = (th, pow) => {
    const L = len(th, pow);
    return { x: A.x + u.x * L * Math.sin(th), y: A.y - L * Math.cos(th), z: A.z + u.z * L * Math.sin(th) };
  };
  // Only what the viewer can see has to be true: once the arc is past the edge of the frame he may
  // pass through as many blocks as he likes. The roofs at either end are skipped as well — he steps
  // off one and comes up the face of the other on purpose.
  // The arc is picked by trying reel-in rates until one is both clear of the roofs and in plain sight
  // for nearly all of its visible length. A couple of hidden samples are allowed: the first of them is
  // always the moment he drops past the edge of the tower he is leaving, which is not a glitch.
  // Only the stretch he actually flies is scored. He lets go at TH_LET, and everything below that
  // angle lies inside the building he is landing on — scoring it marks a perfectly good arc as hidden
  // for the sake of samples that never happen.
  const i0 = Math.max(2, Math.ceil(TH_LET * 30 / th0));
  let pow = 1.4, best = 1.4, bestBad = 1e9;
  for (const p of [1.4, 1.7, 2, 2.4, 2.9, 3.5, 4.2, 5, 6, 7, 8]) {
    pow = p;
    let bad = 0, ok = true;
    for (let i = i0; i <= 28 && ok; i++) {
      const q = at(th0 * i / 30, p);
      probe.set(q.x, q.y, q.z).project(camera);
      if (Math.abs(probe.x) > 1 || Math.abs(probe.y) > 1) continue;
      if (q.y < heightAt(q.x, q.z, skip) + SPIDEY.clear) { ok = false; break; }
      // No skip list here: the tower he just stepped off is exactly the one most likely to stand in
      // front of him, so it has to be allowed to.
      if (hidden(q.x, q.y, q.z, NOSKIP)) bad++;
      // The bottom of the frame is not empty: the sign cards sit there in the browser and the TV
      // draws its own dock over it. An arc that dips that low is behind something whatever the
      // buildings do, so it counts against the arc exactly as a tower would. Reeling in harder is
      // what lifts the bottom of the swing, which is why the list above runs so far.
      if (floorTest && (1 - probe.y) / 2 * 1080 > FLOOR) bad++;
    }
    if (!ok) continue;
    if (bad < bestBad) { bestBad = bad; best = p; }
    if (bad <= 2) break;
  }
  pow = best;
  return { A, LAND, u, th0, L0, pow, at, len, dlen: (th) => (L0 - REACH) * pow * Math.pow(th / th0, pow - 1) / th0 };
}
// Solved on the first frame rather than here, because the clearance test projects through the camera
// and the camera is not placed on the overview until further down.
let HOPS = null;
function buildHops() {
  // Both tests below ask what the camera can see, so its world matrix has to be current: the hops are
  // solved before the first render, when the overview position has been set but not yet baked in.
  camera.updateMatrixWorld(true);
  HOPS = [];
  const P = SPIDEY.perches;
  // The entrance is the one arc that is meant to cross the bottom of the frame, so the screen-floor
  // test — which exists to keep the other swings above the sign cards and the TV's dock — is off for
  // it. He comes up past the dock rather than being pushed over it.
  HOPS.push(hop(SPIDEY.enter, P[0].grip, P[0].at, false));
  for (let i = 0; i < P.length; i++) {
    const n = P[i + 1];
    HOPS.push(hop(P[i].edge, n ? n.grip : SPIDEY.leave, n ? n.at : SPIDEY.leave));
  }
}

const spid = { phase: "away", t: SPIDEY.away * 0.35, hop: 0, th: 0, w: 0, shoot: 0.3, pos: new THREE.Vector3(), stand: new THREE.Vector3(), from: new THREE.Vector3(), m0: new THREE.Vector3(), face: new THREE.Vector3(1, 0, 0) };
const mx = new THREE.Matrix4(), bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0), rope = new THREE.Vector3(), hand = new THREE.Vector3(), tip = new THREE.Vector3(), tmp = new THREE.Vector3();
const atV = new THREE.Vector3(), sitV = new THREE.Vector3();
function aim(up, fwd) {
  by.copy(up).normalize();
  bx.copy(fwd).addScaledVector(by, -fwd.dot(by));
  if (bx.lengthSq() < 1e-6) bx.set(1, 0, 0).addScaledVector(by, -by.x);
  bx.normalize(); bz.crossVectors(bx, by);
  mx.makeBasis(bx, by, bz);
  spidey.quaternion.setFromRotationMatrix(mx);
}
const webDir = new THREE.Vector3();
function setWeb(from, to) {
  webDir.subVectors(to, from);
  const L = Math.max(webDir.length(), 1e-3);
  web.position.copy(from);
  web.quaternion.setFromUnitVectors(UPV, webDir.divideScalar(L));
  web.scale.set(WEB_R, L, WEB_R);
}
function startHop() {
  const h = HOPS[spid.hop];
  spid.th = h.th0; spid.w = 0;
  const q = h.at(h.th0, h.pow);
  // The swing begins off the lip of the roof, a stride outside where he was standing: he leans out
  // over it while the line is in the air. On the entrance there is nowhere to lean from.
  if (spid.hop > 0) spid.stand.copy(spid.pos); else spid.stand.set(q.x, q.y, q.z);
  spid.pos.set(q.x, q.y, q.z);
  spid.face.subVectors(h.A, spid.pos).setY(0).normalize();
  // A thread that crosses a block takes longer to get there than one that crosses a street. At a
  // fixed duration every shot was the same quarter-second flicker whatever the distance, which is
  // what made the web read as appearing rather than being fired.
  spid.shoot = clamp(spid.pos.distanceTo(h.A) / SPIDEY.thwip, 0.38, 0.9);
  spid.phase = "shoot"; spid.t = 0;
}
function updateSpidey(dt) {
  if (mode === "home") { spidey.visible = web.visible = false; return; }
  if (!HOPS) buildHops();
  spid.t += dt;
  const h = HOPS[spid.hop];
  if (spid.phase === "away") {
    spidey.visible = web.visible = false;
    if (spid.t >= SPIDEY.away) { spid.hop = 0; startHop(); }
    return;
  }
  if (spid.phase === "shoot" || spid.phase === "clasp") {
    // Three beats, because that is how the thing reads as an action rather than a state change.
    // First the reach: the thread grows out of his fist along the line he is pointing, slowly enough
    // that you watch it travel, with a short stretch hanging in the air attached to nothing yet.
    // Then the clasp: it is on the corner, he is still on his roof, and for a fifth of a second
    // nothing moves but the rope going taut. Only then does he lean off the lip and fall into it.
    const shooting = spid.phase === "shoot";
    const k = clamp(spid.t / (shooting ? spid.shoot : SPIDEY.clasp), 0, 1);
    // He holds his ground while the line is out and only leans once it has bitten.
    spidey.position.copy(spid.stand);
    if (!shooting) spidey.position.lerp(spid.pos, k * k * (3 - 2 * k));
    hand.copy(spidey.position).addScaledVector(spid.face, FIST[0] * SCALE);
    hand.y += FIST[1] * SCALE;
    aim(UPV, spid.face);
    pose("perch"); spidey.visible = true;
    web.visible = true;
    // Barely eased: a cubic ease-out spends most of the shot already arrived, which looks like the
    // web snapping on. Nearly constant speed with a little settle at the end is a thread flying.
    const out = shooting ? 1 - Math.pow(1 - k, 1.6) : 1;
    setWeb(hand, tip.copy(hand).lerp(h.A, out));
    if (k >= 1) { spid.phase = shooting ? "clasp" : "swing"; spid.t = 0; }
    return;
  }
  if (spid.phase === "swing") {
    // Substeps: the rope is long and he picks up a lot of speed once it starts coming in.
    const n = 6, sd = dt / n;
    for (let i = 0; i < n && spid.th > TH_LET; i++) {
      const L = h.len(spid.th, h.pow);
      // θ'' = -(g/L)·sinθ - 2(L'/L)·θ'. The second term is the rope coming in: it is what spends the
      // swing's energy on speed and hauls him up the far side instead of letting him hang at the bottom.
      spid.w += (-(SPIDEY.grav / L) * Math.sin(spid.th) - 2 * (h.dlen(spid.th) * spid.w / L) * spid.w) * sd;
      const wmax = SPIDEY.vmax / L;
      spid.w = clamp(spid.w, -wmax, wmax);
      spid.th = Math.max(TH_LET, spid.th + spid.w * sd);
    }
    const q = h.at(spid.th, h.pow);
    spid.pos.set(q.x, q.y, q.z);
    pose("swing"); spidey.visible = true;
    rope.subVectors(h.A, spid.pos);
    // Hanging from the line only makes sense while the line goes *up*. The second hop leaves a
    // ninety-six-metre tower for a fifty-metre roof, so for the first third of that arc the anchor is
    // below him — and orienting his body along the rope then turns him upside down on the way out of
    // the perch, which is the thing that looked broken. Over that stretch he is not swinging, he is
    // dropping with the line already out, so he stays upright and the thread trails down out of his
    // fist to the corner it has bitten. The blend finishes by the time the anchor is fifteen degrees
    // above him, which is around the bottom of the arc, where hanging is what it reads as.
    // `tmp` ends up as his up axis, and the fist sits on that axis at y = HAND, so whatever this
    // chooses the hand stays exactly on the rope end and the thread still leaves his hand.
    tmp.copy(rope).normalize();
    const hang = clamp(tmp.y * 4, 0, 1);
    tmp.multiplyScalar(hang).addScaledVector(UPV, 1 - hang);
    // And while he is dropping he pitches into it. Bolt upright in mid-air is a man in a lift; the
    // dive out of a tall roof in the game leads with the head and trails the legs, and that lean is
    // most of what separates falling with purpose from falling.
    tmp.addScaledVector(spid.face, (1 - hang) * 0.85).normalize();
    spidey.position.copy(spid.pos).addScaledVector(tmp, -HAND * SCALE);
    aim(tmp, spid.face);
    web.visible = true;
    setWeb(spid.pos, h.A);
    if (spid.th <= TH_LET + 0.005) {
      // Let go. The direction he is travelling becomes the start tangent of the toss, so the release
      // is continuous: he keeps dipping for a moment, then the curve carries him up onto the ledge.
      const q0 = h.at(spid.th, h.pow), q1 = h.at(Math.min(h.th0, spid.th + 0.02), h.pow);
      spid.from.copy(spid.pos);
      spid.m0.set(q0.x - q1.x, q0.y - q1.y, q0.z - q1.z).normalize()
        .multiplyScalar(spid.from.distanceTo(h.LAND) * 0.6);
      spid.phase = "land"; spid.t = 0;
    }
    return;
  }
  if (spid.phase === "land") {
    // Off the rope and over the parapet: a Hermite from the release point to the ledge, leaving along
    // the swing and arriving with no speed, which is the hand catching the edge.
    const k = clamp(spid.t / LAND_T, 0, 1), k2 = k * k, k3 = k2 * k;
    spid.pos.copy(spid.from).multiplyScalar(2 * k3 - 3 * k2 + 1)
      .addScaledVector(spid.m0, k3 - 2 * k2 + k)
      .addScaledVector(h.LAND, -2 * k3 + 3 * k2);
    spidey.position.copy(spid.pos);
    aim(UPV, spid.face);
    // He lets go and *sails* before he reaches. Switching to the reaching crouch on the frame the
    // rope drops spends the whole half-second between buildings in a landing pose, which is the one
    // thing the swing never looks like in the game: there the release is the part where he is longest
    // and fastest, arms and legs trailing, and the tuck only happens at the ledge. So the swing pose
    // holds for the first half of the toss and the reach is the second.
    pose(k < 0.52 ? "swing" : "perch"); spidey.visible = true;
    web.visible = k < 0.25;
    if (web.visible) setWeb(spid.pos, h.A);
    if (k >= 1) {
      spid.hop++;
      spid.pos.copy(h.LAND);
      if (spid.hop > SPIDEY.perches.length) { spid.phase = "away"; spid.t = 0; spidey.visible = web.visible = false; return; }
      spid.phase = "perch"; spid.t = 0;
    }
    return;
  }
  // The dwell, in four beats: he comes out of the landing crouch, shuffles to the lip and sits with
  // his legs over it; he sits there for nearly all of it; he gets up and steps back off the edge
  // while turning to the next anchor; the arm goes up. Nothing bobs — he is on a roof, and a figure
  // that drifts up and down on a rooftop is a figure that is not on one.
  const p = SPIDEY.perches[spid.hop - 1];
  const next = HOPS[spid.hop];
  const rise = p.dwell - RISE - TURN;
  // He sits looking out along `look` and only turns to the next anchor when he stands. This is not
  // decoration: the anchors sit nearly dead away from this camera, and a seated figure seen from
  // behind is a shapeless lump. `look` is the one angle at which the hang of the legs and the arm on
  // the knee survive at forty pixels, which is why it is authored per corner and not derived.
  if (spid.t >= rise) tmp.subVectors(next.A, atV.fromArray(p.at));
  else tmp.set(p.look[0], 0, p.look[2]);
  turnTo(spid.face, tmp.setY(0).normalize(), TURN_RATE * dt);
  // Out to the lip and back again. `at` is set by where the crouch's planted fist lands, a stride
  // inside the parapet; `sit` is a metre from it, because a sit is only a sit if the legs are over
  // the drop. Sliding between them is what makes the sit something he does rather than somewhere he
  // appears.
  const k = spid.t < SETTLE ? smooth(spid.t / SETTLE) : 1 - smooth(clamp((spid.t - rise) / TURN, 0, 1));
  spid.pos.copy(atV.fromArray(p.at)).lerp(sitV.fromArray(p.sit), k);
  spidey.position.copy(spid.pos);
  aim(UPV, spid.face);
  // The arm comes up before the thread does, so the shot has a wind-up instead of being a pose
  // change and a thwip on the same frame. The crouch is only the hinge between standing and sitting
  // at either end; the long middle of the dwell is the sit.
  if (spid.t >= p.dwell - RISE) pose("perch");
  else if (spid.t < SETTLE * 0.45 || spid.t >= rise) pose("crouch");
  else pose("sit");
  spidey.visible = true; web.visible = false;
  if (spid.t >= p.dwell) startHop();
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
  const on = homeLamps().filter(isOn).length;
  homeSign.el.innerHTML = `<div class="row"><span class="dot ${on ? "" : "off"}"></span><span class="t">${NAMES.homeLabel}</span></div>`;
  renderMusic();
  renderChip();
  if (poi) renderDetail(now);
}
const v3 = new THREE.Vector3();
function projectSigns() {
  for (const s of signs) {
    // The room labels are pinned to the stand-in model, so they go wherever it goes.
    const show = !s.off && (isInside() ? !s.city && house.visible : s.city && mode === "city" && !flying && s.el !== detailHost);
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
const OVERVIEW = { pos: target.clone().add(PAN).add(dirOf(0.68, 0.79).multiplyScalar(900)), target: target.clone().add(PAN), fov: 13.3 };
const HIGH = { pos: new THREE.Vector3(HX, 70, -62), target: new THREE.Vector3(HX, 6, 12.5), fov: 32 };
const STREET = { pos: new THREE.Vector3(HX, 4.4, -4.5), target: new THREE.Vector3(HX, 3.6, 12.5), fov: 54 };
// Standing on the stoop, looking slightly down at the whole door. It used to be an eye at y 1.9 with the
// door spanning 1.38 to 3.78 — the top half of the leaf out of frame, which read as being very short. The
// eye is above the door's middle now and the aim a touch below it, which with `LIFT` (the frame is pushed
// up 128px to clear the TV's dock) puts the leaf, its glass and the flowers in the middle of the screen.
const DOOR = { pos: new THREE.Vector3(HX, 4.0, 9.0), target: new THREE.Vector3(HX, 3.5, 13.2), fov: 58 };
// A step through the open door into the hall, before the black takes over: the walk in ends by going
// somewhere — the stairs — rather than by stopping dead on the threshold.
const THROUGH = { pos: new THREE.Vector3(HX, 3.3, 12.6), target: new THREE.Vector3(HX, 2.9, 16.4), fov: 62 };
const IN_C = new THREE.Vector3(9.2, 0, 14.3), IN_OFF = new THREE.Vector3(-15.5, 23, 21.5);
// Where the apartment sits in the frame. On its own it belongs in the middle. With the lights drawer taking
// the right of the screen the middle is no longer the middle, so camera and target step sideways together
// along the screen-right of this view (a pan, like the overview's) and it centres in what is left — about
// 215px to the left. `setInsidePan` is the one switch, so whoever knows whether anything covers the frame
// can say so: the browser always opens its drawer, the TV's panel belongs to the app.
const IN_PAN = new THREE.Vector3(4.23, 0, 3.05);
const IN_AT = new THREE.Vector3();
const INSIDE = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 41 };
// Where the apartment is revealed from, coming out of the black. It used to be an eye-level pose just inside
// the door, which continued the walk in — but the apartment is a cutaway with no ceiling, so from down there
// it read as an edge-on slab hanging in an empty sky, and the room labels piled up on one line. So: the same
// angle as the settled view, just closer and wider. The reveal is a step back, and the first frame is already
// the apartment rather than something that looks broken.
const INSIDE_IN = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 58 };
function setInsidePan(panned) {
  IN_AT.copy(HOUSE).add(IN_C); if (panned) IN_AT.add(IN_PAN);
  INSIDE.pos.copy(IN_AT).add(IN_OFF); INSIDE.target.copy(IN_AT);
  INSIDE_IN.pos.copy(IN_AT).add(IN_OFF.clone().multiplyScalar(0.52)); INSIDE_IN.target.copy(IN_AT);
}
setInsidePan(!TV);
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
// `goingIn` is true only for the dive towards the door. `mode` is still the city for most of it, so it
// is the one thing that tells the inward flight apart from the outward one, and it is what lets Back
// turn a mis-press into a there-and-back instead of three seconds you cannot stop.
let mode = "city", flying = false, wantClose = false, goingIn = false;
const cityHud = ["chip", "looks", "wxmarks", "dock", "mock"].map((id) => document.getElementById(id));
/**
 * Everything that is true of the frame while you are inside the home rather than over the block: the
 * studio backdrop behind the model, and `#stage.inside`, which the CSS reads to shrink the clock, drop
 * the weather dateline (it is about the street outside) and show the way back.
 */
function enterInside(on) {
  stage.classList.toggle("inside", on);
  document.querySelector("#clock .place").textContent = on ? NAMES.homeLabel : NAMES.place;
  if (on) scene.background = P.skyTexture("inside", false); else applyLook();
}
// On the TV the app fades the real apartment — the scan, a whole second 3D page — in over this one, on a
// transparent canvas. The model below is only the stand-in for the seconds before that lands, so it steps
// off when it does: left up, it shows straight through the scan, two homes at two angles in one frame. The
// backdrop stays, and the scan fades into it. If the scan is dropped for memory or its renderer dies the
// app says so and the stand-in comes back.
let realHome = false, wantHouse = false;
function showHouse(on) {
  wantHouse = on;
  house.visible = on && !realHome;
  houseAmb.intensity = house.visible ? 0.55 * PI : 0;
}
async function openHome() {
  if (flying || mode !== "city") return;
  flying = true; goingIn = true; cityHud.forEach((e) => e.classList.add("hide"));
  await tween(HIGH, 1300);
  await tween(STREET, 1000);
  await tween(DOOR, 760);
  // Two doors, two beats, because that is how the building is: the green one opens on the vestibule and
  // the frame holds there long enough to read the mailboxes and the white glass door with the basket of
  // flowers on it — then that one opens on the stairs. Slower than the rest of the dive on purpose: this
  // is the moment the eye is meant to stay on something, and it buys the apartment time to be set up.
  await swingDoor(1, 620, "outer");
  await new Promise((r) => setTimeout(r, 420));
  // The black starts while the camera is still moving, so the last thing on screen is the doorway growing
  // dark rather than a frame held against the jamb. It also buys the apartment a beat to be set up behind it.
  const push = tween(THROUGH, 700);
  swingDoor(1, 560, "inner");
  await new Promise((r) => setTimeout(r, 380));
  await Promise.all([push, fade(1)]);
  if (TV) {
    // On the TV the app fades its own apartment in over this page — the real scan, a whole second 3D page.
    // That page can be seconds from ready, and the app drops it whenever it leaves the screen to save
    // memory, so a cold press waits for a full load; if it is lost to memory it never arrives at all.
    // Whatever the page holds in the meantime is therefore the screen, perhaps for good — and it used to
    // hold the door pose, a blurred close-up of the stoop, which read as something having broken.
    //
    // So the page goes inside too, to the same model and the same backdrop as in the browser, and simply
    // does not open the drawer (the app draws its own panel). The room is there the instant the black
    // lifts, the real apartment arrives into the same frame and the same colour a moment later, and if it
    // never arrives the screen is still a finished one.
    showHouse(true);
    enterInside(true);
    setPose(INSIDE);
    renderer.compile(scene, camera);
    mode = "door";
    toNative({ type: "atDoor" });
    await fade(0);
    flying = false; goingIn = false;
    if (wantClose) { wantClose = false; closeHome(); }
    return;
  }
  showHouse(true); mode = "home";
  enterInside(true);
  setPose(INSIDE_IN);
  // Compile the apartment's materials while the screen is still black: the first frame that draws it would
  // otherwise cost a few hundred milliseconds on the TV, and that hitch would land in plain sight.
  renderer.compile(scene, camera);
  // The step back starts under the black and the black lifts into it, so nothing is ever shown standing still.
  const settle = tween(INSIDE, 1100);
  // The drawer slides in on the same beat as the black lifting, so it arrives with the room. It used to
  // open the instant you pressed, which put a page-high panel over the whole dive through the block —
  // an overlay sitting on a street rushing past, which is what made the whole thing look broken.
  drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
  await fade(0);
  await settle;
  flying = false; goingIn = false;
  // On the first room, never on a pill: a TV home screen is shared, and the press that puts the whole
  // flat out should not be the one already under the cursor when the panel arrives.
  focusFirstRoom();
  if (wantClose) { wantClose = false; closeHome(); }
}
async function closeHome() {
  if (flying) { wantClose = true; return; }
  if (mode === "door") {
    // The TV way out: it is inside the home now, not on the doorstep, so it leaves the way the browser
    // does — under the black, back onto the stoop — and only then walks out to the block.
    flying = true;
    await fade(1);
    realHome = false; showHouse(false);
    enterInside(false);
    setPose(THROUGH);
    await fade(0);
    await Promise.all([tween(DOOR, 560), swingDoor(0, 560)]);
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
  realHome = false; showHouse(false); mode = "city";
  enterInside(false);
  // Out the way you came: standing in the open doorway, then back down onto the stoop as the door shuts.
  setPose(THROUGH);
  await fade(0);
  await Promise.all([tween(DOOR, 560), swingDoor(0, 560)]);
  await tween(STREET, 600);
  await tween(OVERVIEW, 1500);
  flying = false; cityHud.forEach((e) => e.classList.remove("hide"));
  chip.focus();
}

// ---------- drawer and remote control
const drawer = document.getElementById("drawer"), roomsEl = document.getElementById("rooms"), chip = document.getElementById("chip");
const statusEl = document.getElementById("status"), hintEl = document.getElementById("hint");
const npEl = document.getElementById("np");

const MOOD_NAME = { relax: "Relax", read: "Read" };
/** A lamp at 1% must not read as off, so the fill has a floor the eye can still see. */
const fill = (d) => (isOn(d) ? Math.max(14, lampLevel(d)) : 0);
/**
 * One cell per lamp, in the order of the rows directly beneath — so the bar on a room row is a legend
 * for its children rather than one number standing in for all of them. A lamp that stopped answering
 * keeps an empty outlined cell: its place in the room is a fact even when its level is not.
 */
const segbar = (ds) => `<span class="segbar">${ds.map((d) => {
  if (!isReachable(d)) return `<span class="cell away"></span>`;
  const sc = inMood(d, MOOD);
  const tick = moodAdjusted(d, MOOD) ? `<b style="left:${HUE_RECIPES[MOOD].brightness}%"></b>` : "";
  return `<span class="cell"><i class="${sc ? "sc" : ""}" style="width:${fill(d)}%"></i>${tick}</span>`;
}).join("")}</span>`;
const pips = (ds) => `<span class="dots">${ds.map((d) =>
  `<span class="pip${isOn(d) ? " on" : ""}${inMood(d, MOOD) ? " sc" : ""}${isReachable(d) ? "" : " away"}"></span>`).join("")}</span>`;

/** "2 of 3 on", never a percentage: one number for several brightnesses would be a lie. */
function roomCount(g) {
  const away = g.devices.length - g.reachable;
  return (g.on ? `${g.on} of ${g.devices.length} on` : "Off") + (away ? ` · ${away} away` : "");
}
function statusLine() {
  const ls = homeLamps(), lit = ls.filter(isOn);
  let s = `${ls.length} light${ls.length === 1 ? "" : "s"} · ${lit.length ? `${lit.length} on` : "everything is off"}`;
  const st = moodStatus(ls, MOOD);
  if (st) {
    const name = MOOD_NAME[st.scene] || st.scene;
    s += !st.inMood ? ` · <b>${name} is armed</b>`
      : st.adjusted ? ` · <b>${name}</b> · ${st.adjusted} adjusted`
      : st.inMood === st.lit ? ` · <b>${name}</b>`
      : ` · <b>${name}</b> on ${st.inMood} of ${st.lit} lit`;
  }
  return s;
}
/** What OK would do to whatever is focused, said before it is pressed. */
function hintLine() {
  const el = document.activeElement, scene = el && el.dataset ? el.dataset.scene : null;
  if (scene === "off") return "OK turns everything off";
  if (scene) return scene === MOOD ? `OK stops ${MOOD_NAME[scene]}. No light changes.` : `OK puts the lights that are on into ${MOOD_NAME[scene]}`;
  if (el && el.classList.contains("roomrow")) return "OK turns the room on or off · ← → dims the room";
  if (el && el.classList.contains("lamprow")) return "OK turns the lamp on or off · ← → dims it";
  if (el && el.classList.contains("npkey")) return "OK drives the music · ← → chooses a key";
  return "↑ ↓ chooses · OK switches · ← → dims";
}

/** The rooms as last drawn, so a focus move can re-dress a row without rebuilding the list. */
const GROUP_BY_ROOM = new Map();

function renderDrawer() {
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
  const groups = roomGroups(homeLamps(), ROOM_ORDER);
  GROUP_BY_ROOM.clear();
  for (const g of groups) GROUP_BY_ROOM.set(g.room, g);
  // A room at rest is its name, what it is doing, and one dot per lamp. Focused, the count leaves and
  // the knob and the per-lamp bar take that space: focus changes the parts, not only the colour.
  roomsEl.innerHTML = groups.map((g) => `<div class="roomgrp">
    <button type="button" class="roomrow" data-kind="room" data-id="${esc(g.room)}" aria-label="${esc(g.label)}" aria-pressed="${g.on > 0}">
      <span class="nm">${esc(g.label)}</span><span class="cnt">${esc(roomCount(g))}</span>
      <span class="knob ${roomPosition(g)}" hidden></span><span class="bars" hidden></span>${pips(g.devices)}
    </button>
    <div class="under"><div class="rail"></div><div class="kids">${g.devices.map((d) => `
      <button type="button" class="lamprow${isReachable(d) ? "" : " away"}" data-kind="lamp" data-id="${esc(d.id)}" aria-pressed="${isOn(d)}">
        <span class="nm">${esc(d.name)}</span><span class="sw${isOn(d) ? " on" : ""}"></span><span class="bars">${segbar([d])}</span>
      </button>`).join("")}</div></div>
  </div>`).join("");
  for (const b of document.querySelectorAll("#scenes [data-scene]")) {
    const armed = b.dataset.scene === MOOD;
    b.classList.toggle("latched", armed);
    b.classList.toggle("live", armed && homeLamps().some((d) => inMood(d, MOOD)));
    b.setAttribute("aria-pressed", String(armed));
  }
  statusEl.innerHTML = statusLine();
  renderNowPlaying();
  if (focused) { const el = roomsEl.querySelector(`[data-id="${CSS.escape(focused)}"]`); if (el) el.focus(); }
  dressFocus();
}

/**
 * The footer: what the home is playing and the keys that drive it. The card stays when the house is
 * silent, naming a room that can be started, so ▶ always has somewhere to go — and the keys a source
 * does not offer are left out rather than drawn dead: a radio station cannot be skipped, and a stream
 * from the TV cannot be paused from here at all.
 */
function renderNowPlaying() {
  const d = playingNow();
  npEl.hidden = !d;
  if (!d) return;
  const m = d.state.media, loaded = mediaLoaded(d), playing = m.state === "playing";
  const rooms = mediaRooms(d);
  const where = rooms.length > 1 ? `${rooms[0]} · ${rooms.length} rooms` : rooms[0];
  npEl.querySelector(".t").textContent = loaded ? `${playing ? "♪" : "❚❚"} ${m.title || "Playing"}` : "Nothing playing";
  npEl.querySelector(".s").textContent = [loaded ? m.artist : "", where, loaded ? m.app : ""].filter(Boolean).join(" · ");
  for (const b of npEl.querySelectorAll(".npkey")) {
    const cmd = b.dataset.np;
    b.hidden = cmd === "playPause" ? !canMedia(d, "playPause") : !loaded || !canMedia(d, cmd);
    if (cmd === "playPause") b.textContent = playing ? "❚❚" : "▶";
  }
}

/**
 * The swap a focused room row makes, done after the HTML rather than in it: the count and the dots are
 * what a room says at rest, the knob and the bar are what it says under the cursor, and only one set is
 * ever in the row. Re-running it on every focus move costs nothing and keeps the two in one place.
 */
function dressFocus() {
  for (const row of roomsEl.querySelectorAll(".roomrow")) {
    const g = GROUP_BY_ROOM.get(row.dataset.id);
    const foc = row === document.activeElement;
    row.querySelector(".cnt").hidden = foc;
    row.querySelector(".dots").hidden = foc;
    row.querySelector(".knob").hidden = !foc;
    const bars = row.querySelector(".bars");
    bars.hidden = !foc;
    if (foc && g) bars.innerHTML = segbar(g.devices);
  }
  hintEl.innerHTML = `${hintLine()}<br>Back returns to the block`;
}
function renderChip() {
  const on = homeLamps().filter(isOn).length;
  document.getElementById("chiptxt").textContent = on ? `Lights · ${on} on` : "Lights · all off";
  document.getElementById("chipdots").innerHTML = ROOMS.map((r) => `<span class="dot ${roomOn(r.id) ? "" : "off"}" title="${esc(r.name)}"></span>`).join("");
}

/**
 * Send an action, and show it at once rather than waiting a round trip — the bridge's echo and then its
 * event both land on the same device and correct anything we guessed wrong.
 */
async function lampAct(d, action, optimistic) {
  const wasOn = isOn(d);
  Object.assign(d.state, optimistic);
  // A lamp switched on while a mood is armed comes up in it. The bridge does that for every client at
  // once; with no bridge behind the block, this page has to do it itself.
  if (!LIVE && MOOD && !wasOn && isOn(d)) Object.assign(d.state, { brightness: HUE_RECIPES[MOOD].brightness, kelvin: HUE_RECIPES[MOOD].kelvin });
  updateLamps();
  if (!LIVE) return;
  const echo = await deviceAction(d.id, action);
  if (echo) { applyDevice(echo); updateLamps(); }
}
const lampToggle = (d) => lampAct(d, { type: "power", on: !isOn(d) }, { on: !isOn(d) });
const lampDim = (d, step) => {
  const b = clamp(lampLevel(d) + step, 1, 100);
  return lampAct(d, { type: "brightness", value: b }, { on: true, brightness: b });
};
const lampById = (id) => DEVICES.get(id);

/**
 * A room press is its lamps pressed together: lit ones go off, otherwise every lamp that answers comes
 * on. There is no room device on the bridge — a room is a name several lamps share — so this is one
 * action each, and the mood follow-up happens per lamp exactly as it would from a single press.
 */
const roomDevices = (room) => { const g = GROUP_BY_ROOM.get(room); return g ? g.devices.filter(isReachable) : []; };
function roomToggle(room) {
  const ds = roomDevices(room), on = ds.some(isOn);
  return Promise.all(ds.map((d) => (isOn(d) === !on ? null : lampAct(d, { type: "power", on: !on }, { on: !on }))));
}
/** Dimming a room moves the lamps that are lit. It is a level control, not a second way to switch on. */
function roomDim(room, step) {
  return Promise.all(roomDevices(room).filter(isOn).map((d) => lampDim(d, step)));
}

const rowAct = (el) => {
  if (el.dataset.kind === "room") return roomToggle(el.dataset.id);
  const d = lampById(el.dataset.id);
  return d ? lampToggle(d) : null;
};
const rowDim = (el, step) => {
  if (el.dataset.kind === "room") return roomDim(el.dataset.id, step);
  const d = lampById(el.dataset.id);
  return d ? lampDim(d, step) : null;
};
roomsEl.addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (b) rowAct(b); });
// The model answers the panel: whatever is focused pulses a ring on the floor under it, and a room
// under the cursor rings every lamp in it at once.
drawer.addEventListener("focusin", (e) => {
  const b = e.target.closest("[data-kind]"), room = b && b.dataset.kind === "room" ? b.dataset.id : null;
  LAMPS.forEach((l) => { l.focus = !!b && (room ? ROOM_NAME.get(l.room) === room : l.did === b.dataset.id); });
  dressFocus();
});
document.getElementById("scenes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-scene]"); if (!b) return;
  pressScene(b.dataset.scene);
});
npEl.addEventListener("click", (e) => { const b = e.target.closest("[data-np]"); if (b) musicCmd(b.dataset.np); });

/**
 * A scene press goes to the bridge, which owns what a scene means and which mood is armed — so a press
 * here and a press on the phone cannot leave the house in two states. Relax and Read never switch a lamp
 * on: they re-tone what is lit and stay armed, so a lamp turned on afterwards comes up in them.
 */
async function pressScene(id) {
  if (LIVE) {
    const snap = await runScene(id);
    if (snap) { MOOD = snap.activeScene ?? null; (snap.devices || []).forEach(applyDevice); updateLamps(); }
    return;
  }
  simulateScene(id);
  updateLamps();
}

/** The same rules, run here, for a block with no bridge behind it. */
function simulateScene(id) {
  if (id === "off") { homeLamps().forEach((d) => { d.state.on = false; }); MOOD = null; return; }
  if (!isMoodScene(id)) return;
  if (MOOD === id) { MOOD = null; return; }
  MOOD = id;
  const recipe = HUE_RECIPES[id];
  homeLamps().filter(isOn).forEach((d) => { d.state.brightness = recipe.brightness; d.state.kelvin = recipe.kelvin; });
}
chip.addEventListener("click", openHome);
document.getElementById("back").addEventListener("click", closeHome);
const apps = [...document.querySelectorAll(".app")];
function focusDrawer(i) { const items = drawerItems(); if (items.length) (items[i] || items[0]).focus(); }
function focusFirstRoom() { const el = roomsEl.querySelector(".roomrow") || drawerItems()[0]; if (el) el.focus(); }
// One column: the pills, then each room followed by its own lamps, then the transport keys under them.
// ↑↓ walks it; there is no second level and nothing to drill into. A key that is not offered is hidden,
// and `:not([hidden])` keeps the walk off it — the row shortens rather than holding a dead stop.
const drawerItems = () => [...drawer.querySelectorAll(".pill, .roomrow, .lamprow, .npkey:not([hidden])")];
/** Buttons that sit side by side, where ←→ walks the row instead of dimming: the pills and the keys. */
const rowmates = (el) => {
  if (!el) return [];
  const cls = el.classList.contains("pill") ? ".pill" : el.classList.contains("npkey") ? ".npkey:not([hidden])" : null;
  return cls ? drawerItems().filter((x) => x.matches(cls)) : [];
};
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
  // Back while the dive is still running. `closeHome` parks it in `wantClose` and `openHome` honours it
  // the moment it lands, so the home arrives and leaves again rather than the press being swallowed.
  if (goingIn) { if (k === "Escape" || k === "Backspace") { e.preventDefault(); closeHome(); } return; }
  if (mode === "home") {
    if (k === "Escape" || k === "Backspace") { e.preventDefault(); closeHome(); return; }
    const items = drawerItems(), i = items.indexOf(document.activeElement);
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      // The pills and the keys are rows, not stops: ↓ off the last lamp lands on one key, not three.
      const edge = (el, end) => { const m = rowmates(el); return m.length ? items.indexOf(m[end ? m.length - 1 : 0]) : items.indexOf(el); };
      let j = clamp(k === "ArrowDown" ? edge(items[i], true) + 1 : edge(items[i], false) - 1, 0, items.length - 1);
      // Arriving in a row lands on its first key, never on the far end — "All off" is not where you want
      // to be standing after one press of ↑.
      j = edge(items[j], false);
      focusDrawer(j);
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      const el = document.activeElement, step = k === "ArrowRight" ? 10 : -10;
      // One rule down the whole column: ←→ dims whatever is focused, a room exactly as a lamp. On the
      // pills and the transport keys, where there is no level, it is how you walk the row.
      if (el && el.dataset && el.dataset.kind) { e.preventDefault(); rowDim(el, step); }
      else {
        const mates = rowmates(el);
        if (mates.length) { e.preventDefault(); focusDrawer(clamp(i + (k === "ArrowRight" ? 1 : -1), items.indexOf(mates[0]), items.indexOf(mates[mates.length - 1]))); }
      }
    }
    return;
  }
  if (mode === "poi") { if (k === "Escape" || k === "Backspace") { e.preventDefault(); zoomOut(); } return; }
  if (mode !== "city" || flying) return;
  // Same ring as the TV: the signs, the Lights chip and the dock tiles are one plane of buttons.
  if (k.startsWith("Arrow")) { e.preventDefault(); if (!sel) select(lastSel || homePoi); else navigate(k); }
  else if (k === "Enter" || k === " ") { if (sel) { e.preventDefault(); enter(sel); } }
});

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
/**
 * A row of marks, built once and then only re-styled: each mark is its own button, so the remote scrolls
 * onto the sky it wants and presses OK there, instead of landing on the row and cycling through it.
 * The nodes have to survive, because they are what the ring holds on to.
 */
function buildRow(el, keys, text) {
  return keys.map((k) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "m"; b.setAttribute("aria-label", text[k]);
    b.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round">${MARK[k]}</svg><i></i><b>${text[k]}</b>`;
    el.appendChild(b);
    return { id: `mark-${k}`, el: b, mark: { key: k, keys } };
  });
}
const MARKS = [...buildRow(looksEl, TODS, TOD_TEXT), ...buildRow(wxMarksEl, WXS, WX_TEXT)];
let markKey = "";
function renderMarks() {
  // Seven small SVGs; restyle them only when something they show has actually changed, not every second.
  const tod = currentTod(), key = `${tod}|${todMode}|${wx}|${wxForced}`;
  if (key === markKey) return;
  markKey = key;
  looksEl.classList.toggle("held", todMode !== "auto");
  wxMarksEl.classList.toggle("held", wxForced);
  for (const m of MARKS) m.el.classList.toggle("on", m.mark.key === (m.mark.keys === TODS ? tod : wx));
}
// Picking a mark pins it. Pinning lasts the session; there is nothing here to put the sky back on auto,
// which is why the dateline grows a dot the moment you do it.
function setMark({ key, keys }) {
  if (keys === TODS) todMode = key;
  else { wx = key; wxForced = true; wxTemp = null; wxLabel = null; }
  syncMock(); applyLook(); tickClock();
}
/** The mock panel is a second face on the same state; keep its pressed buttons honest. */
function syncMock() {
  document.querySelectorAll("[data-tod]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.tod === todMode));
  document.querySelectorAll("[data-wx]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.wx === wx));
}

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
  // Every sky and weather mark is its own stop: you scroll along the rows and press OK on the one you
  // want, and the camera stays where it is. Appended after the signs so POIS[1] stays the house.
  ...MARKS,
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
  if (p.mark) { setMark(p.mark); return; }
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
    const np = loadedNow();
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
  // No LOC guard: the bridge knows where home is and answers without being told, so a page opened with
  // no ?lat= still gets the real weather. LOC only feeds the direct-to-Open-Meteo fallback.
  const c = await fetchWeather(LOC);
  if (!c) return; // keep the last look
  // The sun moves the sky even when the weather is pinned to a mark — pinning RAIN says what is falling,
  // not what hour it is.
  if (c.sun && typeof c.sun.elevation === "number") sunElev = c.sun.elevation;
  if (wxForced) { tickClock(); return; }
  if (c.kind) {
    wxTemp = c.temp; wxLabel = c.label;
    if (c.kind !== wx) { wx = c.kind; applyLook(); }
  }
  tickClock();
}
// Remote control of the music panel: row 0 = the group's transport, rows 1… = a room's volume.
let musicSel = 0, musicRooms = [];
async function sonosAct(id, action) {
  renderNowPlaying();
  const d = await deviceAction(id, action);
  if (d) SPEAKERS.set(d.id, d);
  lastSigns = 0;
  renderNowPlaying();
}
function musicCmd(cmd) {
  // Play reaches a silent room — that is the whole point of keeping its card — but skipping needs
  // something loaded to skip through.
  const np = cmd === "playPause" ? playingNow() : loadedNow();
  if (!np || !canMedia(np, cmd)) return;
  // A silent room has no "other" state to show early: wait for the bridge to say what it started.
  if (cmd === "playPause" && mediaLoaded(np)) np.state.media.state = np.state.media.state === "playing" ? "paused" : "playing";
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
/** The group to show — the same rule the phone and the TV use, so the three cannot name different rooms. */
const playingNow = () => nowPlaying([...SPEAKERS.values()]) || null;
/** …and the one with a track in it, which is all the city's music sign and its card have to say. */
const loadedNow = () => { const d = playingNow(); return d && mediaLoaded(d) ? d : null; };
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
  const np = loadedNow();
  musicSign.off = !np; notesSign.off = !np || np.state.media.state !== "playing";
  if (!np) return;
  const m = np.state.media, rooms = m.group || [np.name];
  const html = `<div class="row">${artImg(m.artworkUrl, 16)}<div><div class="t">${esc(m.title || "Playing")}</div><div class="s">${esc(m.artist || m.app || "")}</div>
    <div class="s src">${m.state === "paused" ? "❚❚ " : "♪ "}${esc(m.app || "Sonos")} · ${rooms.length > 1 ? `${rooms.length} rooms` : esc(rooms[0])}</div></div></div>`;
  if (musicSign.el.innerHTML !== html) musicSign.el.innerHTML = html;
}

// The home's lamps: the bridge's event stream (a snapshot, then one event per change), cookie auth.
/**
 * One device off the bridge. Lamps are kept whole, as the bridge sent them — their colour, their white,
 * their reachability — because that is what the drawer and the windows both read. A light the model has
 * no bulb for still belongs in the panel: the drawer shows the home, not the diorama.
 */
function applyDevice(d) {
  if (!d || !d.id || !d.state) return;
  // By what a device *is*, not who makes it: a HomePod is `airplay` and the mock home's speaker is
  // `mock`, and both were falling through the Sonos test into nothing.
  if (d.kind === "speaker") { SPEAKERS.set(d.id, d); return; }
  if (isLightLike(d)) DEVICES.set(d.id, d);
}
pollTrains(); pollBikes(); pollWeather();
connectDevices(
  (d) => { applyDevice(d); updateLamps(); },
  (snap) => {
    const all = snap.devices || [];
    // The first real snapshot throws the made-up lamps away whole. The home's lights are whatever the
    // bridge says they are — not the six this model happens to have been built with.
    if (!LIVE && all.some(isLightLike)) { LIVE = true; DEVICES.clear(); }
    // Everything, not only the lamps: `applyDevice` is what decides where a device belongs, and it files
    // the speakers. Filtering here first left the music card empty until a speaker happened to change.
    all.forEach(applyDevice);
    MOOD = snap.activeScene ?? null;
    updateLamps();
  },
);
setInterval(pollTrains, 20_000); setInterval(pollBikes, 30_000); setInterval(pollWeather, 10 * 60_000);

// The TV launcher drives the page: Lights opens the home (fly-in), Back closes it, the selected lamp glows.
const toNative = (msg) => { try { if (window.appart3dAndroid) window.appart3dAndroid.postMessage(JSON.stringify(msg)); } catch { /* not in the app */ } };
window.appart3dEmbed = {
  post(cmd) {
    if (!cmd || typeof cmd !== "object") return false;
    // `panel`: the app is sliding its own lights panel over the right of the screen, so the apartment has to
    // step aside for it exactly as it does for this page's own drawer. Without it the middle is the middle.
    if (cmd.type === "openHome") { setInsidePan(!TV || !!cmd.panel); openHome(); return true; }
    if (cmd.type === "closeHome") { closeHome(); return true; }
    if (cmd.type === "realHome") { realHome = !!cmd.on; showHouse(wantHouse); return true; }
    if (cmd.type === "spotlightDevice") { LAMPS.forEach((l) => { l.focus = cmd.deviceId === l.did; }); return true; }
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
  if (h === "door") { flying = true; setPose(DOOR); swingDoor(1, 0, "outer"); cityHud.forEach((e) => e.classList.add("hide")); }
  if (h === "through") { flying = true; setPose(THROUGH); swingDoor(1, 0); cityHud.forEach((e) => e.classList.add("hide")); }
  if (h === "inside") { mode = "home"; showHouse(true); setPose(INSIDE); cityHud.forEach((e) => e.classList.add("hide")); enterInside(true); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); }
}
applyLook(); updateLamps(); applyCam();
setInterval(tickClock, 1000); tickClock();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clockS += dt;
  updateTraffic(dt, clockS, wx === "snow" ? 0.6 : wx === "rain" ? 0.85 : 1);
  updatePeople(dt, clockS, wx);
  updateWeather(dt, clockS, wx);
  updateSnowCover(dt);
  updateSpidey(dt);
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
  for (const l of LAMPS) l.ring.material.opacity = l.focus && isInside() ? 0.55 + Math.sin(now / 180) * 0.35 : 0;
  if (isInside() && !flying) {
    cam.pos.copy(IN_AT).add(IN_OFF.clone().applyAxisAngle(UP, Math.sin(now / 5200) * 0.18));
    cam.target.copy(IN_AT);
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
