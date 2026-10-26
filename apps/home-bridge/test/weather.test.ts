import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWeatherCache, weatherNow } from "../src/weather.ts";

const HOME = { latitude: 40.7443, longitude: -73.9785 };
const SUN = { elevation: 12.5, isDay: true };

const reply = (current: unknown) => ({ ok: true, json: async () => ({ current }) });

function stubFetch(impl: () => unknown) {
  const fetchFn = vi.fn((_url: string | URL) => impl());
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetWeatherCache();
});

describe("weatherNow", () => {
  it("normalises Open-Meteo's current block and passes the hub's sun through", async () => {
    stubFetch(() => reply({ temperature_2m: 51.6, weather_code: 61, wind_speed_10m: 9.4, is_day: 1 }));
    const r = await weatherNow(HOME, SUN, new Date("2026-10-26T18:00:00Z"));
    expect(r.weather).toEqual({ tempF: 52, code: 61, windMph: 9, isDay: true });
    expect(r.sun).toEqual(SUN);
  });

  it("asks Open-Meteo for the home's coordinates, in °F and mph", async () => {
    const f = stubFetch(() => reply({ temperature_2m: 40, weather_code: 0 }));
    await weatherNow(HOME, SUN);
    const u = new URL(String(f.mock.calls[0]![0]));
    expect(u.origin + u.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(u.searchParams.get("latitude")).toBe("40.7443");
    expect(u.searchParams.get("longitude")).toBe("-73.9785");
    expect(u.searchParams.get("temperature_unit")).toBe("fahrenheit");
    expect(u.searchParams.get("wind_speed_unit")).toBe("mph");
  });

  it("serves the cache for ten minutes, then refetches", async () => {
    let temp = 50;
    const f = stubFetch(() => reply({ temperature_2m: temp, weather_code: 0, wind_speed_10m: 2, is_day: 1 }));
    const t0 = new Date("2026-10-26T18:00:00Z");
    expect((await weatherNow(HOME, SUN, t0)).weather!.tempF).toBe(50);
    temp = 60;
    // Five minutes later and ten screens asking: still one fetch, still the held reading.
    for (let i = 0; i < 10; i++) expect((await weatherNow(HOME, SUN, new Date(t0.getTime() + 5 * 60_000))).weather!.tempF).toBe(50);
    expect(f).toHaveBeenCalledTimes(1);
    expect((await weatherNow(HOME, SUN, new Date(t0.getTime() + 11 * 60_000))).weather!.tempF).toBe(60);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("keeps serving the last reading when Open-Meteo goes away, and retries at most once a minute", async () => {
    const t0 = new Date("2026-10-26T18:00:00Z");
    stubFetch(() => reply({ temperature_2m: 50, weather_code: 0, wind_speed_10m: 2, is_day: 1 }));
    await weatherNow(HOME, SUN, t0);
    const down = stubFetch(() => {
      throw new Error("offline");
    });
    const later = (min: number) => new Date(t0.getTime() + min * 60_000);
    expect((await weatherNow(HOME, SUN, later(11))).weather!.tempF).toBe(50);
    expect(down).toHaveBeenCalledTimes(1);
    await weatherNow(HOME, SUN, later(11.5)); // inside the retry window: no second attempt
    expect(down).toHaveBeenCalledTimes(1);
    await weatherNow(HOME, SUN, later(13));
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("weather null, sun still there, when there is nothing to show yet", async () => {
    stubFetch(() => ({ ok: false, status: 503 }));
    expect(await weatherNow(HOME, SUN)).toMatchObject({ weather: null, sun: SUN });
    // No configured location: nothing is fetched at all.
    const f = stubFetch(() => reply({ temperature_2m: 1, weather_code: 0 }));
    expect(await weatherNow(null, null)).toMatchObject({ weather: null, sun: null });
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects a response missing the fields the screens read", async () => {
    stubFetch(() => reply({ wind_speed_10m: 3 }));
    expect((await weatherNow(HOME, SUN)).weather).toBeNull();
  });
});
