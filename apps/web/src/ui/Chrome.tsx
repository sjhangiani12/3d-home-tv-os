import { useStore, type Mode } from "../state/store";
import { cameraBus } from "../state/view";
import { IconCamera, IconClose, IconEye, IconHome, IconKeyboard, IconMoon, IconOrbit, IconRotateLeft, IconRotateRight, IconSun, IconWalls } from "./icons";

/** Day / Night switch (key N). With the sun known (Home mode + bridge): Auto (sun) → Day → Night. */
export function NightToggle({ className = "" }: { className?: string }) {
  const night = useStore((s) => s.night);
  const daylight = useStore((s) => s.daylight);
  const sunKnown = useStore((s) => s.sunElevation !== null && !s.slideshow);
  const auto = sunKnown && daylight === "auto";
  const label = auto ? "Auto" : night ? "Night" : "Day";
  const title = sunKnown
    ? auto
      ? `Follows the sun (${night ? "night" : "day"} right now) — click to force day (N)`
      : night
        ? "Night forced — click to follow the sun (N)"
        : "Day forced — click to force night (N)"
    : night
      ? "Night — click to go back to day (N)"
      : "Day — click to turn on the night lamps (N)";
  return (
    <button
      className={`night-toggle${night ? " is-night" : ""}${auto ? " is-auto" : ""} ${className}`}
      onClick={() => useStore.getState().toggleNight()}
      role={sunKnown ? undefined : "switch"}
      aria-checked={sunKnown ? undefined : night}
      aria-label={sunKnown ? `Lighting: ${auto ? "automatic (sun)" : night ? "night" : "day"}` : "Night version"}
      title={title}
    >
      <span className="nt-knob" aria-hidden>
        {night ? <IconMoon width={14} height={14} /> : <IconSun width={14} height={14} />}
      </span>
      <span className="nt-label">{label}</span>
    </button>
  );
}

/** The 3–4 most useful gestures per mode; everything else lives in the "?" overlay. */
const HINTS: Record<Exclude<Mode, "photo">, [string, string][]> = {
  navigate: [
    ["Drag", "orbit"],
    ["Right-click", "pan"],
    ["Scroll", "zoom"],
    ["Double-click", "frame a room"],
  ],
  arrange: [
    ["Drag", "move furniture"],
    ["R", "rotate"],
    ["Delete", "delete"],
    ["Ctrl+Z", "undo"],
  ],
  home: [
    ["Click a lamp", "turn on / off"],
    ["Drag", "orbit"],
    ["Scroll", "zoom"],
  ],
  rooms: [
    ["Click", "pick a room"],
    ["Double-click", "frame"],
    ["Q / E", "rotate the view"],
  ],
};

export function HintBar() {
  const mode = useStore((s) => s.mode);
  const dragging = useStore((s) => s.dragging);
  const hasSelection = useStore((s) => !!s.selectedItemId);
  if (mode === "photo") return null;
  let hints = HINTS[mode];
  if (dragging) hints = [["Alt", "no snapping"], ["Release", "drop"]];
  else if (mode === "arrange" && !hasSelection) hints = [["Click", "pick furniture"], ["Drag", "move it"], ["Q / E", "rotate the view"]];
  return (
    <footer className="hintbar" aria-label="Quick help">
      {hints.map(([k, v]) => (
        <span key={k} className="hint">
          <kbd>{k}</kbd> {v}
        </span>
      ))}
      {!dragging && (
        <button className="hint-more" onClick={() => useStore.getState().setOverlay("help")} aria-label="All keyboard shortcuts">
          <IconKeyboard width={15} height={15} /> <span>Shortcuts</span> <kbd>?</kbd>
        </button>
      )}
    </footer>
  );
}

/** Floating camera controls (bottom-right): overview, rotate the view, cut walls. */
export function ViewControls() {
  const wallsCut = useStore((s) => s.wallsCut);
  const setWallsCut = useStore((s) => s.setWallsCut);
  return (
    <div className="view-controls panel" role="toolbar" aria-label="View">
      <button className="icon-btn" onClick={() => cameraBus.emit({ type: "rotate", dir: -1 })} title="Rotate view left (Q)" aria-label="Rotate view left">
        <IconRotateLeft />
      </button>
      <button className="icon-btn" onClick={() => cameraBus.emit({ type: "overview" })} title="Overview (0)" aria-label="Overview">
        <IconHome />
      </button>
      <button className="icon-btn" onClick={() => cameraBus.emit({ type: "rotate", dir: 1 })} title="Rotate view right (E)" aria-label="Rotate view right">
        <IconRotateRight />
      </button>
      <span className="vc-sep" />
      <button
        className={`icon-btn toggle${wallsCut ? " is-on" : ""}`}
        onClick={() => setWallsCut(!wallsCut)}
        aria-pressed={wallsCut}
        title={wallsCut ? "Walls lowered on the camera side — click to show them in full (M)" : "Full walls — click to lower the walls on the camera side (M)"}
        aria-label="Lower the walls on the camera side"
      >
        <IconWalls />
      </button>
      <span className="vc-sep" />
      <NightToggle />
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-dot" aria-hidden />
          <span className="toast-text">{t.text}</span>
          <button className="icon-btn ghost" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
            <IconClose width={14} height={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Minimal floating toolbar shown in photo mode (the rest of the UI is hidden). */
export function PhotoBar() {
  const view = useStore((s) => s.photoView);
  const fov = useStore((s) => s.photoFov);
  const { setPhotoView, setPhotoFov, setMode, lastEditMode } = useStore.getState();
  return (
    <div className="photobar panel" role="toolbar" aria-label="Photo mode">
      <div className="segmented" role="radiogroup" aria-label="Viewpoint">
        <button role="radio" aria-checked={view === "orbit"} className={view === "orbit" ? "is-active" : ""} onClick={() => setPhotoView("orbit")}>
          <IconOrbit /> <span>Free view</span>
        </button>
        <button role="radio" aria-checked={view === "eye"} className={view === "eye" ? "is-active" : ""} onClick={() => setPhotoView("eye")}>
          <IconEye /> <span>Eye level</span>
        </button>
      </div>
      <label className="fov">
        <span>Focal length</span>
        <input type="range" min={28} max={85} step={1} value={fov} onChange={(e) => setPhotoFov(Number(e.target.value))} aria-valuetext={`${fov} mm`} />
        <output>{fov} mm</output>
      </label>
      <NightToggle className="on-photobar" />
      <div className="photo-actions">
        <button className="btn btn-primary btn-lg" onClick={() => cameraBus.emit({ type: "capture" })}>
          <IconCamera /> Take photo
        </button>
        <button className="icon-btn bordered" onClick={() => setMode(lastEditMode)} aria-label="Exit photo mode (Esc)" title="Exit (Esc)">
          <IconClose />
        </button>
      </div>
      <p className="photo-hint">{view === "eye" ? "Drag to look around · WASD / arrows to walk" : "Drag to orbit · scroll to zoom"}</p>
    </div>
  );
}
