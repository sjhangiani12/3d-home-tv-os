import { useStore } from "../state/store";
import { CatalogPanel } from "./CatalogPanel";
import { ObjectsPanel } from "./ObjectsPanel";
import { useReviewCount } from "./useAnalysis";
import { IconClose, IconList, IconPlus } from "./icons";

/** Left panel of "Arrange": catalog (add furniture) and objects list (find / check what's there). */
export function LeftPanel() {
  const open = useStore((s) => s.catalogOpen);
  const tab = useStore((s) => s.leftTab);
  const itemCount = useStore((s) => s.scene.items.length);
  const reviewCount = useReviewCount();
  const { setCatalogOpen, openLeft } = useStore.getState();

  if (!open) {
    return (
      <div className="left-fabs">
        <button className="fab fab-primary" onClick={() => openLeft("catalog")}>
          <IconPlus />
          <span>Add furniture</span>
        </button>
        <button className="fab" onClick={() => openLeft("objects")} aria-label={`Objects (${itemCount})`}>
          <IconList />
          <span className="fab-label">Objects</span>
          {reviewCount > 0 && <span className="dot-badge" aria-label={`${reviewCount} to check`}>{reviewCount}</span>}
        </button>
      </div>
    );
  }

  return (
    <aside className="catalog left-panel panel" aria-label={tab === "catalog" ? "Add furniture" : "Objects in the home"}>
      <div className="panel-tabs">
        <div className="tabs" role="tablist" aria-label="Panel">
          <button role="tab" aria-selected={tab === "catalog"} className={tab === "catalog" ? "is-active" : ""} onClick={() => openLeft("catalog")}>
            <IconPlus width={16} height={16} /> Catalog
          </button>
          <button role="tab" aria-selected={tab === "objects"} className={tab === "objects" ? "is-active" : ""} onClick={() => openLeft("objects")}>
            <IconList width={16} height={16} /> Objects
            <span className={`tab-count${reviewCount > 0 ? " tone-amber" : ""}`} title={reviewCount > 0 ? `${reviewCount} to check` : undefined}>
              {reviewCount > 0 ? reviewCount : itemCount}
            </span>
          </button>
        </div>
        <button className="icon-btn ghost" onClick={() => setCatalogOpen(false)} aria-label="Close the panel">
          <IconClose />
        </button>
      </div>
      <div className="panel-body" key={tab}>
        {tab === "catalog" ? <CatalogPanel /> : <ObjectsPanel />}
      </div>
    </aside>
  );
}
