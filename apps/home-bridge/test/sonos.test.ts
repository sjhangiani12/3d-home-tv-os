import { describe, expect, it } from "vitest";
import { hms, parsePlayback, parseTopology, planSonosAction, sonosDevices, sourceOf } from "../src/sonos.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const env = (inner: string) => `<s:Envelope><s:Body>${inner}</s:Body></s:Envelope>`;

const TOPOLOGY = env(
  `<u:GetZoneGroupStateResponse><ZoneGroupState>${esc(
    `<ZoneGroupState><ZoneGroups>` +
      `<ZoneGroup Coordinator="RINCON_B" ID="RINCON_A:1">` +
      `<ZoneGroupMember UUID="RINCON_A" Location="http://10.0.0.2:1400/xml/device_description.xml" ZoneName="Living Room"><Satellite UUID="RINCON_S" Location="http://10.0.0.9:1400/x" ZoneName="Living Room" Invisible="1"/></ZoneGroupMember>` +
      `<ZoneGroupMember UUID="RINCON_B" Location="http://10.0.0.3:1400/xml/device_description.xml" ZoneName="Roam"/>` +
      `</ZoneGroup>` +
      `<ZoneGroup Coordinator="RINCON_C" ID="RINCON_C:2"><ZoneGroupMember UUID="RINCON_C" Location="http://10.0.0.4:1400/x" ZoneName="Bath &amp; Co"/></ZoneGroup>` +
      `</ZoneGroups></ZoneGroupState>`,
  )}</ZoneGroupState></u:GetZoneGroupStateResponse>`,
);

const didl = (inner: string) =>
  esc(`<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"><item>${inner}</item></DIDL-Lite>`);
const transport = (s: string) => env(`<u:GetTransportInfoResponse><CurrentTransportState>${s}</CurrentTransportState></u:GetTransportInfoResponse>`);
const position = (uri: string, meta: string, rel = "0:01:05", dur = "0:04:37") =>
  env(`<u:GetPositionInfoResponse><TrackDuration>${dur}</TrackDuration><TrackMetaData>${meta}</TrackMetaData><TrackURI>${esc(uri)}</TrackURI><RelTime>${rel}</RelTime></u:GetPositionInfoResponse>`);
const media = (uri: string) => env(`<u:GetMediaInfoResponse><CurrentURI>${esc(uri)}</CurrentURI></u:GetMediaInfoResponse>`);

describe("sonos", () => {
  it("reads groups, coordinator first, without bonded satellites", () => {
    const g = parseTopology(TOPOLOGY);
    expect(g).toEqual([
      { coordinator: "RINCON_B", members: [{ uuid: "RINCON_B", name: "Roam", ip: "10.0.0.3" }, { uuid: "RINCON_A", name: "Living Room", ip: "10.0.0.2" }] },
      { coordinator: "RINCON_C", members: [{ uuid: "RINCON_C", name: "Bath & Co", ip: "10.0.0.4" }] },
    ]);
  });

  it("names the source from the URIs", () => {
    expect(sourceOf("x-sonos-vli:RINCON_B:2,spotify:abc")).toBe("Spotify");
    expect(sourceOf("x-sonos-vli:RINCON_B:1,airplay:abc")).toBe("AirPlay");
    expect(sourceOf("x-sonosapi-hls-static:ALkSOi?sid=204&flags=8")).toBe("Apple Music");
    expect(sourceOf("x-sonos-htastream:RINCON_A:spdif")).toBe("TV");
    expect(sourceOf("", "x-rincon-mp3radio://example.com/stream")).toBe("Radio");
    expect(sourceOf("x-rincon:RINCON_B")).toBeUndefined();
    expect(hms("0:04:37")).toBe(277);
    expect(hms("NOT_IMPLEMENTED")).toBeUndefined();
  });

  it("reads a Spotify Connect track", () => {
    const meta = didl(
      `<upnp:albumArtURI>https://i.scdn.co/image/x</upnp:albumArtURI><dc:title>Bellini</dc:title><dc:creator>West &amp; Zander</dc:creator><upnp:album>Bellini / Macua</upnp:album>`,
    );
    const p = parsePlayback(transport("PLAYING"), position("x-sonos-vli:RINCON_B:2,spotify:abc", meta), media("x-sonos-vli:RINCON_B:2,spotify:abc"));
    expect(p).toEqual({ state: "playing", source: "Spotify", title: "Bellini", artist: "West & Zander", album: "Bellini / Macua", art: "https://i.scdn.co/image/x", position: 65, duration: 277 });
  });

  it("splits a radio stream's artist and title", () => {
    const meta = didl(`<dc:title>WNYC</dc:title><r:streamContent>Nina Simone - Feeling Good</r:streamContent>`);
    const p = parsePlayback(transport("PLAYING"), position("x-rincon-mp3radio://x", meta, "0:00:10", "NOT_IMPLEMENTED"), media("x-rincon-mp3radio://x"));
    expect(p).toMatchObject({ source: "Radio", title: "Feeling Good", artist: "Nina Simone", album: "WNYC" });
    expect(p.duration).toBeUndefined();
  });

  it("gives every room of a group the group's media", () => {
    const groups = parseTopology(TOPOLOGY);
    const at = new Date("2026-10-25T15:00:00Z");
    const playback = new Map([["RINCON_B", { state: "playing" as const, source: "Spotify", title: "Bellini", art: "/getaa?u=x", at }]]);
    const d = sonosDevices(groups, playback, new Map([["RINCON_A", 22]]));
    expect(d.map((x) => x.id)).toEqual(["sonos:RINCON_B", "sonos:RINCON_A", "sonos:RINCON_C"]);
    expect(d[1]!.state).toMatchObject({ on: true, reachable: true, volume: 22, media: { state: "playing", app: "Spotify", title: "Bellini", group: ["Roam", "Living Room"] } });
    expect(d[1]!.state.media!.artworkUrl).toMatch(/^\/api\/home\/media\/sonos%3ARINCON_A\/artwork\?h=[0-9a-f]{16}$/);
    // No answer from the other group's lead: unreachable.
    expect(d[2]!.state).toEqual({ on: null, reachable: false });
  });
});

describe("planSonosAction", () => {
  const spotify = { state: "playing" as const, source: "Spotify" };
  it("sends transport to the group and volume to the room", () => {
    expect(planSonosAction(spotify, 20, { type: "media", command: "playPause" })).toEqual([{ to: "group", action: "Pause" }]);
    expect(planSonosAction({ ...spotify, state: "paused" }, 20, { type: "toggle" })).toEqual([{ to: "group", action: "Play" }]);
    expect(planSonosAction(spotify, 20, { type: "media", command: "next" })).toEqual([{ to: "group", action: "Next" }]);
    expect(planSonosAction(spotify, 20, { type: "volumeStep", delta: 1 })).toEqual([{ to: "room", action: "SetVolume", value: 23 }]);
    expect(planSonosAction(spotify, 99, { type: "volume", value: 140 })).toEqual([{ to: "room", action: "SetVolume", value: 100 }]);
  });
  it("refuses what the source cannot do", () => {
    expect(() => planSonosAction({ state: "playing", source: "TV" }, 20, { type: "media", command: "pause" })).toThrow(/indisponible/);
    expect(() => planSonosAction({ state: "playing", source: "Radio" }, 20, { type: "media", command: "next" })).toThrow(/indisponible/);
    expect(planSonosAction({ state: "playing", source: "TV" }, 20, { type: "volumeStep", delta: -1 })).toEqual([{ to: "room", action: "SetVolume", value: 17 }]);
  });
});
