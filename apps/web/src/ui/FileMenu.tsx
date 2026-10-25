import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useStore } from "../state/store";
import { exportScene, loadExample, pickFile, resetToDemo } from "./fileActions";
import { IconChevronDown, IconDownload, IconFilm, IconFolder, IconHelp, IconKeyboard, IconReset, IconScan, IconUpload } from "./icons";

interface Entry {
  icon: ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

/** "File" dropdown: import / example / export, help, reset. */
export function FileMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const setOverlay = useStore((s) => s.setOverlay);

  const groups: Entry[][] = [
    [
      { icon: <IconUpload />, label: "Import scan…", hint: ".appart3d.json or scene — or drag the file in", run: pickFile },
      { icon: <IconScan />, label: "Load sample scan", run: () => void loadExample() },
      { icon: <IconDownload />, label: "Export scene", hint: "Re-importable .json file", run: exportScene },
    ],
    [{ icon: <IconFilm />, label: "Slideshow", hint: "Full-screen automatic tour — P key", run: () => useStore.getState().startSlideshow() }],
    [
      { icon: <IconHelp />, label: "Getting started", run: () => setOverlay("welcome") },
      { icon: <IconKeyboard />, label: "Keyboard shortcuts", hint: "?", run: () => setOverlay("help") },
    ],
    [{ icon: <IconReset />, label: "Reset (demo)", danger: true, run: () => resetToDemo() }],
  ];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    requestAnimationFrame(() => items.current[0]?.focus());
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".menu-trigger")?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = list.length;
      list[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  let idx = 0;
  return (
    <div className="menu-root" ref={root} onKeyDown={onKeyDown}>
      <button className={`menu-trigger${open ? " is-open" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Import, export, help">
        <IconFolder />
        <span className="hide-sm">File</span>
        <IconChevronDown className="chev" width={14} height={14} />
      </button>
      {open && (
        <div className="menu panel" role="menu" aria-label="File">
          {groups.map((g, gi) => (
            <div key={gi} className="menu-group" role="group">
              {g.map((it) => {
                const k = idx++;
                return (
                  <button
                    key={it.label}
                    ref={(el) => {
                      items.current[k] = el;
                    }}
                    role="menuitem"
                    className={`menu-item${it.danger ? " danger" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      it.run();
                    }}
                  >
                    <span className="menu-icon">{it.icon}</span>
                    <span className="menu-text">
                      <span>{it.label}</span>
                      {it.hint && it.hint !== "?" && <small>{it.hint}</small>}
                    </span>
                    {it.hint === "?" && <kbd className="kbd-light">?</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
