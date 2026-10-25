/**
 * Citi Bike docks, live, in a night-map style (think tiny.london): the two stations nearest home, one still
 * bird's-eye view each of a 10-dock row. White e-bikes fill the docks first, blue classic bikes the rest;
 * with fewer than 10 bikes the row shows the real numbers and empty docks. Counts come from the bridge (`/citibike.json`), every 30 s.
 *
 * URL options: `?lite=1` (no shadows), `?maxDpr=1`, `?aa=0` — same as the embedded home view.
 */
import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { FurnitureModel } from "@appart3d/catalog";
import type { Item, ItemCategory, Vec3 } from "@appart3d/scene";

interface Station {
  id: string;
  name: string;
  capacity: number;
  distanceM: number | null;
  classic: number;
  ebikes: number;
  bikesDisabled: number;
  docks: number;
  docksDisabled: number;
  lastReported: number | null;
}

const params = new URLSearchParams(location.search);
const LITE = params.get("lite") === "1";
const MAX_DPR = Math.max(0.5, Math.min(3, Number(params.get("maxDpr")) || 2));
const AA = params.get("aa") !== "0";
/** `?station=<id>`: just that station; `?card=1`: only the dock and its bikes, on a transparent background (TV). */
const ONLY = params.get("station");
const CARD = params.get("card") === "1";

const DOCKS = 10; // docks drawn per station
const PITCH = 0.75; // meters between docks
const POST_Z = 0.62; // dock posts stand at the bikes' front wheels, on the sidewalk side
const POST_X = 0.2;
const REFRESH_MS = 30_000;
const CITI_BLUE = "#2f6df0";
const EBIKE_WHITE = "#eef1f6";

/** Camera: high and angled, the dock running diagonally across the view. */
/** Bird's-eye camera, turned a little so the bikes' frames (and their colour) show. */
const AZIMUTH = 0; // rad, around Y: 0 = square to the dock, so the rail runs level (parallel to the TV app row)
const ELEVATION = 0.95; // rad above the horizon

/** Night map palette. */
const NIGHT = {
  bg: "#0d1226",
  sidewalk: "#28304f",
  curb: "#3a4470",
  bikeLane: "#1d3b3a",
  road: "#161c34",
  marking: "#56618f",
  plate: "#3a4366",
  building: "#252d4c",
  roof: "#2f3a62",
  window: "#ffd58a",
  leaves: "#1f4637",
  trunk: "#3a3240",
};

/* ------------------------------------------------------------------ data */

function useStations(): { stations: Station[]; error: string | null; updatedAt: number } {
  const [state, setState] = useState<{ stations: Station[]; error: string | null; updatedAt: number }>({ stations: [], error: null, updatedAt: 0 });
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/citibike.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Error ${r.status}`))))
        .then((j: { stations: Station[] }) => alive && setState({ stations: j.stations, error: null, updatedAt: Date.now() }))
        .catch((e: unknown) => alive && setState((s) => ({ ...s, error: e instanceof Error ? e.message : "No data" })));
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return state;
}

/* ------------------------------------------------------------------ 3D */

function item(id: string, category: ItemCategory, variant: string, dimensions: Vec3, color: string, attributes?: Record<string, string>): Item {
  return { id, category, variant, position: [0, 0, 0], rotationY: 0, dimensions, color, source: "user", attributes };
}

const BIKE = item("bike", "bicycle", "bicycle/citibike", [1.75, 1.05, 0.6], CITI_BLUE);
const EBIKE = item("ebike", "bicycle", "bicycle/citibike-e", [1.75, 1.05, 0.6], EBIKE_WHITE);
const POST = item("post", "bikeDock", "bikeDock/citibike", [0.26, 0.95, 0.36], "#8a92a8", { light: "green" });

type Slot = "ebike" | "classic" | "empty";

/**
 * The 10 docks drawn for a station. With 10+ bikes every dock is full, e-bikes first (10 e-bikes = all
 * e-bikes), classic bikes filling the rest. Below 10 bikes it shows the real numbers, the rest empty.
 */
function docksFor(s: Station): Slot[] {
  const e = Math.min(s.ebikes, DOCKS);
  const c = Math.min(s.classic, DOCKS - e);
  return [...Array<Slot>(e).fill("ebike"), ...Array<Slot>(c).fill("classic"), ...Array<Slot>(DOCKS - e - c).fill("empty")];
}

/** Deterministic pseudo-random numbers, so the street looks the same on every refresh. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function Plane({ x, z, w, d, color, y = 0 }: { x: number; z: number; w: number; d: number; color: string; y?: number }) {
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

/**
 * The block around the dock: sidewalk (camera side), the dock plate, a green bike lane, the road with
 * lane markings, the far sidewalk with trees, and a row of buildings with lit windows.
 */
function Street({ center, span, seed }: { center: number; span: number; seed: number }) {
  const W = span * 3 + 40;
  const rand = useMemo(() => seeded(seed), [seed]);
  const buildings = useMemo(() => {
    const out: { x: number; w: number; d: number; h: number }[] = [];
    let x = center - W / 2;
    while (x < center + W / 2) {
      const w = 4 + rand() * 7;
      out.push({ x: x + w / 2, w: w - 0.25, d: 8 + rand() * 6, h: 8 + rand() * 22 });
      x += w;
    }
    return out;
  }, [center, W, rand]);
  const BACK = -11.7; // building fronts
  const windows = useMemo(() => {
    const m: THREE.Matrix4[] = [];
    for (const b of buildings)
      for (let y = 2; y < b.h - 1; y += 2.6)
        for (let x = b.x - b.w / 2 + 1; x < b.x + b.w / 2 - 0.8; x += 1.6)
          if (rand() < 0.38) m.push(new THREE.Matrix4().makeTranslation(x, y, BACK + 0.02));
    return m;
  }, [buildings, rand]);
  const trees = useMemo(() => Array.from({ length: Math.ceil(W / 7) }, (_, i) => center - W / 2 + i * 7 + rand() * 2), [center, W, rand]);
  const winRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = winRef.current;
    if (!mesh) return;
    windows.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [windows]);

  return (
    <group>
      <Plane x={center} z={15} w={W} d={30} color={NIGHT.sidewalk} y={-0.01} />
      <Plane x={center} z={-0.75} w={W} d={0.25} color={NIGHT.curb} y={0.005} />
      <Plane x={center} z={-1.9} w={W} d={2} color={NIGHT.bikeLane} />
      <Plane x={center} z={-6.4} w={W} d={7} color={NIGHT.road} />
      {/* bike lane edge line and dashed center line */}
      <Plane x={center} z={-2.95} w={W} d={0.12} color={NIGHT.marking} y={0.01} />
      {Array.from({ length: Math.ceil(W / 4) }, (_, i) => (
        <Plane key={i} x={center - W / 2 + i * 4} z={-6.4} w={2} d={0.14} color={NIGHT.marking} y={0.01} />
      ))}
      <Plane x={center} z={-10.8} w={W} d={1.8} color={NIGHT.sidewalk} y={-0.01} />
      {trees.map((x, i) => (
        <group key={i} position={[x, 0, -10.5]}>
          <mesh position={[0, 1.1, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.16, 2.2, 6]} />
            <meshLambertMaterial color={NIGHT.trunk} />
          </mesh>
          <mesh position={[0, 3, 0]} castShadow>
            <icosahedronGeometry args={[1.5, 1]} />
            <meshLambertMaterial color={NIGHT.leaves} flatShading />
          </mesh>
        </group>
      ))}
      {buildings.map((b, i) => (
        <group key={i}>
          <mesh position={[b.x, b.h / 2, BACK - b.d / 2]} castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshLambertMaterial color={NIGHT.building} />
          </mesh>
          <mesh position={[b.x, b.h + 0.15, BACK - b.d / 2]}>
            <boxGeometry args={[b.w - 0.4, 0.3, b.d - 0.4]} />
            <meshLambertMaterial color={NIGHT.roof} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={winRef} args={[undefined, undefined, windows.length]} key={windows.length}>
        <planeGeometry args={[0.7, 1.1]} />
        <meshBasicMaterial color={NIGHT.window} />
      </instancedMesh>
    </group>
  );
}

function Dock({ slots }: { slots: Slot[] }) {
  const len = (slots.length - 1) * PITCH;
  return (
    <group>
      <mesh position={[len / 2 + POST_X, 0.02, POST_Z]} receiveShadow>
        <boxGeometry args={[len + 0.8, 0.04, 0.5]} />
        <meshLambertMaterial color={NIGHT.plate} />
      </mesh>
      {slots.map((slot, i) => (
        <group key={i} position={[i * PITCH, 0, 0]}>
          {slot !== "empty" && (
            // docked nose-in: front wheel at the post (+Z), back wheel towards the street
            <group position={[0, 0, POST_Z - 0.62]} rotation={[0, -Math.PI / 2, 0]}>
              <FurnitureModel item={slot === "ebike" ? EBIKE : BIKE} />
            </group>
          )}
          <group position={[POST_X, 0.04, POST_Z]}>
            <FurnitureModel item={POST} />
          </group>
        </group>
      ))}
    </group>
  );
}

/** Fixed bird's-eye view framing the 10-dock row (same framing for every station). */
function Aerial({ center }: { center: number }) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const { width, height } = useThree((s) => s.size);
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    const target = new THREE.Vector3(center, 0.5, 0);
    const dist = 60;
    camera.position.set(
      target.x + Math.sin(AZIMUTH) * Math.cos(ELEVATION) * dist,
      Math.sin(ELEVATION) * dist,
      target.z + Math.cos(AZIMUTH) * Math.cos(ELEVATION) * dist,
    );
    camera.lookAt(target);
    camera.near = 1;
    camera.far = 200;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // fit the dock's bounding box (posts, bikes, plate) on screen, with a margin
    const len = (DOCKS - 1) * PITCH;
    const box = new THREE.Box3(new THREE.Vector3(-0.5, 0, -1), new THREE.Vector3(len + 0.6, 1.1, 1));
    const pts = [0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) =>
      new THREE.Vector3(i ? box.max.x : box.min.x, j ? box.max.y : box.min.y, k ? box.max.z : box.min.z).project(camera))));
    const spanX = ((Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))) / 2) * (camera.right - camera.left);
    const spanY = ((Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))) / 2) * (camera.top - camera.bottom);
    // tight fit: the strip may be only a couple hundred pixels tall
    camera.zoom = Math.min(width / (spanX * 1.03), height / (spanY * 1.08));
    camera.updateProjectionMatrix();
  }, [camera, center, width, height]);
  // A still picture: draw a few times (models and shadows settle), no animation loop at all.
  useEffect(() => {
    const timers = [0, 100, 600].map((ms) => setTimeout(() => advance(performance.now()), ms));
    return () => timers.forEach(clearTimeout);
  });
  return null;
}

function Moonlight({ center }: { center: number }) {
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight("#9fb4ff", 1.5);
    l.castShadow = !LITE;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0005;
    l.shadow.normalBias = 0.03;
    const c = l.shadow.camera;
    c.left = -22;
    c.right = 22;
    c.top = 22;
    c.bottom = -22;
    c.far = 120;
    return l;
  }, []);
  useEffect(() => {
    light.position.set(center - 14, 30, 18);
    light.target.position.set(center, 0, -3);
    light.target.updateMatrixWorld();
  }, [light, center]);
  return (
    <>
      <hemisphereLight args={["#aab8f0", "#1a1f38", 1.5]} />
      <ambientLight color="#3a4680" intensity={0.6} />
      <primitive object={light} />
      <primitive object={light.target} />
      {/* street lamp glow over the dock */}
      <pointLight position={[center, 4, 2]} color="#ffd9a0" intensity={45} distance={16} decay={2} />
    </>
  );
}

function Panel({ station }: { station: Station }) {
  const slots = docksFor(station);
  const center = ((DOCKS - 1) * PITCH) / 2 + POST_X / 2;
  let seed = 0;
  for (const ch of station.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const total = station.ebikes + station.classic;
  return (
    <section className={CARD ? "cb-strip cb-card" : "cb-strip"}>
      {CARD ? null : (
        <header>
          <h2>{station.name}</h2>
          <div className="cb-counts">
            <span className="cb-e"><b>⚡{station.ebikes}</b> e-bikes</span>
            <span className="cb-c"><b>{station.classic}</b> classic</span>
          </div>
          <span className="cb-sub">
            {fmtDistance(station.distanceM)} · {station.docks} empty docks
            {total > DOCKS && ` · showing ${DOCKS} of ${total}`}
          </span>
        </header>
      )}
      <div className="cb-view">
        <Canvas className="cb-canvas" orthographic shadows={!LITE} flat frameloop="never" dpr={[Math.min(1, MAX_DPR), MAX_DPR]} gl={{ antialias: AA, alpha: CARD }}>
          {!CARD && <color attach="background" args={[NIGHT.bg]} />}
          <Aerial center={center} />
          <Moonlight center={center} />
          {!CARD && <Street center={center} span={DOCKS * PITCH} seed={seed} />}
          <Dock slots={slots} />
        </Canvas>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

function fmtDistance(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${m} m away` : `${(m / 1000).toFixed(1)} km away`;
}

function App() {
  const { stations, error, updatedAt } = useStations();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ago = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;
  return (
    <div className="cb">
      {stations.filter((s) => !ONLY || s.id === ONLY).map((s) => (
        <Panel key={s.id} station={s} />
      ))}
      {!CARD && <div className="cb-foot">
        {error ? `Can't reach the home bridge (${error}). Retrying…` : ago !== null ? `Citi Bike · live · updated ${ago < 5 ? "just now" : `${ago}s ago`}` : "Loading…"}
      </div>}
    </div>
  );
}

const css = `
:root { color-scheme: dark; }
html.cb-transparent, html.cb-transparent body, html.cb-transparent #root, html.cb-transparent .cb { background: transparent; }
html, body, #root { margin: 0; height: 100%; background: ${NIGHT.bg}; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8ecff; overflow: hidden; }
/* a compact strip: fits whatever height the page is given (an iframe, a TV panel, a widget) */
.cb { position: fixed; inset: 0; display: flex; flex-direction: row; background: ${NIGHT.bg}; }
@media (max-width: 700px) { .cb { flex-direction: column; } }
.cb-strip { position: relative; flex: 1; min-height: 0; min-width: 0; display: flex; align-items: stretch; overflow: hidden;
  background: ${NIGHT.sidewalk}; border-right: 1px solid rgba(255,255,255,0.06); }
.cb-strip:last-of-type { border-right: 0; }
.cb-strip header { flex: 0 0 auto; display: flex; flex-direction: column; justify-content: center; gap: 2px;
  padding: 0 clamp(10px, 1.6vw, 22px); background: ${NIGHT.bg}; max-width: 42%; }
.cb-strip h2 { margin: 0; font-size: clamp(13px, min(1.5vw, 9vh), 24px); letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-counts { display: flex; gap: 12px; align-items: baseline; font-size: clamp(11px, min(1vw, 6vh), 15px); color: #c9d1f5; white-space: nowrap; }
.cb-counts b { font-size: clamp(16px, min(2vw, 14vh), 32px); margin-right: 4px; font-variant-numeric: tabular-nums; }
.cb-e b { color: ${EBIKE_WHITE}; }
.cb-c b { color: #7fa6ff; }
.cb-sub { font-size: clamp(10px, min(0.85vw, 5vh), 13px); color: #a7b0d8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-view { position: relative; flex: 1; min-width: 0; }
.cb-canvas { position: absolute !important; inset: 0; }
/* TV card: just the dock and its bikes, over whatever is behind the page */
.cb-card { background: transparent; }
.cb-foot { position: fixed; right: 8px; bottom: 4px; font-size: 10px; color: #7d86ad; pointer-events: none; }
`;
if (CARD) document.documentElement.classList.add("cb-transparent");
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
