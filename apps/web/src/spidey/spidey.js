/**
 * A turntable for the neighbour, and nothing else.
 *
 * On the block he is thirty pixels of red crossing a gap between two roofs, which is a terrible place
 * to find out that his wrist has a hole in it. This page is the same geometry and the same light, two
 * metres from the camera, so a seam or a notch is obvious before it goes back into the city.
 *
 * Backface culling is on by default on purpose: a closed body shows nothing through it, so any hole
 * reads as a window into the inside of the far side. Press `b` to draw both sides and the hole closes
 * — that difference is the test.
 */
import * as THREE from "three";
import { PERCH_G, SWING_G } from "../block/figure.js";

const canvas = document.getElementById("gl");
const poseLabel = document.getElementById("pose");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// The block's colour pipeline, or this page is lying about what the suit looks like: no colour
// management, linear output. Under the default sRGB pipeline the red comes out a dusty pink.
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#14161d");

// The same two lights as the block, at the same strengths, because a figure that reads well under a
// studio rig and badly under the block's is a figure that has been fixed for the wrong room.
scene.add(new THREE.HemisphereLight("#cfe6ff", "#6b5a48", 0.62));
const sun = new THREE.DirectionalLight("#fff3dc", 0.85);
sun.position.set(1.4, 2.2, 1.1);
scene.add(sun);
// Not in the block: a dim light from behind the camera's opposite side, so the side facing away is
// not pure silhouette. Shape errors hide in black.
const fill = new THREE.DirectionalLight("#9fb6d8", 0.3);
fill.position.set(-1.6, 0.6, -1.3);
scene.add(fill);

const mat = new THREE.MeshLambertMaterial({
  vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.18,
});

const poses = [{ name: "perch", geo: PERCH_G }, { name: "swing", geo: SWING_G }];
let poseIx = 0;
const figure = new THREE.Mesh(poses[0].geo, mat);
// Both poses are built standing on y=0 in his own units; drop him so the middle of him is the origin
// the camera orbits around.
figure.position.y = -0.8;
scene.add(figure);

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
let yaw = Math.PI * 0.62, pitch = 0.12, dist = 4.6, spin = true;

function place() {
  const cp = Math.cos(pitch);
  camera.position.set(Math.cos(yaw) * cp * dist, Math.sin(pitch) * dist, Math.sin(yaw) * cp * dist);
  camera.lookAt(0, 0, 0);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

let drag = null;
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; spin = false; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointerup", () => { drag = null; });
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag.x) * 0.008;
  pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - drag.y) * 0.006));
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  dist = Math.max(1.2, Math.min(14, dist * (1 + e.deltaY * 0.0012)));
}, { passive: false });

addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    poseIx = (poseIx + 1) % poses.length;
    figure.geometry = poses[poseIx].geo;
    poseLabel.textContent = poses[poseIx].name;
  }
  if (e.key === "r") spin = !spin;
  if (e.key === "w") { mat.wireframe = !mat.wireframe; mat.needsUpdate = true; }
  if (e.key === "b") { mat.side = mat.side === THREE.FrontSide ? THREE.DoubleSide : THREE.FrontSide; mat.needsUpdate = true; }
});

// Debug handles, the same bargain as the block: a browser session can pin the view instead of
// trying to catch a frame.
Object.assign(window, { __view: { set: (y, p, d) => { spin = false; yaw = y; pitch = p; dist = d; }, pose: (i) => { poseIx = i; figure.geometry = poses[i].geo; poseLabel.textContent = poses[i].name; } } });

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (spin) yaw += dt * 0.5;
  place();
  renderer.render(scene, camera);
});
