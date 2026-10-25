import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getCatalogEntry } from "@appart3d/catalog";
import type { Item } from "@appart3d/scene";
import { useStore, type ObjectFilter } from "../state/store";
import { groupItemsByRoom, itemTitle, matchesQuery, needsReview } from "../state/analysis";
import { useConflicts } from "./useAnalysis";
import { Thumb } from "./Thumb";
import { SearchField } from "./SearchField";
import { IconAlert, IconCheck, IconPlus, IconShieldCheck, IconTrash } from "./icons";

const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

/** Objects tab of the left panel: every item grouped by room, with review / overlap filters. */
export function ObjectsPanel() {
  const scene = useStore((s) => s.scene);
  const filter = useStore((s) => s.objectFilter);
  const setFilter = useStore((s) => s.setObjectFilter);
  const selectedId = useStore((s) => s.selectedItemId);
  const conflicts = useConflicts();
  const [query, setQuery] = useState("");

  const reviewCount = useMemo(() => scene.items.filter(needsReview).length, [scene.items]);
  const groups = useMemo(() => {
    const list = scene.items.filter((it) => {
      if (filter === "review" && !needsReview(it)) return false;
      if (filter === "conflicts" && !conflicts.has(it.id)) return false;
      const entry = getCatalogEntry(it.category);
      return matchesQuery(query, it.label, entry?.label, entry?.group);
    });
    return groupItemsByRoom(scene, list);
  }, [scene, filter, conflicts, query]);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  const FILTERS: { key: ObjectFilter; label: string; count: number; tone?: string }[] = [
    { key: "all", label: "All", count: scene.items.length },
    { key: "review", label: "To check", count: reviewCount, tone: "amber" },
    { key: "conflicts", label: "Overlaps", count: conflicts.size, tone: "red" },
  ];

  return (
    <>
      <div className="panel-tools">
        <SearchField value={query} onChange={setQuery} placeholder="Search objects…" label="Search objects" />
        <div className="chips" role="tablist" aria-label="Filter objects">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={`chip-filter${filter === f.key ? " is-active" : ""}${f.tone && f.count > 0 ? ` tone-${f.tone}` : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="chip-count">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="catalog-scroll objects-scroll">
        {filter === "review" && reviewCount > 0 && (
          <div className="callout callout-amber">
            <p>
              <strong>{reviewCount} object{reviewCount > 1 ? "s" : ""} detected with low confidence.</strong> Check {reviewCount > 1 ? "their" : "its"} type and position,
              then mark {reviewCount > 1 ? "them" : "it"} as verified.
            </p>
            <button className="btn btn-sm" onClick={() => verifyAll(scene.items)}>
              <IconCheck /> Mark all as verified
            </button>
          </div>
        )}
        {filter === "all" && conflicts.size > 0 && !query && (
          <button className="callout callout-red callout-btn" onClick={() => setFilter("conflicts")}>
            <IconAlert />
            <span>
              {conflicts.size} object{conflicts.size > 1 ? "s" : ""} overlap{conflicts.size > 1 ? "" : "s"}. <u>Check the layout</u>
            </span>
          </button>
        )}

        {shown === 0 ? (
          <EmptyObjects filter={filter} hasItems={scene.items.length > 0} searching={!!query} />
        ) : (
          groups.map((g) => (
            <section key={g.roomId ?? "none"} className="obj-group" aria-label={g.name}>
              <h3>
                <span>{g.name}</span>
                <span className="obj-count">{g.items.length}</span>
              </h3>
              <ul className="obj-list">
                {g.items.map((it) => (
                  <ObjectRow key={it.id} item={it} selected={it.id === selectedId} conflict={conflicts.has(it.id)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function verifyAll(items: Item[]) {
  const ids = new Set(items.filter(needsReview).map((i) => i.id));
  if (ids.size === 0) return;
  const s = useStore.getState();
  s.edit((d) => {
    for (const it of d.items) if (ids.has(it.id)) it.confidence = 1;
  });
  s.toast(`${ids.size} object${ids.size > 1 ? "s" : ""} marked as verified.`);
}

const ObjectRow = memo(function ObjectRow({ item, selected, conflict }: { item: Item; selected: boolean; conflict: boolean }) {
  const entry = getCatalogEntry(item.category);
  const review = needsReview(item);
  const title = itemTitle(item);
  const s = useStore.getState;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <li
      ref={ref}
      className={`obj-row${selected ? " is-active" : ""}`}
      onMouseEnter={() => s().hoverItem(item.id)}
      onMouseLeave={() => s().hoverItem(null)}
    >
      <button className="obj-main" onClick={() => s().focusItem(item.id)} aria-current={selected || undefined} title="Select and frame">
        <Thumb category={item.category} variant={item.variant} color={item.color ?? entry?.defaultColor} size="sm" />
        <span className="obj-text">
          <span className="obj-title">{title}</span>
          <span className="obj-sub">
            {entry && entry.label !== title ? `${entry.label} · ` : ""}
            {fmt(item.dimensions[0])} × {fmt(item.dimensions[2])} m
          </span>
        </span>
        {review && (
          <span className="badge badge-amber" title={`Detected by the scan (confidence ${Math.round((item.confidence ?? 0) * 100)}%)`}>
            To check
          </span>
        )}
        {conflict && (
          <span className="badge-icon badge-red" title="Overlaps a wall or another object" aria-label="Overlap">
            <IconAlert width={14} height={14} />
          </span>
        )}
      </button>
      <span className="obj-actions">
        {review && (
          <button className="icon-btn ghost ok" onClick={() => s().markVerified(item.id)} aria-label={`Mark "${title}" as verified`} title="Verified">
            <IconCheck width={16} height={16} />
          </button>
        )}
        <button className="icon-btn ghost danger" onClick={() => s().removeItem(item.id)} aria-label={`Delete "${title}"`} title="Delete">
          <IconTrash width={16} height={16} />
        </button>
      </span>
    </li>
  );
});

function EmptyObjects({ filter, hasItems, searching }: { filter: ObjectFilter; hasItems: boolean; searching: boolean }) {
  const { openLeft, setObjectFilter } = useStore.getState();
  if (searching) return <p className="empty empty-pad">No objects match this search.</p>;
  if (!hasItems)
    return (
      <div className="empty-state">
        <p className="empty-title">No objects yet</p>
        <p className="empty">Add your first furniture from the catalog.</p>
        <button className="btn btn-primary" onClick={() => openLeft("catalog")}>
          <IconPlus /> Open the catalog
        </button>
      </div>
    );
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <IconShieldCheck width={26} height={26} />
      </span>
      <p className="empty-title">{filter === "review" ? "Everything is verified" : "No overlaps"}</p>
      <p className="empty">
        {filter === "review" ? "No scanned object needs checking." : "No furniture overlaps or goes through a wall."}
      </p>
      <button className="btn" onClick={() => setObjectFilter("all")}>
        Show all objects
      </button>
    </div>
  );
}
