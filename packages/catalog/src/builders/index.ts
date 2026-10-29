import type { ItemCategory, Vec3 } from "@appart3d/scene";
import type { Build } from "./common";
import * as seat from "./seating";
import * as tab from "./tables";
import * as sto from "./storage";
import * as bedM from "./bed";
import * as kit from "./kitchen";
import * as bath from "./bathroom";
import * as deco from "./decor";
import * as coffee from "./coffee";
import * as disp from "./display";
import * as ex from "./extras";
import * as person from "./person";

export interface VariantDef {
  /** Full key, e.g. "sofa/modern". */
  key: string;
  /** UI label. */
  label: string;
  build: Build;
  /** Placement note for callers (e.g. how to seat a person on a sofa). */
  placement?: string;
  defaultColor?: string;
  defaultDimensions?: Vec3;
}

const SITTING_NOTE =
  "Feet on the floor (y = 0), seat at ≈ 0.34·h (0.44 m for h = 1.30). To seat on a sofa / armchair: same rotationY, position.y = 0, " +
  "back of the footprint (z = -d/2) against the front of the back cushion (knees ≈ d/2 − 0.18 m in front of the center).";

/** Every category's model variants. The first variant is the default. */
export const MODELS: Record<ItemCategory, VariantDef[]> = {
  storage: [
    { key: "storage/cabinet", label: "Low cabinet", build: sto.storageCabinet },
    { key: "storage/kitchen-counter", label: "Kitchen counter", build: sto.storageKitchen, defaultColor: "#9db59a", defaultDimensions: [2.4, 0.9, 0.62] },
    { key: "storage/dresser", label: "Dresser", build: sto.storageDresser, defaultColor: "#c4935f", defaultDimensions: [1.0, 0.85, 0.5] },
    { key: "storage/sideboard", label: "Sideboard", build: sto.storageSideboard, defaultColor: "#5b7fa6", defaultDimensions: [1.6, 0.8, 0.45] },
  ],
  refrigerator: [{ key: "refrigerator/default", label: "Fridge", build: kit.refrigerator }],
  stove: [{ key: "stove/default", label: "Stove", build: kit.stove }],
  bed: [
    { key: "bed/classic", label: "Wooden bed", build: bedM.bedClassic },
    { key: "bed/upholstered", label: "Upholstered bed", build: bedM.bedUpholstered, defaultColor: "#efe4d2" },
    { key: "bed/platform", label: "Platform bed", build: bedM.bedPlatform, defaultColor: "#d99c82", defaultDimensions: [1.6, 0.7, 2.1] },
  ],
  sink: [
    { key: "sink/vanity", label: "Vanity unit", build: kit.sinkVanity },
    { key: "sink/pedestal", label: "Pedestal sink", build: kit.sinkPedestal, defaultColor: "#f4f6f5", defaultDimensions: [0.55, 0.85, 0.45] },
    { key: "sink/kitchen", label: "Kitchen sink", build: kit.sinkKitchen, defaultColor: "#9db59a", defaultDimensions: [1.2, 0.9, 0.62] },
  ],
  washerDryer: [{ key: "washerDryer/default", label: "Washing machine", build: kit.washerDryer }],
  toilet: [{ key: "toilet/default", label: "Toilet", build: bath.toilet }],
  bathtub: [
    { key: "bathtub/built-in", label: "Built-in bathtub", build: bath.bathtubBuiltIn },
    { key: "bathtub/freestanding", label: "Freestanding bathtub", build: bath.bathtubFreestanding, defaultDimensions: [1.6, 0.6, 0.8] },
  ],
  oven: [{ key: "oven/default", label: "Oven", build: kit.oven }],
  dishwasher: [{ key: "dishwasher/default", label: "Dishwasher", build: kit.dishwasher }],
  table: [
    { key: "table/classic", label: "Rectangular table", build: tab.tableClassic },
    { key: "table/round", label: "Round table", build: tab.tableRound, defaultDimensions: [1.1, 0.75, 1.1] },
    { key: "table/trestle", label: "Trestle table", build: tab.tableTrestle, defaultColor: "#e6d3b3", defaultDimensions: [1.8, 0.75, 0.9] },
  ],
  sofa: [
    { key: "sofa/modern", label: "Straight sofa", build: seat.sofaModern },
    { key: "sofa/rounded", label: "Rounded sofa", build: seat.sofaRounded, defaultColor: "#d38a66" },
    { key: "sofa/corner", label: "Corner sofa", build: seat.sofaCorner, defaultColor: "#8fae8b", defaultDimensions: [2.7, 0.85, 1.65] },
  ],
  chair: [
    { key: "chair/wood", label: "Wooden chair", build: seat.chairWood },
    { key: "chair/upholstered", label: "Upholstered chair", build: seat.chairUpholstered, defaultColor: "#e3b55b" },
    { key: "chair/stool", label: "Stool", build: seat.chairStool, defaultColor: "#d9774f", defaultDimensions: [0.38, 0.65, 0.38] },
    { key: "chair/stool-records", label: "Stool with records", build: seat.chairStoolRecords, defaultColor: "#d9774f", defaultDimensions: [0.4, 0.72, 0.4] },
    { key: "chair/office", label: "Office chair", build: seat.chairOffice, defaultColor: "#5b7fa6", defaultDimensions: [0.62, 1.05, 0.62] },
    { key: "chair/office-light", label: "Office chair (light frame)", build: seat.chairOfficeLight, defaultColor: "#6b7350", defaultDimensions: [0.66, 1.08, 0.62] },
  ],
  fireplace: [{ key: "fireplace/default", label: "Fireplace", build: deco.fireplace }],
  television: [{ key: "television/default", label: "TV", build: deco.television }],
  stairs: [{ key: "stairs/straight", label: "Straight stairs", build: deco.stairs }],
  desk: [
    { key: "desk/simple", label: "Simple desk", build: tab.deskSimple },
    { key: "desk/drawers", label: "Desk with drawers", build: tab.deskDrawers, defaultColor: "#c4935f" },
  ],
  wardrobe: [
    { key: "wardrobe/hinged", label: "Hinged wardrobe", build: sto.wardrobeHinged },
    { key: "wardrobe/sliding", label: "Sliding wardrobe", build: sto.wardrobeSliding, defaultDimensions: [2.0, 2.2, 0.65] },
  ],
  shelf: [
    { key: "shelf/bookcase", label: "Bookcase", build: sto.shelfBookcase },
    { key: "shelf/cube", label: "Cube shelf", build: sto.shelfCube, defaultColor: "#f4efe6", defaultDimensions: [1.5, 1.5, 0.39] },
    { key: "shelf/hifi", label: "Hi-fi shelf (books, amp, turntable, clock)", build: disp.shelfHifi, defaultColor: "#1f2023", defaultDimensions: [0.62, 1.5, 0.36] },
  ],
  nightstand: [{ key: "nightstand/default", label: "Nightstand", build: sto.nightstand }],
  tvStand: [{ key: "tvStand/default", label: "TV stand", build: sto.tvStand }],
  lamp: [
    { key: "lamp/classic", label: "Shade lamp", build: deco.lampClassic },
    { key: "lamp/globe", label: "Globe lamp", build: deco.lampGlobe, defaultColor: "#8fae8b", defaultDimensions: [0.3, 0.4, 0.3] },
    { key: "lamp/mushroom", label: "Mushroom lamp", build: deco.lampMushroom, defaultColor: "#e3b55b", defaultDimensions: [0.32, 0.38, 0.32] },
    { key: "lamp/donut", label: "Donut lamp (glass)", build: deco.lampDonut, defaultColor: "#f6e7d2", defaultDimensions: [0.3, 0.32, 0.12] },
    { key: "lamp/donut-wall", label: "Wall donut lamp", build: deco.lampDonutWall, defaultColor: "#f6e7d2", defaultDimensions: [0.3, 0.3, 0.12] },
  ],
  floorLamp: [
    { key: "floorLamp/drum", label: "Floor lamp", build: deco.floorLampDrum },
    { key: "floorLamp/evedal", label: "EVEDAL floor lamp (smoked glass)", build: deco.floorLampEvedal, defaultDimensions: [0.32, 1.5, 0.32] },
    { key: "floorLamp/arc", label: "Arc floor lamp", build: deco.floorLampArc, defaultDimensions: [1.3, 1.9, 0.4] },
    { key: "floorLamp/squiggle", label: "Squiggle floor lamp", build: deco.floorLampSquiggle, defaultColor: "#f3e7d3", defaultDimensions: [0.42, 1.55, 0.3] },
  ],
  plant: [
    { key: "plant/bush", label: "Bushy plant", build: deco.plantBush },
    { key: "plant/leafy", label: "Large-leaf plant", build: deco.plantLeafy, defaultColor: "#4f8f5f", defaultDimensions: [0.8, 0.9, 0.8] },
    { key: "plant/cactus", label: "Cactus", build: deco.plantCactus, defaultColor: "#79a86f", defaultDimensions: [0.3, 0.6, 0.3] },
    { key: "plant/tree", label: "Small tree", build: deco.plantTree, defaultColor: "#6aa36f", defaultDimensions: [0.7, 1.8, 0.7] },
    { key: "plant/trailing", label: "Trailing plant (pothos)", build: deco.plantTrailing, defaultColor: "#5f9e63", defaultDimensions: [0.34, 0.4, 0.34] },
    { key: "plant/hanging", label: "Hanging plant", build: deco.plantHanging, defaultColor: "#5f9e63", defaultDimensions: [0.45, 1.0, 0.45] },
  ],
  rug: [
    { key: "rug/rect", label: "Rectangular rug", build: deco.rugRect },
    { key: "rug/round", label: "Round rug", build: deco.rugRound, defaultColor: "#8fae8b", defaultDimensions: [1.6, 0.015, 1.6] },
    { key: "rug/striped", label: "Striped rug", build: deco.rugStriped, defaultColor: "#5b7fa6" },
  ],
  artwork: [
    { key: "artwork/abstract", label: "Abstract artwork", build: deco.artworkAbstract },
    { key: "artwork/landscape", label: "Landscape", build: deco.artworkLandscape, defaultColor: "#3a3a40" },
    { key: "artwork/photo", label: "Framed photo (real image)", build: deco.artworkPhoto, defaultColor: "#f4f2ee" },
  ],
  mirror: [
    { key: "mirror/rect", label: "Rectangular mirror", build: deco.mirrorRect },
    { key: "mirror/round", label: "Round mirror", build: deco.mirrorRound, defaultDimensions: [0.6, 0.6, 0.03] },
  ],
  armchair: [
    { key: "armchair/club", label: "Club armchair", build: seat.armchairClub },
    { key: "armchair/lounge", label: "Scandinavian armchair", build: seat.armchairLounge, defaultColor: "#8fae8b", defaultDimensions: [0.75, 0.8, 0.8] },
    { key: "armchair/swivel", label: "Swivel armchair", build: seat.armchairSwivel, defaultColor: "#2f7d4f", defaultDimensions: [0.8, 0.74, 0.78] },
  ],
  coffeeTable: [
    { key: "coffeeTable/rect", label: "Coffee table", build: tab.coffeeRect },
    { key: "coffeeTable/round", label: "Round coffee table", build: tab.coffeeRound, defaultDimensions: [0.8, 0.4, 0.8] },
  ],
  shower: [{ key: "shower/default", label: "Shower", build: bath.shower }],
  espressoMachine: [{ key: "espressoMachine/e61", label: "Espresso machine", build: coffee.espressoMachine }],
  coffeeGrinder: [{ key: "coffeeGrinder/single-dose", label: "Coffee grinder", build: coffee.coffeeGrinder }],
  wallShelf: [
    { key: "wallShelf/collection", label: "Shelf with collection", build: disp.wallShelfCollection },
    { key: "wallShelf/plain", label: "Empty shelf", build: disp.wallShelfPlain },
  ],
  speaker: [
    { key: "speaker/bookshelf", label: "Speaker", build: disp.speakerBookshelf },
    { key: "speaker/accent", label: "Speaker (orange cone)", build: disp.speakerAccent },
    { key: "speaker/homepod-mini", label: "HomePod mini", build: disp.speakerHomePodMini, defaultColor: "#4a4d52", defaultDimensions: [0.098, 0.084, 0.098] },
  ],
  monitor: [{ key: "monitor/arm", label: "Monitor on arm", build: disp.monitorArm }],
  laptop: [{ key: "laptop/open", label: "Laptop", build: disp.laptop }],
  bicycle: [
    { key: "bicycle/road", label: "Road bike", build: ex.bicycle },
    { key: "bicycle/citibike", label: "Citi Bike", build: ex.citiBike, defaultColor: "#1f5fd6", defaultDimensions: [1.75, 1.05, 0.6] },
    { key: "bicycle/citibike-e", label: "Citi Bike e-bike", build: ex.citiEBike, defaultColor: "#1f5fd6", defaultDimensions: [1.75, 1.05, 0.6] },
  ],
  bikeDock: [{ key: "bikeDock/citibike", label: "Citi Bike dock", build: ex.bikeDock }],
  coatRack: [
    { key: "coatRack/pole", label: "Standing coat rack", build: ex.coatRackPole },
    { key: "coatRack/hanging", label: "Coat rack with coats", build: ex.coatRackHanging, defaultDimensions: [0.6, 1.8, 0.6] },
    { key: "coatRack/garment", label: "Rolling garment rack", build: ex.coatRackGarment, defaultColor: "#c3c8cc", defaultDimensions: [1.1, 1.75, 0.55] },
  ],
  pendantLamp: [
    { key: "pendantLamp/cage", label: "Rattan pendant", build: ex.pendantCage },
    { key: "pendantLamp/globe", label: "Paper globe pendant", build: ex.pendantGlobe, defaultColor: "#fbeed6", defaultDimensions: [0.4, 0.9, 0.4] },
    { key: "pendantLamp/dome", label: "Dome pendant", build: ex.pendantDome, defaultColor: "#5f8a68", defaultDimensions: [0.38, 0.8, 0.38] },
    { key: "pendantLamp/bulb", label: "Bare bulb", build: ex.pendantBulb, defaultColor: "#c9a25e", defaultDimensions: [0.1, 0.8, 0.1] },
  ],
  ceilingFan: [{ key: "ceilingFan/default", label: "Ceiling fan", build: ex.ceilingFan }],
  radiator: [{ key: "radiator/panel", label: "Column radiator", build: ex.radiator }],
  curtain: [
    { key: "curtain/pair", label: "Pair of curtains", build: ex.curtainPair },
    { key: "curtain/single", label: "Single curtain", build: ex.curtainSingle, defaultDimensions: [1.2, 2.4, 0.14] },
  ],
  person: [
    {
      key: "person/sitting",
      label: "Sitting person",
      build: person.personSitting,
      defaultDimensions: [0.5, 1.3, 0.75],
      placement: SITTING_NOTE,
    },
    { key: "person/standing", label: "Standing person", build: person.personStanding, defaultDimensions: [0.5, 1.75, 0.3] },
    {
      key: "person/sitting-relaxed",
      label: "Relaxed sitting person",
      build: person.personSittingRelaxed,
      defaultDimensions: [0.8, 1.3, 0.8],
      placement: `${SITTING_NOTE} The right arm (+X) rests on the backrest: the body is offset toward -X in the footprint.`,
    },
  ],
};

/** Resolve a variant key ("sofa/modern" or just "modern"); falls back to the default variant. */
export function resolveVariant(category: ItemCategory, variant?: string): VariantDef {
  const list = MODELS[category];
  const fallback = list[0] as VariantDef;
  if (!variant) return fallback;
  const v = variant.includes("/") ? variant : `${category}/${variant}`;
  return list.find((x) => x.key === v) ?? fallback;
}
