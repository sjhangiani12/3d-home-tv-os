/** UI labels and name ↔ kind mappings (room names are matched in French and English). */
import type { FloorMaterial, ItemCategory, RoomKind } from "@appart3d/scene";

export const ROOM_KIND_LABEL: Record<RoomKind, string> = {
  living: "Living room",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  toilet: "Toilet",
  hallway: "Hallway",
  office: "Office",
  dining: "Dining room",
  storage: "Storage",
  other: "Room",
};

/** RoomPlan `CapturedRoom.Section.Label` (iOS 17) → RoomKind. `unidentified` → null. */
export function kindFromSectionLabel(label: string): RoomKind | null {
  switch (label) {
    case "livingRoom":
      return "living";
    case "bedroom":
      return "bedroom";
    case "kitchen":
      return "kitchen";
    case "bathroom":
      return "bathroom";
    case "diningRoom":
      return "dining";
    // Not emitted by RoomPlan today, accepted for forward compatibility.
    case "office":
      return "office";
    case "hallway":
    case "entrance":
      return "hallway";
    case "toilet":
    case "restroom":
      return "toilet";
    default:
      return null;
  }
}

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, " ")
    .trim();

const NAME_RULES: [RegExp, RoomKind][] = [
  [/salle a manger|dining/, "dining"],
  [/salle de bains?|salle d eau|\bsdb\b|douche|bath/, "bathroom"],
  [/\bwc\b|toilette|toilet|restroom/, "toilet"],
  [/sejour|salon|living|piece de vie|\bpiece a vivre/, "living"],
  [/chambre|bedroom|\bch\.? ?\d/, "bedroom"],
  [/cuisine|kitchen|kitchenette/, "kitchen"],
  [/entree|entrance|entryway|couloir|hall|degagement|corridor|palier|landing/, "hallway"],
  [/bureau|office/, "office"],
  [/cellier|rangement|dressing|placard|buanderie|storage|closet|pantry|laundry/, "storage"],
];

/** User-provided room name (French or English) → RoomKind, or null when unknown. */
export function kindFromName(name: string): RoomKind | null {
  const n = strip(name);
  for (const [re, kind] of NAME_RULES) if (re.test(n)) return kind;
  return null;
}

export function defaultFloorMaterial(kind: RoomKind): FloorMaterial {
  return kind === "bathroom" || kind === "toilet" || kind === "kitchen" ? "tile" : "wood";
}

export const FLOOR_COLOR: Record<FloorMaterial, string> = {
  wood: "#d9b48a",
  tile: "#e6e9ec",
  carpet: "#cdbfae",
  concrete: "#bdbab4",
};

export const ITEM_LABEL: Partial<Record<ItemCategory, string>> = {
  storage: "Storage",
  refrigerator: "Fridge",
  stove: "Cooktop",
  bed: "Bed",
  sink: "Sink",
  washerDryer: "Washing machine",
  toilet: "Toilet",
  bathtub: "Bathtub",
  oven: "Oven",
  dishwasher: "Dishwasher",
  table: "Table",
  sofa: "Sofa",
  chair: "Chair",
  fireplace: "Fireplace",
  television: "TV",
  stairs: "Stairs",
  wardrobe: "Wardrobe",
  nightstand: "Nightstand",
  coffeeTable: "Coffee table",
  armchair: "Armchair",
  shelf: "Shelf",
  desk: "Desk",
};

/** "3 objects", "1 object" — pluralization of a simple noun phrase. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}
