/**
 * The lamps, as every client has to understand them: what counts as a light, whether one is on, what
 * colour it is showing, which room it belongs under, and what a mood is.
 *
 * This is here rather than in any one app because there are four panels over the same six lamps — the
 * block's drawer, the home view's panel, the TV launcher's, and the bridge's own planner — and each one
 * had grown its own answer. They disagreed: the block invented its own Relax, and lit the living room
 * with it. One model, several renderings.
 *
 * No display strings beyond the room labels: a count reads differently in a 352px row than in a phone
 * list, so each panel writes its own. What must not differ is what is true.
 */
import type { Device } from "./index.ts";

/* ------------------------------------------------------------------ moods */

/**
 * Scenes that stay armed once run. Relax and Read are not commands that fire once: they re-tone the
 * lamps already on, never switch one on, and then stay on as a mode, so a lamp switched on afterwards
 * comes up in them. The bridge holds which one is armed (`HomeSnapshot.activeScene`) so that a press on
 * the phone and a press on the TV cannot disagree.
 */
export const MOOD_SCENES = ["relax", "read"] as const;
export type MoodScene = (typeof MOOD_SCENES)[number];
export const isMoodScene = (id: string): id is MoodScene => (MOOD_SCENES as readonly string[]).includes(id);

/** Philips Hue's own Relax and Read recipes (ct 447 / 346 mired, bri 144 / 254). */
export const HUE_RECIPES: Record<MoodScene, { kelvin: number; brightness: number }> = {
  relax: { kelvin: 2237, brightness: 57 },
  read: { kelvin: 2890, brightness: 100 },
};

/* ------------------------------------------------------- what is on, what is a light */

export function isReachable(d: Device): boolean {
  return d.state.reachable && d.state.on !== null;
}

/** Counted in "N of M lights on": lights and plugs (plugs drive lamps). */
export function isLightLike(d: Device): boolean {
  return d.kind === "light" || d.kind === "plug";
}

/** Fans count as on when spinning or when their light is on; speakers while they play. */
export function isOn(d: Device): boolean {
  if (!isReachable(d)) return false;
  if (d.kind === "speaker") return d.state.media ? d.state.media.state === "playing" : d.state.on === true;
  if (d.kind === "fan") return (d.state.speed ?? 0) > 0 || !!d.state.lightOn || (d.state.on === true && d.state.speed === undefined);
  return d.state.on === true;
}

/* ------------------------------------------------------------------ colour */

/** Default warm white shown for lights that report neither a colour nor a temperature. */
export const WARM_WHITE = "#ffc27a";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Approximate sRGB of a black-body white (Tanner Helland's fit), as #rrggbb. */
export function kelvinToHex(kelvin: number): string {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Colour a light shows right now (falls back to its white temperature, then warm white). */
export function lightColor(d: Device): string {
  if (d.state.color) return d.state.color;
  if (d.state.kelvin) return kelvinToHex(d.state.kelvin);
  return WARM_WHITE;
}

/* ------------------------------------------------------------------ rooms */

/**
 * Bridge room names are configured in French ("Salon", "Cuisine", "Chambre"…): show them in English.
 * Display only — filters and the bridge keep the raw name. A room the bridge names itself ("Arvindh's
 * room") is not in here and passes straight through, which is the point: the rooms of a real home are
 * config, never code.
 */
const ROOM_LABELS: Record<string, string> = {
  salon: "Living room",
  sejour: "Living room",
  cuisine: "Kitchen",
  chambre: "Bedroom",
  bureau: "Office",
  "salle de bain": "Bathroom",
  "salle de bains": "Bathroom",
  "salle a manger": "Dining room",
  entree: "Hallway",
  couloir: "Hallway",
  wc: "Toilet",
  autre: "Other",
};
const foldRoom = (r: string) => r.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function roomLabel(room: string): string {
  return ROOM_LABELS[foldRoom(room)] ?? room;
}

/** Fallback running order when the home has not said one. Ranked by the English label. */
export const ROOM_ORDER = ["Living room", "Kitchen", "Bedroom", "Office", "Bathroom", "Hallway"];

export interface RoomGroup {
  /** Raw bridge room name — what to send back. */
  room: string;
  /** What to show. */
  label: string;
  devices: Device[];
  on: number;
}

/**
 * The devices grouped by room, in the order the home gives (`order`, the raw names from its config),
 * then the usual order, then alphabetically. Empty rooms do not appear: a heading with nothing under it
 * is a room you cannot reach from here.
 */
export function roomGroups(devices: readonly Device[], order: readonly string[] = []): RoomGroup[] {
  const rank = new Map(order.map((r, i) => [foldRoom(r), i]));
  const map = new Map<string, RoomGroup>();
  for (const d of devices) {
    const room = d.room || "Other";
    const g = map.get(room) ?? { room, label: roomLabel(room), devices: [], on: 0 };
    g.devices.push(d);
    if (isOn(d)) g.on++;
    map.set(room, g);
  }
  const at = (r: string) => {
    const given = rank.get(foldRoom(r));
    if (given !== undefined) return given;
    const i = ROOM_ORDER.indexOf(roomLabel(r));
    return order.length + (i < 0 ? ROOM_ORDER.length : i);
  };
  return [...map.values()].sort((a, b) => at(a.room) - at(b.room) || a.label.localeCompare(b.label, "en"));
}
