import { describe, expect, it } from "vitest";
import { parseArrivals } from "../src/mta.ts";

// A tiny protobuf writer, enough to build a GTFS-realtime FeedMessage by hand.
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n >= 0x80) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return out;
};
const num = (field: number, v: number) => [...varint(field * 8), ...varint(v)];
const msg = (field: number, body: number[]) => [...varint(field * 8 + 2), ...varint(body.length), ...body];
const str = (field: number, s: string) => msg(field, [...new TextEncoder().encode(s)]);

const stopTime = (stop: string, arrival: number) => msg(2, [...str(4, stop), ...msg(2, num(2, arrival))]);
const trip = (route: string, ...stops: number[][]) => msg(2, [...str(1, `e-${route}`), ...msg(3, [...msg(1, [...str(1, "t"), ...str(5, route)]), ...stops.flat()])]);

describe("parseArrivals", () => {
  it("splits uptown / downtown at the stop, soonest first, with the route and the feed time", () => {
    const feed = new Uint8Array([
      ...msg(1, [...str(1, "2.0"), ...num(3, 1_792_900_000)]),
      ...trip("6", stopTime("631S", 1_792_900_100), stopTime("632S", 1_792_900_400)),
      ...trip("4", stopTime("632N", 1_792_900_300)),
      ...trip("6", stopTime("632S", 1_792_900_200)),
      ...trip("6", stopTime("635N", 1_792_900_050)),
    ]);
    const a = parseArrivals(feed, "632");
    expect(a.feedAt).toBe(1_792_900_000);
    expect(a.downtown).toEqual([{ route: "6", at: 1_792_900_200 }, { route: "6", at: 1_792_900_400 }]);
    expect(a.uptown).toEqual([{ route: "4", at: 1_792_900_300 }]);
  });

  it("refuses a truncated feed", () => {
    expect(() => parseArrivals(new Uint8Array([0x12, 0x10, 0x01]), "632")).toThrow(/truncated/);
  });
});
