/**
 * Sonos speakers, read over their local UPnP API (port 1400, no account, no key). The bridge finds one speaker
 * (SSDP, or `sonos.hosts`), reads the zone group topology from it, then polls each group's coordinator: transport
 * state, track, source URI, and each speaker's volume. One device per room; every room of a group carries the
 * group's media, with `media.group` naming the rooms that play together.
 *
 * Transport (play, pause, next, previous) goes to the group's coordinator, so it acts on the whole group; volume
 * is per room.
 */
import type { Device, DeviceAction, DeviceCapabilities, MediaInfo } from "@appart3d/home";
import { createSocket } from "node:dgram";
import { createHash } from "node:crypto";
import type { BridgeConfig } from "./config.ts";
import { errMsg, logger } from "./log.ts";
import { HttpError, type Adapter, type Artwork } from "./types.ts";

const log = logger("sonos");

export type SonosConfig = BridgeConfig["sonos"];

/* ------------------------------------------------------------------ XML */

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m),
  );
}

/** Text of the first `<tag>` (any namespace prefix), unescaped once. */
export function tagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(xml);
  return m ? unescapeXml(m[1]!) : undefined;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = unescapeXml(m[2]!);
  return out;
}

/* ------------------------------------------------------------------ topology */

export interface SonosMember {
  uuid: string;
  name: string;
  ip: string;
}

export interface SonosGroup {
  coordinator: string;
  /** Visible rooms (bonded surrounds / subs left out), coordinator first. */
  members: SonosMember[];
}

/** GetZoneGroupState response → groups. */
export function parseTopology(soapXml: string): SonosGroup[] {
  const state = tagText(soapXml, "ZoneGroupState") ?? "";
  const groups: SonosGroup[] = [];
  for (const g of state.matchAll(/<ZoneGroup\s([^>]*)>([\s\S]*?)<\/ZoneGroup>/g)) {
    const coordinator = attrs(g[1]!).Coordinator ?? "";
    const members: SonosMember[] = [];
    // Satellites (bonded surrounds) sit inside their member: only top-level ZoneGroupMember tags count.
    for (const m of g[2]!.matchAll(/<ZoneGroupMember\s([^>]*?)\/?>/g)) {
      const a = attrs(m[1]!);
      if (a.Invisible === "1" || !a.UUID) continue;
      const ip = /^https?:\/\/([^:/]+)/.exec(a.Location ?? "")?.[1];
      if (!ip) continue;
      members.push({ uuid: a.UUID, name: a.ZoneName || a.UUID, ip });
    }
    members.sort((x, y) => (x.uuid === coordinator ? -1 : y.uuid === coordinator ? 1 : x.name.localeCompare(y.name)));
    if (members.length) groups.push({ coordinator, members });
  }
  return groups;
}

/* ------------------------------------------------------------------ now playing */

/** Music services by Sonos service id (`sid=` in the URI). */
const SERVICES: Record<string, string> = {
  "2": "Deezer",
  "9": "Spotify",
  "12": "Spotify",
  "160": "SoundCloud",
  "201": "Amazon Music",
  "204": "Apple Music",
  "254": "TuneIn",
  "284": "YouTube Music",
  "303": "Sonos Radio",
};

/** Where the sound comes from, read off the track / media URIs. */
export function sourceOf(trackUri = "", mediaUri = ""): string | undefined {
  for (const uri of [trackUri, mediaUri]) {
    if (!uri) continue;
    if (uri.startsWith("x-sonos-vli:")) {
      // A cast session to the speaker: "x-sonos-vli:RINCON_…:2,spotify:…" (Spotify Connect), airplay:, googlecast:…
      const kind = /,(\w+):/.exec(uri)?.[1] ?? "";
      return kind === "spotify" ? "Spotify" : kind === "airplay" ? "AirPlay" : kind === "googlecast" ? "Chromecast" : kind ? kind[0]!.toUpperCase() + kind.slice(1) : "Cast";
    }
    if (uri.startsWith("x-sonos-htastream:")) return "TV";
    if (uri.startsWith("x-rincon-stream:")) return "Line-in";
    if (uri.startsWith("x-sonos-spotify:")) return "Spotify";
    const sid = /[?&]sid=(\d+)/.exec(uri)?.[1];
    if (sid && SERVICES[sid]) return SERVICES[sid];
    if (/^(x-rincon-mp3radio|x-sonosapi-stream|x-sonosapi-radio|aac|hls-radio):/.test(uri)) return "Radio";
    if (uri.startsWith("x-file-cifs:") || uri.startsWith("x-rincon-playlist:")) return "Music library";
  }
  return undefined;
}

/** "0:04:37" → 277 s (NOT_IMPLEMENTED and empty → undefined). */
export function hms(s: string | undefined): number | undefined {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(s ?? "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
}

export interface GroupPlayback {
  state: MediaInfo["state"];
  title?: string;
  artist?: string;
  album?: string;
  source?: string;
  /** Absolute, or relative to the coordinator (`/getaa?…`). */
  art?: string;
  position?: number;
  duration?: number;
}

const clean = (v: string | undefined): string | undefined => (v && v.trim() && v !== "NOT_IMPLEMENTED" ? v.trim() : undefined);

/** Transport + position + media responses of a coordinator → what plays. */
export function parsePlayback(transportXml: string, positionXml: string, mediaXml: string): GroupPlayback {
  const ts = tagText(transportXml, "CurrentTransportState");
  const trackUri = tagText(positionXml, "TrackURI") ?? "";
  const mediaUri = tagText(mediaXml, "CurrentURI") ?? "";
  const didl = tagText(positionXml, "TrackMetaData") ?? "";
  const source = sourceOf(trackUri, mediaUri);
  const state: MediaInfo["state"] = ts === "PLAYING" || ts === "TRANSITIONING" ? "playing" : ts === "PAUSED_PLAYBACK" ? "paused" : "idle";
  const out: GroupPlayback = { state };
  if (source) out.source = source;
  if (state === "idle") return out;
  let title = clean(tagText(didl, "title"));
  let artist = clean(tagText(didl, "creator")) ?? clean(tagText(didl, "albumArtist"));
  let album = clean(tagText(didl, "album"));
  // Radio: the track is "Artist - Title" in streamContent, the title is the station.
  const stream = clean(tagText(didl, "streamContent"));
  if (stream && !stream.startsWith("ZPSTR_")) {
    const [a, ...t] = stream.split(" - ");
    album = title ?? album;
    if (t.length) {
      artist = a;
      title = t.join(" - ");
    } else title = stream;
  }
  // A TV or line-in stream has no metadata worth showing.
  if (source === "TV" || source === "Line-in") {
    title = source === "TV" ? "TV sound" : "Line-in";
    artist = album = undefined;
  }
  if (title) out.title = title;
  if (artist) out.artist = artist;
  if (album) out.album = album;
  const art = clean(tagText(didl, "albumArtURI"));
  if (art) out.art = art;
  const position = hms(tagText(positionXml, "RelTime"));
  const duration = hms(tagText(positionXml, "TrackDuration"));
  if (position !== undefined) out.position = position;
  if (duration) out.duration = duration;
  return out;
}

export const sonosId = (uuid: string) => `sonos:${uuid}`;

/** Transport commands a source allows: none for TV / line-in (live inputs), no skipping on radio. */
export function sonosControls(p: GroupPlayback | undefined): NonNullable<DeviceCapabilities["media"]> {
  if (!p || p.source === "TV" || p.source === "Line-in") return [];
  if (p.source === "Radio" || p.source === "TuneIn" || p.source === "Sonos Radio") return ["play", "pause"];
  return ["play", "pause", "next", "previous"];
}

export type SonosCommand = { to: "group"; action: "Play" | "Pause" | "Next" | "Previous" } | { to: "room"; action: "SetVolume"; value: number };

/** Device action → Sonos commands, refusing what the source does not allow. */
export function planSonosAction(p: GroupPlayback | undefined, volume: number | undefined, action: DeviceAction): SonosCommand[] {
  const controls = sonosControls(p);
  const playing = p?.state === "playing";
  const transport = (c: "play" | "pause" | "next" | "previous"): SonosCommand[] => {
    if (!controls.includes(c)) throw new HttpError(409, `${c} indisponible (${p?.source ?? "rien en lecture"})`);
    return [{ to: "group", action: c === "play" ? "Play" : c === "pause" ? "Pause" : c === "next" ? "Next" : "Previous" }];
  };
  const setVolume = (v: number): SonosCommand[] => [{ to: "room", action: "SetVolume", value: Math.max(0, Math.min(100, Math.round(v))) }];
  switch (action.type) {
    case "media":
      if (action.command === "playPause") return transport(playing ? "pause" : "play");
      return transport(action.command);
    case "toggle":
      return transport(playing ? "pause" : "play");
    case "power":
      return action.on ? (playing ? [] : transport("play")) : playing ? transport("pause") : [];
    case "volume":
      return setVolume(action.value);
    case "volumeStep":
      return setVolume((volume ?? 20) + action.delta * 3);
  }
  throw new HttpError(400, `action ${action.type} non supportée par Sonos`);
}
const artKey = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16);

/** Topology + playback + volumes → one device per room. */
export function sonosDevices(groups: SonosGroup[], playback: Map<string, GroupPlayback & { at: Date }>, volumes: Map<string, number>): Device[] {
  const out: Device[] = [];
  for (const g of groups) {
    const p = playback.get(g.coordinator);
    const names = g.members.map((m) => m.name);
    for (const m of g.members) {
      const id = sonosId(m.uuid);
      const device: Device = { id, name: m.name, kind: "speaker", source: "sonos", room: m.name, state: { on: null, reachable: false }, capabilities: {} };
      if (p) {
        const media: MediaInfo = { state: p.state };
        if (p.source) media.app = p.source;
        if (names.length > 1) media.group = names;
        if (p.state !== "idle") {
          if (p.title) media.title = p.title;
          if (p.artist) media.artist = p.artist;
          if (p.album) media.album = p.album;
          if (p.position !== undefined) media.position = p.position;
          if (p.duration !== undefined) media.duration = p.duration;
          media.updatedAt = p.at.toISOString();
          if (p.art) media.artworkUrl = `/api/home/media/${encodeURIComponent(id)}/artwork?h=${artKey(p.art)}`;
        }
        device.state = { on: p.state === "playing", reachable: true, media };
        const v = volumes.get(m.uuid);
        if (v !== undefined) {
          device.state.volume = v;
          device.capabilities.volume = true;
        }
        const controls = sonosControls(p);
        if (controls.length) device.capabilities.media = controls;
      }
      out.push(device);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ network */

const SOAP_PATHS: Record<string, string> = {
  AVTransport: "/MediaRenderer/AVTransport/Control",
  RenderingControl: "/MediaRenderer/RenderingControl/Control",
  ZoneGroupTopology: "/ZoneGroupTopology/Control",
};

async function soap(ip: string, service: keyof typeof SOAP_PATHS, action: string, args = ""): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">${args}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(`http://${ip}:1400${SOAP_PATHS[service]}`, {
    method: "POST",
    headers: { "content-type": 'text/xml; charset="utf-8"', soapaction: `"urn:schemas-upnp-org:service:${service}:1#${action}"` },
    body,
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`${ip} ${action}: HTTP ${res.status}`);
  return res.text();
}

/** Speaker IPs answering an SSDP search for Sonos zone players (empty when none within `ms`). */
export function discoverSonos(ms = 3000): Promise<string[]> {
  return new Promise((resolvePromise) => {
    const found = new Set<string>();
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    const done = () => {
      try {
        sock.close();
      } catch {
        /* closed */
      }
      resolvePromise([...found]);
    };
    sock.on("error", done);
    sock.on("message", (msg, rinfo) => {
      if (/ZonePlayer|Sonos/i.test(msg.toString("utf8"))) found.add(rinfo.address);
    });
    sock.bind(() => {
      const q = Buffer.from(["M-SEARCH * HTTP/1.1", "HOST: 239.255.255.250:1900", 'MAN: "ssdp:discover"', "MX: 1", "ST: urn:schemas-upnp-org:device:ZonePlayer:1", "", ""].join("\r\n"));
      sock.send(q, 1900, "239.255.255.250");
      setTimeout(() => sock.send(q, 1900, "239.255.255.250"), 400);
    });
    setTimeout(done, ms).unref?.();
  });
}

/* ------------------------------------------------------------------ adapter */

export class SonosAdapter implements Adapter {
  readonly name = "sonos";
  private cfg: SonosConfig;
  private groups: SonosGroup[] = [];
  private playback = new Map<string, GroupPlayback & { at: Date }>();
  private volumes = new Map<string, number>();
  private last = "";
  private timer: NodeJS.Timeout | null = null;
  private topologyAt = 0;
  private problem: string | null = null;
  private onChange: () => void = () => {};
  private art: { key: string; promise: Promise<Artwork | null> } | null = null;

  constructor(cfg: SonosConfig) {
    this.cfg = cfg;
  }

  warnings(): string[] {
    return this.problem ? [this.problem] : [];
  }

  devices(): Device[] {
    return sonosDevices(this.groups, this.playback, this.volumes);
  }

  async start(onChange: () => void): Promise<void> {
    this.onChange = onChange;
    await this.poll();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.timer = setTimeout(() => void this.poll(), this.cfg.pollMs);
    this.timer.unref?.();
  }

  private async refreshTopology(): Promise<void> {
    const known = [...this.cfg.hosts, ...this.groups.flatMap((g) => g.members.map((m) => m.ip))];
    const tryHosts = async (hosts: string[]) => {
      for (const ip of hosts) {
        try {
          return parseTopology(await soap(ip, "ZoneGroupTopology", "GetZoneGroupState"));
        } catch {
          /* next */
        }
      }
      return null;
    };
    const groups = (await tryHosts(known)) ?? (await tryHosts(await discoverSonos()));
    if (!groups) throw new Error("aucune enceinte trouvée");
    if (!this.groups.length) log.info(`${groups.reduce((n, g) => n + g.members.length, 0)} enceinte(s), ${groups.length} groupe(s)`);
    this.groups = groups;
    this.topologyAt = Date.now();
  }

  private async poll(): Promise<void> {
    await this.read();
    this.schedule();
  }

  /** Reads every group once and reports a change. */
  private async read(): Promise<void> {
    try {
      if (!this.groups.length || Date.now() - this.topologyAt > 30_000) await this.refreshTopology();
      const playback = new Map<string, GroupPlayback & { at: Date }>();
      const volumes = new Map<string, number>();
      let broken = false;
      await Promise.all(
        this.groups.map(async (g) => {
          const coord = g.members.find((m) => m.uuid === g.coordinator) ?? g.members[0]!;
          const inst = "<InstanceID>0</InstanceID>";
          try {
            const [t, p, m] = await Promise.all([
              soap(coord.ip, "AVTransport", "GetTransportInfo", inst),
              soap(coord.ip, "AVTransport", "GetPositionInfo", inst),
              soap(coord.ip, "AVTransport", "GetMediaInfo", inst),
            ]);
            playback.set(g.coordinator, { ...parsePlayback(t, p, m), at: new Date() });
          } catch {
            broken = true;
          }
          await Promise.all(
            g.members.map(async (mem) => {
              try {
                const v = Number(tagText(await soap(mem.ip, "RenderingControl", "GetVolume", `${inst}<Channel>Master</Channel>`), "CurrentVolume"));
                if (Number.isFinite(v)) volumes.set(mem.uuid, v);
              } catch {
                /* volume stays unknown */
              }
            }),
          );
        }),
      );
      // A speaker that stopped answering usually left or regrouped: re-read the topology next time.
      if (broken) this.topologyAt = 0;
      this.playback = playback;
      this.volumes = volumes;
      this.problem = null;
    } catch (e) {
      const p = `Sonos : ${errMsg(e)}`;
      if (p !== this.problem) log.warn(errMsg(e));
      this.problem = p;
      this.playback.clear();
    }
    // Position moves every poll: only a real change (track, state, group, volume) is an event.
    const sig = JSON.stringify(this.devices().map((d) => [d.id, d.state.reachable, d.state.volume, d.state.media && { ...d.state.media, position: undefined, updatedAt: undefined }]));
    if (sig !== this.last) {
      this.last = sig;
      this.onChange();
    }
  }

  async act(id: string, actions: DeviceAction[]): Promise<void> {
    const g = this.groups.find((x) => x.members.some((m) => sonosId(m.uuid) === id));
    const room = g?.members.find((m) => sonosId(m.uuid) === id);
    if (!g || !room) throw new HttpError(404, `appareil inconnu ${id}`);
    const coord = g.members.find((m) => m.uuid === g.coordinator) ?? g.members[0]!;
    const inst = "<InstanceID>0</InstanceID>";
    for (const a of actions) {
      for (const c of planSonosAction(this.playback.get(g.coordinator), this.volumes.get(room.uuid), a)) {
        try {
          if (c.action === "SetVolume") {
            await soap(room.ip, "RenderingControl", "SetVolume", `${inst}<Channel>Master</Channel><DesiredVolume>${c.value}</DesiredVolume>`);
            this.volumes.set(room.uuid, c.value);
          } else await soap(coord.ip, "AVTransport", c.action, c.action === "Play" ? `${inst}<Speed>1</Speed>` : inst);
        } catch (e) {
          throw new HttpError(502, `Sonos ${room.name} : ${errMsg(e)}`);
        }
      }
    }
    // The speaker takes a moment to report the new track / state.
    await new Promise((r) => setTimeout(r, 400));
    await this.read();
  }

  /** Cover of what the room's group plays (fetched from the speaker or the service, cached by URL). */
  artwork(id: string): Promise<Artwork | null> {
    const g = this.groups.find((x) => x.members.some((m) => sonosId(m.uuid) === id));
    const p = g && this.playback.get(g.coordinator);
    if (!g || !p?.art || p.state === "idle") return Promise.resolve(null);
    const coord = g.members.find((m) => m.uuid === g.coordinator) ?? g.members[0]!;
    const url = p.art.startsWith("/") ? `http://${coord.ip}:1400${p.art}` : p.art;
    if (!/^https?:\/\//.test(url)) return Promise.resolve(null);
    const key = artKey(p.art);
    if (this.art?.key === key) return this.art.promise;
    const promise = fetch(url, { signal: AbortSignal.timeout(8000) }).then(
      async (r): Promise<Artwork | null> => {
        const mime = r.headers.get("content-type") ?? "";
        if (!r.ok || !mime.startsWith("image/")) return null;
        return { mime, data: Buffer.from(await r.arrayBuffer()), key };
      },
      () => null,
    );
    this.art = { key, promise };
    void promise.then((a) => {
      if (!a && this.art?.key === key) setTimeout(() => this.art?.key === key && (this.art = null), 5000).unref?.();
    });
    return promise;
  }
}
