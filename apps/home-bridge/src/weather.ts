/**
 * Current weather at the home, from Open-Meteo (free, no key). Every screen used to call Open-Meteo
 * itself; they read it through the bridge instead (`GET /weather.json`), so the fetch happens once for
 * the whole house instead of once per screen, and the TV — which has 1.8 GB and no cycles to spare —
 * does nothing but read a few hundred bytes off the LAN.
 *
 * The same response carries where the sun is — the hub's own `sun()`, the figure the apartment view
 * already lights by — because a screen that paints a sky wants both, and asking twice would be two
 * round trips for one picture. Passing it in rather than recomputing it here is what keeps the block
 * and the apartment from disagreeing about the hour.
 */
import type { SunInfo } from "@appart3d/home";

const TTL_MS = 10 * 60_000;
/** A failed fetch is retried sooner than a good one is refreshed, but not on every request. */
const RETRY_MS = 60_000;

export interface WeatherNow {
  /** Degrees Fahrenheit, as the block's dateline shows them. */
  tempF: number;
  /** WMO weather interpretation code; the screens map it to their own look. */
  code: number;
  windMph: number;
  /** Open-Meteo's own day/night flag, for a glyph that needs a sun or a moon. */
  isDay: boolean;
}

export interface WeatherResponse {
  updatedAt: string;
  weather: WeatherNow | null;
  sun: SunInfo | null;
}

interface OpenMeteoCurrent {
  temperature_2m?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  is_day?: number;
}

let cache: { at: number; value: WeatherNow } | null = null;
let failedAt = 0;

function url(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,weather_code,wind_speed_10m,is_day",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

async function fetchNow(lat: number, lon: number): Promise<WeatherNow> {
  const res = await fetch(url(lat, lon), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  const cur = ((await res.json()) as { current?: OpenMeteoCurrent }).current;
  if (!cur || typeof cur.temperature_2m !== "number" || typeof cur.weather_code !== "number")
    throw new Error("Open-Meteo: réponse inattendue");
  return {
    tempF: Math.round(cur.temperature_2m),
    code: cur.weather_code,
    windMph: Math.round(cur.wind_speed_10m ?? 0),
    isDay: (cur.is_day ?? 1) === 1,
  };
}

/**
 * The weather at `home` and the sun the hub reports, from the cache when it is fresh.
 *
 * `weather` is null while Open-Meteo has never answered (no internet, say); `sun` still is not, since
 * it is arithmetic. A screen keeps its last look rather than blanking, so a stale-but-cached reading
 * is better than none: once a value is held it is served until a later fetch replaces it.
 */
export async function weatherNow(
  home: { latitude: number; longitude: number } | null,
  sun: SunInfo | null = null,
  now = new Date(),
): Promise<WeatherResponse> {
  if (!home) return { updatedAt: now.toISOString(), weather: null, sun };
  const t = now.getTime();
  const stale = !cache || t - cache.at > TTL_MS;
  if (stale && t - failedAt > RETRY_MS) {
    try {
      cache = { at: t, value: await fetchNow(home.latitude, home.longitude) };
      failedAt = 0;
    } catch {
      failedAt = t;
    }
  }
  return { updatedAt: new Date(cache?.at ?? t).toISOString(), weather: cache?.value ?? null, sun };
}

/** Tests only: forget the cached reading. */
export function resetWeatherCache(): void {
  cache = null;
  failedAt = 0;
}
