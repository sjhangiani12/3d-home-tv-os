import { describe, expect, it } from "vitest";
import { canMedia, mediaLoaded, mediaPosition, mediaRooms, nowPlaying, type Device, type MediaInfo } from "../src/index.ts";

const speaker = (name: string, media: MediaInfo | undefined, extra: Partial<Device> = {}): Device => ({
  id: name,
  name,
  kind: "speaker",
  source: "sonos",
  room: name,
  state: { on: true, reachable: true, media },
  capabilities: { media: ["play", "pause", "next", "previous"] },
  ...extra,
});
const playing = (title: string, group?: string[]): MediaInfo => ({ state: "playing", title, group });
const idle: MediaInfo = { state: "idle" };

describe("nowPlaying", () => {
  it("prefers a speaker the remote can actually drive over a louder one it cannot", () => {
    const tv = speaker("TV", playing("The match"), { capabilities: {} });
    const kitchen = speaker("Kitchen", { state: "paused", title: "Rumours" });
    expect(nowPlaying([tv, kitchen])?.name).toBe("Kitchen");
  });

  it("takes something loaded over a silent room, and playing over paused", () => {
    const silent = speaker("Bedroom", idle);
    const paused = speaker("Office", { state: "paused", title: "Rumours" });
    const live = speaker("Salon", playing("Kind of Blue"));
    expect(nowPlaying([silent, paused])?.name).toBe("Office");
    expect(nowPlaying([silent, paused, live])?.name).toBe("Salon");
  });

  it("then takes the group filling the most rooms", () => {
    const one = speaker("Office", playing("A"));
    const three = speaker("Salon", playing("B", ["Salon", "Kitchen", "Hall"]));
    expect(nowPlaying([one, three])?.name).toBe("Salon");
  });

  it("answers the same whatever order the bridge sends, and keeps a silent room to start", () => {
    const a = speaker("Attic", idle), b = speaker("Basement", idle);
    expect(nowPlaying([a, b])?.name).toBe("Attic");
    expect(nowPlaying([b, a])?.name).toBe("Attic");
    expect(mediaLoaded(nowPlaying([a, b])!)).toBe(false);
  });

  it("ignores a speaker that is away, a lamp, and a speaker that says nothing at all", () => {
    const away = speaker("Salon", playing("A"), { state: { on: true, reachable: false, media: playing("A") } });
    const mute = speaker("Office", undefined);
    const lamp: Device = { id: "l", name: "l", kind: "light", source: "hue", room: "Salon", state: { on: true, reachable: true }, capabilities: {} };
    expect(nowPlaying([away, mute, lamp])).toBeUndefined();
    expect(nowPlaying([])).toBeUndefined();
  });
});

describe("canMedia", () => {
  it("accepts playPause when either half is offered, and nothing when none is", () => {
    const d = speaker("Salon", playing("A"), { capabilities: { media: ["pause"] } });
    expect(canMedia(d, "playPause")).toBe(true);
    expect(canMedia(d, "next")).toBe(false);
    expect(canMedia(speaker("TV", playing("A"), { capabilities: {} }), "playPause")).toBe(false);
  });
});

describe("mediaRooms", () => {
  it("is the group when there is one, else the room it is in", () => {
    expect(mediaRooms(speaker("Salon", playing("A", ["Salon", "Kitchen"])))).toEqual(["Salon", "Kitchen"]);
    expect(mediaRooms(speaker("Salon", playing("A")))).toEqual(["Salon"]);
  });
});

describe("mediaPosition", () => {
  const at = Date.parse("2026-01-01T00:00:00Z");

  it("runs on while playing and stands still while paused", () => {
    const m: MediaInfo = { state: "playing", position: 10, duration: 300, updatedAt: "2026-01-01T00:00:00Z" };
    expect(mediaPosition(m, at + 5_000)).toBe(15);
    expect(mediaPosition({ ...m, state: "paused" }, at + 5_000)).toBe(10);
  });

  it("never runs past the end of the track, and is unknown without a position", () => {
    const m: MediaInfo = { state: "playing", position: 290, duration: 300, updatedAt: "2026-01-01T00:00:00Z" };
    expect(mediaPosition(m, at + 60_000)).toBe(300);
    expect(mediaPosition({ state: "playing" }, at)).toBeUndefined();
    expect(mediaPosition(undefined, at)).toBeUndefined();
  });
});
