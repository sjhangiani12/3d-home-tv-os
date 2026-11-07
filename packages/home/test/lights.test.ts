import { describe, expect, it } from "vitest";
import {
  HUE_RECIPES, inMood, isMoodScene, isOn, lampLevel, lightColor, moodAdjusted, moodStatus, roomGroups,
  roomLabel, roomPosition, WARM_WHITE, type Device,
} from "../src/index.ts";

const light = (id: string, room: string, on: boolean | null, extra: Partial<Device> = {}): Device => ({
  id,
  name: id,
  kind: "light",
  source: "hue",
  room,
  state: { on, reachable: on !== null },
  capabilities: { brightness: true },
  ...extra,
});

describe("roomGroups", () => {
  it("groups by the raw room name and counts what is on", () => {
    const g = roomGroups([light("a", "Salon", true), light("b", "Salon", false), light("c", "Cuisine", true)]);
    expect(g.map((r) => [r.room, r.devices.length, r.on])).toEqual([
      ["Salon", 2, 1],
      ["Cuisine", 1, 1],
    ]);
  });

  it("follows the home's own order first, whatever the rooms are called", () => {
    const ds = [light("a", "Sharan's room", true), light("b", "Living room", true), light("c", "Arvindh's room", true)];
    const order = ["Living room", "Arvindh's room", "Sharan's room"];
    expect(roomGroups(ds, order).map((r) => r.room)).toEqual(order);
  });

  it("falls back to the usual order, then alphabetically, for rooms the home did not name", () => {
    const ds = [light("a", "Bureau", true), light("b", "Cuisine", true), light("c", "Salon", true), light("d", "Attic", true)];
    expect(roomGroups(ds).map((r) => r.label)).toEqual(["Living room", "Kitchen", "Office", "Attic"]);
  });

  it("puts the home's named rooms ahead of any room it did not mention", () => {
    const ds = [light("a", "Salon", true), light("b", "Sharan's room", true)];
    expect(roomGroups(ds, ["Sharan's room"]).map((r) => r.room)).toEqual(["Sharan's room", "Salon"]);
  });

  it("never invents an empty room, and files a device with no room under Other", () => {
    const g = roomGroups([light("a", "", true)]);
    expect(g).toHaveLength(1);
    expect(g[0]!.room).toBe("Other");
  });

  it("translates the bridge's French names and passes a real one through untouched", () => {
    expect(roomLabel("Chambre")).toBe("Bedroom");
    expect(roomLabel("Salle à manger")).toBe("Dining room");
    expect(roomLabel("Arvindh's room")).toBe("Arvindh's room");
  });
});

describe("isOn", () => {
  it("an unreachable lamp is not on, whatever it last said", () => {
    expect(isOn(light("a", "Salon", true, { state: { on: true, reachable: false } }))).toBe(false);
    expect(isOn(light("a", "Salon", null))).toBe(false);
  });

  it("a fan counts as on while it blows or while its own light is lit", () => {
    const fan = (state: Device["state"]): Device => ({ id: "f", name: "f", kind: "fan", source: "homeassistant", room: "Chambre", state, capabilities: {} });
    expect(isOn(fan({ on: false, reachable: true, speed: 40 }))).toBe(true);
    expect(isOn(fan({ on: false, reachable: true, speed: 0, lightOn: true }))).toBe(true);
    expect(isOn(fan({ on: false, reachable: true, speed: 0 }))).toBe(false);
  });
});

describe("moods", () => {
  it("only Relax and Read stay armed", () => {
    expect(isMoodScene("relax")).toBe(true);
    expect(isMoodScene("read")).toBe(true);
    expect(["bright", "cozy", "movie", "night", "away"].some(isMoodScene)).toBe(false);
  });

  it("carries Hue's own recipes, so the panel and the bridge cannot drift apart", () => {
    expect(HUE_RECIPES.relax).toEqual({ kelvin: 2237, brightness: 57 });
    expect(HUE_RECIPES.read).toEqual({ kelvin: 2890, brightness: 100 });
  });

  const toned = (kelvin: number, brightness: number) =>
    light("a", "Salon", true, { state: { on: true, reachable: true, kelvin, brightness } });

  it("a lamp is in the mood while it carries its white, give or take Hue's mired rounding", () => {
    expect(inMood(toned(2237, 57), "relax")).toBe(true);
    expect(inMood(toned(2270, 57), "relax")).toBe(true);
    expect(inMood(toned(2890, 100), "relax")).toBe(false);
  });

  it("an off lamp is in no mood, and nothing is in a mood that is not armed", () => {
    expect(inMood(light("a", "Salon", false, { state: { on: false, reachable: true, kelvin: 2237 } }), "relax")).toBe(false);
    expect(inMood(toned(2237, 57), null)).toBe(false);
    expect(inMood(toned(2237, 57), "bright")).toBe(false);
  });

  it("dimming by hand keeps the mood's colour and only stops matching its level", () => {
    const moved = toned(2237, 80);
    expect(inMood(moved, "relax")).toBe(true);
    expect(moodAdjusted(moved, "relax")).toBe(true);
    expect(moodAdjusted(toned(2237, 57), "relax")).toBe(false);
  });

  it("counts the armed mood against the lamps: armed with nothing lit, partly taken, adjusted", () => {
    const off = light("b", "Salon", false, { state: { on: false, reachable: true, kelvin: 2237 } });
    expect(moodStatus([off], "relax")).toEqual({ scene: "relax", lit: 0, inMood: 0, adjusted: 0 });
    expect(moodStatus([toned(2237, 57), toned(6500, 100)], "relax")).toEqual({ scene: "relax", lit: 2, inMood: 1, adjusted: 0 });
    expect(moodStatus([toned(2237, 80)], "relax")).toEqual({ scene: "relax", lit: 1, inMood: 1, adjusted: 1 });
  });

  it("has nothing to say when no mood is armed, or when the scene that ran is not one", () => {
    expect(moodStatus([toned(2237, 57)], null)).toBeNull();
    expect(moodStatus([toned(2237, 57)], "movie")).toBeNull();
  });

  it("counts lamps only — a speaker playing in the room is not a light that is lit", () => {
    const speaker: Device = { id: "s", name: "s", kind: "speaker", source: "sonos", room: "Salon", state: { on: true, reachable: true, media: { state: "playing" } }, capabilities: {} };
    expect(moodStatus([toned(2237, 57), speaker], "relax")?.lit).toBe(1);
  });
});

describe("lampLevel", () => {
  it("is zero when off, and full when a lit lamp reports nothing", () => {
    expect(lampLevel(light("a", "Salon", false))).toBe(0);
    expect(lampLevel(light("a", "Salon", true))).toBe(100);
    expect(lampLevel(light("a", "Salon", true, { state: { on: true, reachable: true, brightness: 40 } }))).toBe(40);
  });
});

describe("roomPosition", () => {
  const pos = (ds: Device[]) => roomPosition(roomGroups(ds)[0]!);

  it("is on only when every lamp that answers is lit, and a lamp that is away cannot hold it off", () => {
    expect(pos([light("a", "Salon", true), light("b", "Salon", true)])).toBe("on");
    expect(pos([light("a", "Salon", true), light("b", "Salon", false)])).toBe("mix");
    expect(pos([light("a", "Salon", false), light("b", "Salon", false)])).toBe("off");
    expect(pos([light("a", "Salon", true), light("b", "Salon", null)])).toBe("on");
  });
});

describe("lightColor", () => {
  it("prefers the colour it reports, then its white, then warm white", () => {
    expect(lightColor(light("a", "Salon", true, { state: { on: true, reachable: true, color: "#ff0000", kelvin: 2700 } }))).toBe("#ff0000");
    expect(lightColor(light("a", "Salon", true, { state: { on: true, reachable: true, kelvin: 2700 } }))).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightColor(light("a", "Salon", true))).toBe(WARM_WHITE);
  });
});
