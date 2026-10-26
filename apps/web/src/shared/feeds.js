/**
 * The live data every home screen shares: the home's own config, the subway, the Citi Bike docks, the
 * weather, and the bridge's device stream (lamps and speakers).
 *
 * Transport only: each function returns plain data, or null when the bridge is not there (a plain preview
 * keeps running on its sample values). Screens keep their own mapping — what the block does with a train
 * time is not what the street row does with it.
 */

export async function getJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** The home's names and place (not in git); {} for the demo block. */
export async function loadHomeConfig() {
  try {
    const r = await fetch("/shared/block-home.json", { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch { /* demo */ }
  return {};
}

/** { lat, lon } from ?lat=&lon=, else the config's location, else null. */
export function resolveLocation(cfg, query) {
  const q = query || new URLSearchParams(location.search);
  if (q.get("lat")) return { lat: Number(q.get("lat")), lon: Number(q.get("lon")) };
  const l = cfg && cfg.location;
  return l ? { lat: l.latitude, lon: l.longitude } : null;
}

/** Arrivals at the station's parent stop: { downtown, uptown } of { route, at } (epoch seconds). */
export async function fetchTrains(stop) {
  if (!stop) return null;
  try {
    return await getJson(`/mta.json?stop=${encodeURIComponent(stop)}`);
  } catch { return null; }
}

/** The docks the bridge watches: { stations: [{ name, ebikes, classic, docks, capacity }] }. */
export async function fetchBikes() {
  try {
    return await getJson("/citibike.json");
  } catch { return null; }
}

const WMO = (c) => c === 0 ? "Clear" : c <= 2 ? "Partly cloudy" : c === 3 ? "Cloudy" : c <= 48 ? "Fog"
  : c <= 57 ? "Drizzle" : c <= 67 ? "Rain" : c <= 77 ? "Snow" : c <= 82 ? "Showers" : c <= 86 ? "Snow" : "Storm";

/** The four looks a screen draws: clear, rain, snow, wind. */
function weatherKind(code, wind) {
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  return wind >= 18 ? "wind" : "clear";
}

/** The bridge's cached reading (GET /weather.json): one fetch for the whole house. Null when it is not there. */
async function fromBridge() {
  try {
    const d = await getJson("/weather.json");
    const w = d.weather;
    // The sun is arithmetic, so it comes back even when Open-Meteo did not: a screen can still paint the
    // right sky over the last temperature it knew.
    return { weather: w ? { tempF: w.tempF, code: w.code, windMph: w.windMph, isDay: w.isDay } : null, sun: d.sun || null };
  } catch { return null; }
}

/** Open-Meteo straight from the browser: the fallback for a page opened without the bridge. */
async function fromOpenMeteo(loc) {
  if (!loc) return null;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
      + `&current=temperature_2m,weather_code,wind_speed_10m,is_day&temperature_unit=fahrenheit`
      + `&wind_speed_unit=mph&timezone=auto`;
    const c = (await getJson(u)).current;
    return { weather: { tempF: c.temperature_2m, code: c.weather_code, windMph: c.wind_speed_10m, isDay: c.is_day === 1 }, sun: null };
  } catch { return null; }
}

/**
 * Current weather: { kind, temp, label, isDay, sun } or null.
 *
 * `sun` is { elevation, isDay, … } when the bridge answered — that is what lets a screen put dusk where
 * the sun actually is instead of at a fixed hour. It is null on the Open-Meteo fallback, and a screen
 * goes back to the clock there.
 */
export async function fetchWeather(loc) {
  const d = (await fromBridge()) || (await fromOpenMeteo(loc));
  if (!d) return null;
  if (!d.weather) return d.sun ? { sun: d.sun } : null;
  const w = d.weather;
  const kind = weatherKind(w.code, w.windMph);
  return { kind, temp: Math.round(w.tempF), label: kind === "wind" ? "Windy" : WMO(w.code), isDay: w.isDay, sun: d.sun };
}

/** The bridge's event stream: a snapshot, then one event per change. onDevice gets each device. */
export function connectDevices(onDevice) {
  if (typeof EventSource === "undefined") return null;
  const es = new EventSource("/api/home/events");
  es.onmessage = (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === "snapshot") (ev.snapshot && ev.snapshot.devices || []).forEach(onDevice);
    else if (ev.type === "device") onDevice(ev.device);
  };
  return es;
}

/** Act on a device (a lamp, a speaker); returns the device the bridge echoes back, or null. */
export async function deviceAction(id, action) {
  try {
    const r = await fetch(`/api/home/devices/${encodeURIComponent(id)}/action`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action),
    });
    if (r.ok) { const d = await r.json(); if (d && d.id) return d; }
  } catch { /* the next event brings the real state */ }
  return null;
}
