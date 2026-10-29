import type { Device } from "@appart3d/home";
import { describe, expect, it } from "vitest";
import { HUE_RECIPES, moodFollowUp, planScene, SCENE_COLORS } from "../src/scenes.ts";

const light = (id: string, room: string, on: boolean | null, extra: Partial<Device> = {}): Device => ({
  id,
  name: id,
  kind: "light",
  source: "hue",
  room,
  state: { on, reachable: on !== null },
  capabilities: { brightness: true, color: true, kelvin: true },
  ...extra,
});

const devices: Device[] = [
  light("hue:light:12", "Salon", true, { name: "lightstrip" }),
  light("hue:light:18", "Salon", false),
  light("hue:light:9", "Salon", null),
  light("hue:light:17", "Cuisine", true),
  { ...light("hue:light:8", "Chambre", false), kind: "plug", capabilities: {} },
  { id: "ha:fan.f", name: "fan", kind: "fan", source: "homeassistant", room: "Chambre", state: { on: true, reachable: true, speed: 50, lightOn: true }, capabilities: { speedSteps: 6, fanLight: true } },
  { id: "ha:media_player.tv", name: "TV", kind: "tv", source: "homeassistant", room: "Salon", state: { on: true, reachable: true }, capabilities: { volume: true } },
];
const opts = { ambientStrip: "hue:light:12" };
const byId = (plan: ReturnType<typeof planScene>) => Object.fromEntries((plan ?? []).map((p) => [p.deviceId, p.actions]));

describe("planScene", () => {
  it("unknown scene -> null", () => {
    expect(planScene("party", devices, opts)).toBeNull();
  });

  it("Lumineux: every light 100% neutral white, plug on, nothing else", () => {
    const p = byId(planScene("bright", devices, opts));
    expect(Object.keys(p).sort()).toEqual(["hue:light:12", "hue:light:17", "hue:light:18", "hue:light:8", "hue:light:9"]);
    expect(p["hue:light:17"]).toEqual([{ type: "power", on: true }, { type: "brightness", value: 100 }, { type: "kelvin", value: SCENE_COLORS.neutralKelvin }]);
    expect(p["hue:light:8"]).toEqual([{ type: "power", on: true }]);
  });

  it("Cosy: living room only, warm 2700K 45%, strip amber", () => {
    const p = byId(planScene("cozy", devices, opts));
    expect(Object.keys(p).sort()).toEqual(["hue:light:12", "hue:light:18", "hue:light:9"]);
    expect(p["hue:light:18"]).toEqual([{ type: "power", on: true }, { type: "brightness", value: 45 }, { type: "kelvin", value: 2700 }]);
    expect(p["hue:light:12"]).toEqual([{ type: "power", on: true }, { type: "brightness", value: 45 }, { type: "color", hex: SCENE_COLORS.amber }]);
  });

  it("Film: lights off except strip 25% violet, TV on, already-off lights skipped", () => {
    const p = byId(planScene("movie", devices, opts));
    expect(p["hue:light:12"]).toEqual([{ type: "power", on: true }, { type: "brightness", value: 25 }, { type: "color", hex: SCENE_COLORS.movie }]);
    expect(p["hue:light:17"]).toEqual([{ type: "power", on: false }]);
    expect(p["hue:light:18"]).toBeUndefined();
    expect(p["ha:media_player.tv"]).toEqual([{ type: "power", on: true }]);
    expect(p["ha:fan.f"]).toBeUndefined();
  });

  it("Nuit: all off except bedroom plug; TV off; fan keeps blowing, light off", () => {
    const p = byId(planScene("night", devices, opts));
    expect(p["hue:light:8"]).toEqual([{ type: "power", on: true }]);
    expect(p["hue:light:12"]).toEqual([{ type: "power", on: false }]);
    expect(p["ha:media_player.tv"]).toEqual([{ type: "power", on: false }]);
    expect(p["ha:fan.f"]).toEqual([{ type: "fanLight", on: false }]);
  });

  it("Absent: everything off including fan and TV", () => {
    const p = byId(planScene("away", devices, opts));
    expect(p["ha:fan.f"]).toEqual([{ type: "power", on: false }, { type: "fanLight", on: false }]);
    expect(p["ha:media_player.tv"]).toEqual([{ type: "power", on: false }]);
    expect(p["hue:light:8"]).toBeUndefined(); // already off
  });

  it("All off: the lamps go out and nothing else does — the TV and the fan are left alone", () => {
    const p = byId(planScene("off", devices, opts));
    expect(Object.keys(p).sort()).toEqual(["hue:light:12", "hue:light:17", "hue:light:9"]);
    expect(p["hue:light:12"]).toEqual([{ type: "power", on: false }]);
    expect(p["hue:light:18"]).toBeUndefined(); // already off
  });

  it("never sends an IR power toggle to a TV whose state is unknown", () => {
    const tv: Device = { ...devices[6]!, id: "robot:tv", source: "robot", state: { on: null, reachable: true } };
    expect(byId(planScene("away", [tv], opts))["robot:tv"]).toBeUndefined();
  });

  it("Relax / Read: Hue's recipes on the lamps already on", () => {
    const p = byId(planScene("relax", devices, opts));
    expect(Object.keys(p).sort()).toEqual(["hue:light:12", "hue:light:17"]);
    expect(p["hue:light:17"]).toEqual([{ type: "power", on: true }, { type: "brightness", value: HUE_RECIPES.relax.brightness }, { type: "kelvin", value: HUE_RECIPES.relax.kelvin }]);
    const r = byId(planScene("read", devices, opts));
    expect(r["hue:light:12"]).toEqual([{ type: "power", on: true }, { type: "brightness", value: 100 }, { type: "kelvin", value: HUE_RECIPES.read.kelvin }]);
  });

  it("Relax never switches a lamp on: an off or unreachable lamp is left out of the plan", () => {
    expect(byId(planScene("relax", devices, opts))["hue:light:18"]).toBeUndefined(); // off
    expect(byId(planScene("relax", devices, opts))["hue:light:9"]).toBeUndefined(); // unreachable
  });

  it("Relax with every lamp off plans nothing at all — it only arms itself", () => {
    const allOff = devices.map((d) => (d.kind === "light" || d.kind === "plug" ? { ...d, state: { ...d.state, on: false } } : d));
    expect(planScene("relax", allOff, opts)).toEqual([]);
  });

  describe("moodFollowUp", () => {
    const lamp = (on: boolean | null) => ({ ...light("hue:light:5", "Salon", on) });

    it("brings a lamp that just came on into the armed mood, without a second power action", () => {
      expect(moodFollowUp("relax", lamp(true), false)).toEqual([
        { type: "brightness", value: HUE_RECIPES.relax.brightness },
        { type: "kelvin", value: HUE_RECIPES.relax.kelvin },
      ]);
    });

    it("leaves a lamp that was already on alone: a hand dim keeps the colour and just stops matching", () => {
      expect(moodFollowUp("relax", lamp(true), true)).toEqual([]);
    });

    it("does nothing with no mood armed, on a lamp going off, or on a plug", () => {
      expect(moodFollowUp(null, lamp(true), false)).toEqual([]);
      expect(moodFollowUp("read", lamp(false), true)).toEqual([]);
      expect(moodFollowUp("read", { ...lamp(true), kind: "plug", capabilities: {} }, false)).toEqual([]);
    });
  });

  it("finds the strip by name when the role id is missing", () => {
    const p = byId(planScene("movie", devices, { ambientStrip: null }));
    expect(p["hue:light:12"]?.[2]).toEqual({ type: "color", hex: SCENE_COLORS.movie });
  });
});
