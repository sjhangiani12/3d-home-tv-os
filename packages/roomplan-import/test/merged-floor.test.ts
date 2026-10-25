import { describe, expect, it } from "vitest";
import { validateScene } from "@appart3d/scene";
import { generateFixtureEnvelope, importRoomPlan } from "../src";

describe("merged structure floor", () => {
  it("uses per-room floors when StructureBuilder returns a single merged floor", () => {
    // Real iOS 26 scans: structure.floors holds ONE floor for the whole home, structure.rooms[i] keep theirs.
    const env = structuredClone(generateFixtureEnvelope("multi")) as { structure: { floors: unknown[] } };
    env.structure.floors = env.structure.floors.slice(0, 1);
    const { scene } = importRoomPlan(env);
    expect(validateScene(scene)).toEqual([]);
    expect(scene.rooms).toHaveLength(3);
  });

  it("treats the iOS placeholder names \"Pièce N\" and \"Room N\" as unnamed", () => {
    for (const prefix of ["Pièce", "Room", "room"]) {
      const env = structuredClone(generateFixtureEnvelope("multi")) as { roomNames: string[] };
      env.roomNames = env.roomNames.map((_, i) => `${prefix} ${i + 1}`);
      const { scene } = importRoomPlan(env);
      expect(scene.rooms.map((r) => r.name)).toEqual(["Living room", "Bedroom", "Bathroom"]);
    }
  });
});
