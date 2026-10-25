/**
 * Live subway arrivals at one station from the MTA's GTFS-realtime feed (no key). The feed is protobuf and sends
 * no CORS headers, so the block page reads it through the bridge (`GET /mta.json`). Only the few fields needed are
 * read, so no protobuf library.
 */

/** Lines 1–6 and the 42 St shuttle. */
export const FEED_1_6 = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs";
const TTL_MS = 25_000;

export interface Arrival {
  route: string;
  /** Epoch seconds. */
  at: number;
}

export interface StationArrivals {
  stop: string;
  /** Soonest first; N = uptown (Bronx), S = downtown (Brooklyn). */
  uptown: Arrival[];
  downtown: Arrival[];
  /** Feed timestamp (epoch seconds), null when absent. */
  feedAt: number | null;
}

/** Walks the fields of one protobuf message in `b[from, to)`: varints and length-delimited slices. */
function* fields(b: Uint8Array, from = 0, to = b.length): Generator<[number, number, number, number]> {
  let i = from;
  const varint = (): number => {
    let r = 0;
    let mul = 1;
    for (;;) {
      if (i >= to) throw new Error("protobuf: truncated");
      const x = b[i++]!;
      r += (x & 0x7f) * mul;
      if (x < 0x80) return r;
      mul *= 128;
    }
  };
  while (i < to) {
    const key = varint();
    const field = Math.floor(key / 8);
    switch (key & 7) {
      case 0:
        yield [field, 0, varint(), 0];
        break;
      case 1:
        i += 8;
        break;
      case 2: {
        const len = varint();
        if (i + len > to) throw new Error("protobuf: truncated");
        yield [field, 2, i, i + len];
        i += len;
        break;
      }
      case 5:
        i += 4;
        break;
      default:
        throw new Error(`protobuf: wire type ${key & 7}`);
    }
  }
}

const text = (b: Uint8Array, a: number, z: number) => new TextDecoder().decode(b.subarray(a, z));

/** The arrivals at `stop` (a GTFS parent stop id, e.g. "631") in a FeedMessage, soonest first. */
export function parseArrivals(feed: Uint8Array, stop: string): StationArrivals {
  const out: StationArrivals = { stop, uptown: [], downtown: [], feedAt: null };
  // FeedMessage: header (1) → timestamp (3); entity (2) → trip_update (3) → trip (1) → route_id (5),
  // stop_time_update (2) → stop_id (4), arrival (2) / departure (3) → time (2).
  for (const [f, , a, z] of fields(feed)) {
    if (f === 1) for (const [hf, , v] of fields(feed, a, z)) if (hf === 3) out.feedAt = v;
    if (f !== 2) continue;
    for (const [ef, ew, ea, ez] of fields(feed, a, z)) {
      if (ef !== 3 || ew !== 2) continue;
      let route = "";
      const hits: [string, number][] = [];
      for (const [tf, tw, ta, tz] of fields(feed, ea, ez)) {
        if (tw !== 2) continue;
        if (tf === 1) for (const [df, dw, da, dz] of fields(feed, ta, tz)) { if (df === 5 && dw === 2) route = text(feed, da, dz); }
        if (tf === 2) {
          let sid = "";
          let arrival = 0;
          let departure = 0;
          for (const [sf, sw, sa, sz] of fields(feed, ta, tz)) {
            if (sf === 4 && sw === 2) sid = text(feed, sa, sz);
            if ((sf === 2 || sf === 3) && sw === 2) for (const [xf, , xv] of fields(feed, sa, sz)) if (xf === 2) { if (sf === 2) arrival = xv; else departure = xv; }
          }
          if (sid === `${stop}N` || sid === `${stop}S`) hits.push([sid, arrival || departure]);
        }
      }
      for (const [sid, at] of hits) if (at > 0) (sid.endsWith("N") ? out.uptown : out.downtown).push({ route, at });
    }
  }
  out.uptown.sort((x, y) => x.at - y.at);
  out.downtown.sort((x, y) => x.at - y.at);
  return out;
}

let cache: { at: number; stop: string; data: StationArrivals } | null = null;

/** Arrivals at `stop`, fetched at most every 25 s. Trains more than a minute gone are dropped. */
export async function stationArrivals(stop: string, feedUrl = FEED_1_6): Promise<StationArrivals> {
  const now = Date.now();
  if (!cache || cache.stop !== stop || now - cache.at > TTL_MS) {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`MTA feed: HTTP ${res.status}`);
    cache = { at: now, stop, data: parseArrivals(new Uint8Array(await res.arrayBuffer()), stop) };
  }
  const cut = now / 1000 - 60;
  const d = cache.data;
  return { ...d, uptown: d.uptown.filter((a) => a.at > cut), downtown: d.downtown.filter((a) => a.at > cut) };
}
