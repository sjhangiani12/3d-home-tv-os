/**
 * Live Citi Bike counts for the stations near home, from the public GBFS feed (no key). The feed sends no
 * CORS headers, so the web page reads it through the bridge (`GET /citibike.json`).
 */

const INFO_URL = "https://gbfs.citibikenyc.com/gbfs/en/station_information.json";
const STATUS_URL = "https://gbfs.citibikenyc.com/gbfs/en/station_status.json";
const INFO_TTL_MS = 60 * 60_000;
const STATUS_TTL_MS = 30_000;

export interface BikeStation {
  id: string;
  name: string;
  capacity: number;
  distanceM: number | null;
  classic: number;
  ebikes: number;
  bikesDisabled: number;
  docks: number;
  docksDisabled: number;
  /** Seconds since the station last reported. */
  lastReported: number | null;
}

interface StationInfo { station_id: string; name: string; lat: number; lon: number; capacity?: number }
interface StationStatus {
  station_id: string;
  num_bikes_available?: number;
  num_ebikes_available?: number;
  num_bikes_disabled?: number;
  num_docks_available?: number;
  num_docks_disabled?: number;
  last_reported?: number;
}

let info: { at: number; stations: StationInfo[] } | null = null;
let status: { at: number; byId: Map<string, StationStatus> } | null = null;

async function getJson(url: string): Promise<{ data: { stations: unknown[] } }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Citi Bike feed: HTTP ${res.status}`);
  return (await res.json()) as { data: { stations: unknown[] } };
}

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)) * 111_320;
  const dy = (lat2 - lat1) * 110_540;
  return Math.hypot(dx, dy);
}

/** The configured stations, or the `count` nearest to `home` when none are configured. */
export async function bikeStations(opts: { ids: string[]; home: { latitude: number; longitude: number } | null; count?: number }): Promise<BikeStation[]> {
  const now = Date.now();
  if (!info || now - info.at > INFO_TTL_MS) info = { at: now, stations: (await getJson(INFO_URL)).data.stations as StationInfo[] };
  if (!status || now - status.at > STATUS_TTL_MS) {
    const list = (await getJson(STATUS_URL)).data.stations as StationStatus[];
    status = { at: now, byId: new Map(list.map((s) => [s.station_id, s])) };
  }
  const home = opts.home;
  const dist = (s: StationInfo) => (home ? metersBetween(home.latitude, home.longitude, s.lat, s.lon) : null);
  const picked = opts.ids.length
    ? opts.ids.map((id) => info!.stations.find((s) => s.station_id === id)).filter((s): s is StationInfo => !!s)
    : home
      ? [...info.stations].sort((a, b) => dist(a)! - dist(b)!).slice(0, opts.count ?? 2)
      : [];
  return picked.map((s) => {
    const st = status!.byId.get(s.station_id) ?? ({ station_id: s.station_id } as StationStatus);
    const ebikes = st.num_ebikes_available ?? 0;
    const d = dist(s);
    return {
      id: s.station_id,
      name: s.name,
      capacity: s.capacity ?? 0,
      distanceM: d === null ? null : Math.round(d),
      classic: Math.max(0, (st.num_bikes_available ?? 0) - ebikes),
      ebikes,
      bikesDisabled: st.num_bikes_disabled ?? 0,
      docks: st.num_docks_available ?? 0,
      docksDisabled: st.num_docks_disabled ?? 0,
      lastReported: st.last_reported ? Math.max(0, Math.round(now / 1000 - st.last_reported)) : null,
    };
  });
}
