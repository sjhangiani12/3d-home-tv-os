import { useEffect, useRef, useState, type ReactNode } from "react";
import { STORAGE_KEY, useStore } from "../state/store";
import { importFile, loadExample, pickFile } from "./fileActions";
import { Thumb } from "./Thumb";
import { IconArrowRight, IconChevronDown, IconClose, IconPhone, IconScan, IconSofa, IconUpload } from "./icons";

const WELCOME_KEY = "appart3d:welcome:v1";

/** First visit = never dismissed the welcome sheet and no saved work. Storage errors → don't nag. */
export function shouldShowWelcome(): boolean {
  try {
    const ls = window.localStorage;
    return !ls.getItem(WELCOME_KEY) && !ls.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

function rememberWelcome() {
  try {
    window.localStorage.setItem(WELCOME_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Modal shell: backdrop, focus trap-lite (focus first control, Esc handled globally), restore focus. */
function Modal({ label, className, onClose, children }: { label: string; className?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus], button")?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal panel ${className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const f = [...(ref.current?.querySelectorAll<HTMLElement>("button, a[href], input, summary") ?? [])].filter((el) => !el.hasAttribute("disabled"));
          if (f.length === 0) return;
          const first = f[0]!;
          const last = f[f.length - 1]!;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Overlays() {
  const overlay = useStore((s) => s.overlay);
  const close = () => {
    if (overlay === "welcome") rememberWelcome();
    useStore.getState().setOverlay(null);
  };
  return (
    <>
      {overlay === "welcome" && <WelcomeSheet onClose={close} />}
      {overlay === "help" && <HelpOverlay onClose={close} />}
      <DropOverlay />
    </>
  );
}

/* ---------- Welcome ---------- */

function WelcomeSheet({ onClose }: { onClose: () => void }) {
  const [howTo, setHowTo] = useState(false);
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal label="Welcome to Appart3D" className="welcome" onClose={onClose}>
      <button className="icon-btn ghost modal-close" onClick={onClose} aria-label="Close">
        <IconClose />
      </button>
      <div className="welcome-hero" aria-hidden>
        <HouseIllustration />
      </div>
      <div className="welcome-body">
        <p className="eyebrow">Welcome</p>
        <h2>Your home, as a 3D model</h2>
        <p className="lead">Scan your rooms with an iPhone, then arrange them here: move furniture, try colors and take nice photos.</p>

        <div className="welcome-actions">
          <button className="action-card is-primary" data-autofocus onClick={act(() => useStore.getState().setMode("arrange"))}>
            <span className="action-icon">
              <IconSofa />
            </span>
            <span className="action-text">
              <strong>Explore the demo apartment</strong>
              <small>A furnished one-bedroom, ready to arrange</small>
            </span>
            <IconArrowRight className="action-go" />
          </button>
          <button className="action-card" onClick={act(() => void loadExample())}>
            <span className="action-icon">
              <IconScan />
            </span>
            <span className="action-text">
              <strong>Load the sample scan</strong>
              <small>A real RoomPlan scan, to see the result</small>
            </span>
            <IconArrowRight className="action-go" />
          </button>
          <button className="action-card" onClick={act(pickFile)}>
            <span className="action-icon">
              <IconUpload />
            </span>
            <span className="action-text">
              <strong>Import my iPhone scan</strong>
              <small>An .appart3d.json file, or drag it into the window</small>
            </span>
            <IconArrowRight className="action-go" />
          </button>
        </div>

        <div className={`howto${howTo ? " is-open" : ""}`}>
          <button className="howto-toggle" aria-expanded={howTo} onClick={() => setHowTo(!howTo)}>
            <IconPhone width={16} height={16} /> How do I scan my home?
            <IconChevronDown className="chev" width={14} height={14} />
          </button>
          {howTo && (
            <ol className="howto-steps">
              <li>
                Open the <strong>Appart3D</strong> app on an iPhone or iPad with LiDAR (Pro models).
              </li>
              <li>Scan each room. Sweep slowly across the walls, doors, windows and furniture.</li>
              <li>
                Export the <code>.appart3d.json</code> file (AirDrop, Files, email…).
              </li>
              <li>Import it here, or drop it anywhere in the window.</li>
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

function HouseIllustration() {
  // A little still life made of real catalog models (thumbnails fall back to tinted blocks).
  return (
    <div className="hero-models">
      <span className="hero-floor" />
      <span className="hm hm-1">
        <Thumb category="plant" color="#5f9e6e" size="lg" />
      </span>
      <span className="hm hm-2">
        <Thumb category="sofa" color="#5b7fa6" size="lg" />
      </span>
      <span className="hm hm-3">
        <Thumb category="armchair" color="#d9824b" size="lg" />
      </span>
    </div>
  );
}

/* ---------- Keyboard shortcuts ---------- */

const SHORTCUTS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "General",
    rows: [
      [["1"], "Navigate"],
      [["2"], "Arrange"],
      [["3"], "Rooms"],
      [["4"], "Photo"],
      [["Ctrl", "+", "Z"], "Undo"],
      [["Ctrl", "+", "Shift", "+", "Z"], "Redo"],
      [["?"], "Show this help"],
      [["Esc"], "Deselect / close"],
    ],
  },
  {
    title: "View",
    rows: [
      [["Drag"], "Orbit"],
      [["Right-click"], "Pan the view"],
      [["Scroll"], "Zoom"],
      [["Arrows", "/", "WASD"], "Move around"],
      [["Q", "/", "E"], "Rotate 45°"],
      [["0"], "Overview"],
      [["M"], "Low / full walls"],
      [["N"], "Day / night"],
      [["P"], "Slideshow (Esc to exit)"],
      [["Double-click"], "Frame a room"],
    ],
  },
  {
    title: "Arrange",
    rows: [
      [["Drag"], "Move a piece of furniture"],
      [["Alt"], "No snapping"],
      [["R"], "Rotate 15°"],
      [["Shift", "+", "R"], "Rotate −15°"],
      [["F"], "Frame the furniture"],
      [["Ctrl", "+", "D"], "Duplicate"],
      [["Delete"], "Delete"],
    ],
  },
];

function HelpOverlay({ onClose }: { onClose: () => void }) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <Modal label="Keyboard shortcuts" className="help" onClose={onClose}>
      <div className="modal-head">
        <h2>Keyboard shortcuts</h2>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>
      <div className="help-grid">
        {SHORTCUTS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.rows.map(([keys, what]) => (
                <div key={what} className="help-row">
                  <dt>
                    {keys.map((k, i) =>
                      k === "+" || k === "/" ? (
                        <span key={i} className="plus">
                          {k}
                        </span>
                      ) : (
                        <kbd key={i} className="kbd-light">
                          {mac && k === "Ctrl" ? "⌘" : k}
                        </kbd>
                      ),
                    )}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- Drag & drop a file anywhere ---------- */

function hasFiles(e: DragEvent) {
  return !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
}

function DropOverlay() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setActive(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        const s = useStore.getState();
        if (s.overlay === "welcome") {
          rememberWelcome();
          s.setOverlay(null);
        }
        void importFile(file);
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  if (!active) return null;
  return (
    <div className="drop-overlay" aria-live="assertive">
      <div className="drop-card">
        <span className="drop-icon">
          <IconUpload width={30} height={30} />
        </span>
        <strong>Drop your file here</strong>
        <span>iPhone scan (.appart3d.json) or exported Appart3D scene</span>
      </div>
    </div>
  );
}
