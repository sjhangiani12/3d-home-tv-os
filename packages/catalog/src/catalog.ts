import type { ItemMount, ItemCategory, Vec3 } from "@appart3d/scene";
import { MODELS } from "./builders";

export interface CatalogVariant {
  /** Full variant key, e.g. "sofa/modern" (store this in `Item.variant`). */
  key: string;
  /** UI label. */
  label: string;
  /** Overrides the entry's default color when this variant is picked. */
  defaultColor?: string;
  /** Overrides the entry's default dimensions when this variant is picked. */
  defaultDimensions?: Vec3;
  /** Placement note (e.g. how to seat a person on a sofa). */
  placement?: string;
}

export interface CatalogEntry {
  category: ItemCategory;
  /** UI label. */
  label: string;
  group: "Living room" | "Bedroom" | "Kitchen" | "Bathroom" | "Office" | "Decor" | "Misc";
  /** How the item is held by default (see Item.mount). Absent = "floor". */
  mount?: ItemMount;
  defaultDimensions: Vec3;
  defaultColor: string;
  /** Default elevation of the base (e.g. artwork on a wall); usually 0. */
  defaultElevation?: number;
  /** Model variants; the first one is the default. */
  variants?: CatalogVariant[];
  /** Default variant key (same as variants[0].key). */
  defaultVariant?: string;
  /**
   * Placement / usage note for callers. "person": see `PERSON_PRESETS` and the variant notes —
   * sitting variants have their feet on the floor (y = 0) and the seat at ≈ 0.34·h.
   */
  placement?: string;
  /** Free-form `Item.attributes` understood by the builders (name → accepted values). */
  attributes?: Record<string, string>;
}

type BaseEntry = Omit<CatalogEntry, "variants" | "defaultVariant">;

const BASE: BaseEntry[] = [
  // Living room
  { category: "sofa", label: "Sofa", group: "Living room", defaultDimensions: [2.2, 0.85, 0.95], defaultColor: "#5b7fa6" },
  { category: "armchair", label: "Armchair", group: "Living room", defaultDimensions: [0.85, 0.8, 0.85], defaultColor: "#d9824b" },
  { category: "coffeeTable", label: "Coffee table", group: "Living room", defaultDimensions: [1.1, 0.4, 0.6], defaultColor: "#a77b52" },
  { category: "tvStand", label: "TV stand", group: "Living room", defaultDimensions: [1.6, 0.5, 0.42], defaultColor: "#efe7da" },
  { category: "television", label: "TV", group: "Living room", defaultDimensions: [1.25, 0.78, 0.22], defaultColor: "#2f3136", defaultElevation: 0 },
  { category: "fireplace", label: "Fireplace", group: "Living room", defaultDimensions: [1.3, 1.1, 0.4], defaultColor: "#efe6d8" },
  { category: "storage", label: "Storage", group: "Living room", defaultDimensions: [1.2, 0.85, 0.45], defaultColor: "#e8dcc6" },
  { category: "shelf", label: "Bookcase", group: "Living room", defaultDimensions: [0.9, 1.9, 0.32], defaultColor: "#e9dfcf" },
  { category: "stairs", label: "Stairs", group: "Living room", defaultDimensions: [1.0, 2.6, 3.4], defaultColor: "#c99a68" },
  // Bedroom
  { category: "bed", label: "Bed", group: "Bedroom", defaultDimensions: [1.6, 0.95, 2.1], defaultColor: "#9cb89a" },
  { category: "nightstand", label: "Nightstand", group: "Bedroom", defaultDimensions: [0.45, 0.5, 0.4], defaultColor: "#c4935f" },
  { category: "wardrobe", label: "Wardrobe", group: "Bedroom", defaultDimensions: [1.5, 2.1, 0.6], defaultColor: "#efe7da" },
  // Kitchen
  { category: "table", label: "Table", group: "Kitchen", defaultDimensions: [1.6, 0.75, 0.9], defaultColor: "#c4935f" },
  { category: "chair", label: "Chair", group: "Kitchen", defaultDimensions: [0.46, 0.86, 0.5], defaultColor: "#c4935f" },
  { category: "refrigerator", label: "Fridge", group: "Kitchen", defaultDimensions: [0.7, 1.85, 0.68], defaultColor: "#eef1f2" },
  { category: "stove", label: "Stove", group: "Kitchen", defaultDimensions: [0.6, 0.9, 0.6], defaultColor: "#e9ecee" },
  { category: "oven", label: "Oven", group: "Kitchen", defaultDimensions: [0.6, 0.6, 0.58], defaultColor: "#3c3f46" },
  { category: "dishwasher", label: "Dishwasher", group: "Kitchen", defaultDimensions: [0.6, 0.85, 0.6], defaultColor: "#dfe3e6" },
  // Bathroom
  { category: "sink", label: "Sink", group: "Bathroom", defaultDimensions: [0.8, 0.9, 0.5], defaultColor: "#b98a5e" },
  { category: "toilet", label: "Toilet", group: "Bathroom", defaultDimensions: [0.4, 0.8, 0.68], defaultColor: "#f7f8f7" },
  { category: "bathtub", label: "Bathtub", group: "Bathroom", defaultDimensions: [1.7, 0.58, 0.75], defaultColor: "#f7f8f7" },
  { category: "shower", label: "Shower", group: "Bathroom", defaultDimensions: [0.9, 2.0, 0.9], defaultColor: "#f4f6f5" },
  { category: "washerDryer", label: "Washing machine", group: "Bathroom", defaultDimensions: [0.6, 0.85, 0.6], defaultColor: "#f4f5f4" },
  { category: "mirror", label: "Mirror", group: "Bathroom", mount: "wall", defaultDimensions: [0.6, 0.8, 0.03], defaultColor: "#c4935f", defaultElevation: 1.1 },
  // Office
  { category: "desk", label: "Desk", group: "Office", defaultDimensions: [1.3, 0.75, 0.65], defaultColor: "#e9d9bd" },
  // Decor
  { category: "lamp", label: "Lamp", group: "Decor", defaultDimensions: [0.32, 0.5, 0.32], defaultColor: "#d9774f" },
  { category: "floorLamp", label: "Floor lamp", group: "Decor", defaultDimensions: [0.45, 1.6, 0.45], defaultColor: "#3a3a40" },
  { category: "plant", label: "Plant", group: "Decor", defaultDimensions: [0.55, 1.1, 0.55], defaultColor: "#5f9e6e" },
  { category: "rug", label: "Rug", group: "Decor", defaultDimensions: [2.0, 0.015, 1.4], defaultColor: "#d9774f" },
  { category: "artwork", label: "Artwork", group: "Decor", mount: "wall", defaultDimensions: [0.7, 0.5, 0.035], defaultColor: "#b98a5e", defaultElevation: 1.2 },
  // Ceiling pieces: defaultElevation assumes a 2.5 m ceiling (2.5 − height); the web app
  // re-computes it from the actual wall height so the top touches the ceiling.
  { category: "pendantLamp", label: "Pendant lamp", group: "Decor", mount: "ceiling", defaultDimensions: [0.35, 0.9, 0.35], defaultColor: "#c99a5b", defaultElevation: 1.6 },
  { category: "ceilingFan", label: "Ceiling fan", group: "Decor", mount: "ceiling", defaultDimensions: [1.2, 0.4, 1.2], defaultColor: "#b98a5e", defaultElevation: 2.1 },
  { category: "curtain", label: "Curtains", group: "Decor", mount: "wall", defaultDimensions: [1.8, 2.4, 0.14], defaultColor: "#d9a07e", defaultElevation: 0.05 },
  // Misc
  { category: "bicycle", label: "Bicycle", group: "Misc", defaultDimensions: [1.72, 1.0, 0.44], defaultColor: "#d9774f" },
  { category: "bikeDock", label: "Bike dock", group: "Misc", defaultDimensions: [0.3, 0.95, 0.4], defaultColor: "#7c8289" },
  { category: "coatRack", label: "Coat rack", group: "Misc", defaultDimensions: [0.5, 1.8, 0.5], defaultColor: "#b98a5e" },
  { category: "espressoMachine", label: "Espresso machine", group: "Kitchen", defaultDimensions: [0.25, 0.36, 0.42], defaultColor: "#c9cdd1", defaultElevation: 0.9 },
  { category: "coffeeGrinder", label: "Coffee grinder", group: "Kitchen", defaultDimensions: [0.13, 0.38, 0.24], defaultColor: "#2b2b2e", defaultElevation: 0.9 },
  { category: "wallShelf", label: "Wall shelf", group: "Decor", mount: "wall", defaultDimensions: [1.6, 0.45, 0.25], defaultColor: "#dcb88a", defaultElevation: 1.7 },
  { category: "speaker", label: "Speaker", group: "Living room", defaultDimensions: [0.17, 0.28, 0.22], defaultColor: "#232327" },
  { category: "monitor", label: "Monitor", group: "Office", defaultDimensions: [0.62, 0.55, 0.35], defaultColor: "#d9d9dc", defaultElevation: 0.75 },
  { category: "laptop", label: "Laptop", group: "Office", defaultDimensions: [0.31, 0.21, 0.22], defaultColor: "#bfc2c6", defaultElevation: 0.75 },
  {
    category: "person",
    label: "Person",
    group: "Misc",
    defaultDimensions: [0.5, 1.3, 0.75],
    defaultColor: "#d9774f",
    placement:
      "Sitting: feet on the floor (y = 0), seat at ≈ 0.34·h; place with the seat's rotationY, position.y = 0, back of the footprint against the back cushion. Standing: on the floor.",
    attributes: {
      skin: "hex (#f1c7a5)",
      hair: "hex (#4a3428)",
      hairStyle: "short | long | bun",
      top: "hex (t-shirt; default = item.color)",
      bottom: "hex (#3f4a5c)",
      bottomStyle: "pants | shorts | skirt",
      headwear: "none | cap | bandana",
      headwearColor: "hex (#8e8a86)",
      glasses: "none | on-cap | on-shirt",
      glassesColor: "hex (#2b2b2e; light color = mirrored lenses)",
      shoes: "hex (#f4f2ee)",
    },
  },
  { category: "radiator", label: "Radiator", group: "Misc", mount: "wall", defaultDimensions: [0.8, 0.6, 0.1], defaultColor: "#f4f5f4", defaultElevation: 0.1 },
];

export const CATALOG: CatalogEntry[] = BASE.map((e) => {
  const variants: CatalogVariant[] = MODELS[e.category].map((v) => {
    const out: CatalogVariant = { key: v.key, label: v.label };
    if (v.defaultColor) out.defaultColor = v.defaultColor;
    if (v.defaultDimensions) out.defaultDimensions = v.defaultDimensions;
    if (v.placement) out.placement = v.placement;
    return out;
  });
  return { ...e, variants, defaultVariant: variants[0]?.key };
});

const byCategory = new Map(CATALOG.map((e) => [e.category, e] as const));

export function getCatalogEntry(category: ItemCategory): CatalogEntry | undefined {
  return byCategory.get(category);
}
