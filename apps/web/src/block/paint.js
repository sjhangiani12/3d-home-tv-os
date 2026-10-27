/**
 * How the block is painted: a warm hand-mixed palette, windows with soft edges instead of hard pixels,
 * a gradient sky, clouds drifting over the roofs and dragging their shadows across the street, and
 * fireflies that come out when the lamps do.
 */
import * as THREE from "three";

/** Facades: creams, ochres and two dusty blues, the colours a gouache set actually holds. */
export const FAC = [
  "#d8b48a", "#c9a07a", "#e3cba5", "#b98f6b", "#efdcc0", "#f3ead7", "#c8bda6",
  "#e6d9bd", "#a98f74", "#cdc4b0", "#dfae7f", "#9fb9c4", "#bcd0d4", "#e8d6b4",
];

/** The ground: sun-warmed road instead of tar, terracotta roofs, real grass. */
export const BASE = {
  asphalt: "#8e8a7e", sidewalk: "#ded3bb", yard: "#8fae63", roof: "#a8745a", roof2: "#8d9480",
  mark: "#f5efe0", yellow: "#e8c75c", bikeLane: "#7fa86a", trunk: "#6b4f3a", canopy: "#ffffff",
};

export const LOOKS = {
  // Afternoon, painted rather than photographed: a muted, light palette with almost no contrast. The sun
  // is high enough that shadows stay short, and weak enough that the sky does most of the lighting — that
  // soft fill, not the sun, is what keeps a hand-painted day from looking like a rendered noon.
  day: { sky: "#ead9bb", hemiSky: "#f4ecd6", hemiGround: "#937f62", hemiI: 1, sun: "#ffe7bd", sunI: 0.62, az: 244, el: 30, win: 0.3, lamp: 0 },
  // NYC sunset: the sun on the deck, raking the length of the avenues, with the windows and the street
  // lamps already coming up. The violet overhead is what makes the orange at the horizon read as heat.
  dusk: { sky: "#f0a06a", hemiSky: "#ffc08e", hemiGround: "#4a3050", hemiI: 0.74, sun: "#ff8a4a", sunI: 1.05, az: 252, el: 14, win: 0.72, lamp: 0.72 },
  // Cold and blue, so the only warm things left on screen are the lit windows and the street lamps.
  night: { sky: "#1a2142", hemiSky: "#6274b8", hemiGround: "#251d3a", hemiI: 0.78, sun: "#a9bcff", sunI: 0.34, az: 160, el: 50, win: 1, lamp: 1 },
};

/** The colours spelled out inside the material table; set on the materials the block already built. */
export function repaint(M) {
  const set = (mat, c) => mat && mat.color.set(c);
  set(M.glass, "#a8d2dd"); set(M.dock, "#7d7a6e"); set(M.tile, "#f3ead4"); set(M.tileBand, "#4f8f63");
  set(M.platform, "#cabfa8"); set(M.rail, "#4d463c"); set(M.trackbed, "#5c5245");
  set(M.wood, "#9a7850"); set(M.woodRoof, "#7a5c3e"); set(M.stoop, "#c3b298"); set(M.door, "#5a4030");
  set(M.pole, "#5a564c");
  ["#4f8f63", "#c2564a", "#3f6e9e", "#dba94a", "#7f5e96"].forEach((c, i) => set(M.awning[i], c));
}

function rr(g, x, y, w, h, r, color) {
  g.fillStyle = color;
  // roundRect is missing on older TV WebViews; square corners there, the soft filtering hides it.
  if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
  else g.fillRect(x, y, w, h);
}

const LIT = ["#ffd992", "#ffe9bd", "#ffcf7d", "#ffe2ad", "#cfe2ff"];

/** One window, painted: a brushed sill line, a soft pane, sky caught in its top, sometimes a flower box. */
export function paintWindowCell(g, h, x, y, rng, pick) {
  g.fillStyle = "rgba(150,132,104,0.30)"; g.fillRect(x, y, 16, 1);
  const w = x + 4 + (rng() < 0.5 ? 0 : 0.6), t = y + 3;
  rr(g, w, t, 8, 9, 2.5, "#6f8092");
  rr(g, w, t, 8, 3.4, 2, "#9db2c2");
  g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(x + 3.4, y + 12.2, 9.2, 0.9);
  if (rng() < 0.12) { g.fillStyle = "rgba(108,142,96,0.6)"; g.fillRect(w + 0.5, y + 11.6, 7, 1.8); }
  if (rng() < 0.2) rr(h, w, t, 8, 9, 2.5, pick(LIT));
}

/** Paper tooth: specks of warm and dark over the finished facade sheet. */
export function grain(g, size, n) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    g.fillStyle = Math.random() < 0.5 ? "rgba(92,74,52,0.07)" : "rgba(255,248,232,0.09)";
    g.fillRect(x, y, 1, 1);
  }
}

// [overhead, horizon]; the horizon end is each look's `sky`, the overhead end a deeper version of it.
// `inside` is not a sky: the apartment is shown as a model a thousand metres from the block, with nothing
// behind it, and a daytime sky there was a huge pale wash with a floor plan sitting on it — which is what
// made the view read as broken. It gets a studio backdrop instead: warm, dark, even, so the only thing in
// the frame with any detail is the home.
const GRAD = { day: ["#9bbcd0", "#ead9bb"], dusk: ["#4e3f7a", "#ff9d63"], night: ["#0f1838", "#2b3763"], inside: ["#241f31", "#5b4639"] };
const skyCache = new Map();
/** A washed sky: deep overhead, pale at the horizon, greyed when it rains or snows. */
export function skyTexture(tod, wet) {
  const key = `${tod}|${wet}`;
  if (skyCache.has(key)) return skyCache.get(key);
  const c = document.createElement("canvas"); c.width = 4; c.height = 256;
  const g = c.getContext("2d"), [a, b] = GRAD[tod] || GRAD.day;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, a); gr.addColorStop(1, b);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  if (wet) { g.fillStyle = "rgba(125,135,148,0.45)"; g.fillRect(0, 0, 4, 256); }
  const t = new THREE.CanvasTexture(c);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  skyCache.set(key, t); return t;
}

/**
 * Soft blobs, painted white-on-black so the sheet reads as a mask (black hides, white shows) whatever the
 * browser does with canvas alpha. `tile` repeats each blob around the edges so the sheet joins seamlessly.
 */
function blobTexture(size, blobs, rmin, rmax, alpha, tile) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < blobs; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = size * (rmin + Math.random() * (rmax - rmin));
    const offs = tile ? [-size, 0, size] : [0];
    for (const ox of offs) for (const oy of offs) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gr.addColorStop(0.4, `rgba(255,255,255,${alpha * 0.5})`);
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function dotTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,245,200,1)"); gr.addColorStop(0.35, "rgba(255,226,140,0.55)"); gr.addColorStop(1, "rgba(255,210,110,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

const FLIES = 150;

/**
 * The moving parts of the look: a sheet of cloud shadow sliding over the block, a handful of clouds
 * above it, and fireflies. Returns `update(dt, t, lamp)` — `lamp` is the look's lamp amount, 0 by day.
 */
export function createScenery(scene, area) {
  const group = new THREE.Group(); scene.add(group);
  const w = area.x1 - area.x0, d = area.z1 - area.z0, cx = (area.x0 + area.x1) / 2, cz = (area.z0 + area.z1) / 2;

  // Cloud shadow: one big plane just over the road, dark and soft, scrolling slowly.
  const shadowTex = blobTexture(512, 26, 0.09, 0.2, 0.85, true);
  shadowTex.wrapS = shadowTex.wrapT = THREE.RepeatWrapping;
  shadowTex.repeat.set(1.6, 1.4);
  const shadowMat = new THREE.MeshBasicMaterial({ color: "#3d4a5c", alphaMap: shadowTex, transparent: true, opacity: 0.28, depthWrite: false });
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.2, d * 1.2).rotateX(-Math.PI / 2), shadowMat);
  shade.position.set(cx, 0.26, cz); shade.renderOrder = 2; group.add(shade);

  // The clouds themselves, high over the roofs. The camera's lens is long (12°), so a cloud that reads as
  // a wisp on screen is only ~80 m wide; anything bigger swallows the frame.
  const cloudTex = blobTexture(256, 7, 0.14, 0.3, 0.75, false);
  const cloudMat = new THREE.MeshBasicMaterial({ alphaMap: cloudTex, color: "#fffdf6", transparent: true, opacity: 0.6, depthWrite: false });
  const cloudGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const clouds = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(cloudGeo, cloudMat);
    const s = 60 + Math.random() * 55;
    m.scale.set(s, 1, s * 0.8);
    m.position.set(-260 + i * 190 + Math.random() * 80, 140 + Math.random() * 50, -170 + Math.random() * 340);
    m.renderOrder = 4; group.add(m); clouds.push(m);
  }

  // Fireflies: out over the sidewalks once the lamps are on.
  const pos = new Float32Array(FLIES * 3), phase = new Float32Array(FLIES);
  for (let i = 0; i < FLIES; i++) {
    pos.set([-40 + Math.random() * 300, 1 + Math.random() * 6, -120 + Math.random() * 280], i * 3);
    phase[i] = Math.random() * 6.28;
  }
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const flyMat = new THREE.PointsMaterial({ map: dotTexture(), size: 10, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const flies = new THREE.Points(flyGeo, flyMat);
  flies.renderOrder = 5; group.add(flies);

  return function update(dt, t, lamp) {
    shadowTex.offset.x += 0.006 * dt; shadowTex.offset.y += 0.002 * dt;
    // Sunlit by day, barely moonlit at night — a white cloud over a dark block reads as a smudge.
    cloudMat.opacity = 0.6 - lamp * 0.44;
    shadowMat.opacity = 0.28 * (1 - lamp);
    for (const c of clouds) {
      c.position.x += 2.6 * dt;
      if (c.position.x > 500) c.position.x = -500;
    }
    flyMat.opacity = lamp * 0.85;
    flies.visible = flyMat.opacity > 0.01;
    if (!flies.visible) return;
    for (let i = 0; i < FLIES; i++) {
      const o = i * 3, p = phase[i];
      pos[o] += Math.sin(t * 0.5 + p) * 1.6 * dt;
      pos[o + 1] += Math.sin(t * 1.3 + p * 2) * 1.1 * dt;
      pos[o + 2] += Math.cos(t * 0.4 + p) * 1.6 * dt;
    }
    flyGeo.attributes.position.needsUpdate = true;
  };
}
