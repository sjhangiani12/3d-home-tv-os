/**
 * What the home is playing, as every panel has to read it.
 *
 * The same question — "which speaker is the one to show?" — had three answers. The block ranked by how
 * many rooms a group filled; the web panel took the first speaker that was playing, in whatever order
 * the bridge happened to send them; the TV ranked by whether the remote could actually drive it. They
 * disagreed about the common case: the living-room TV's own sound is a speaker, it is reachable, and it
 * is loud — but it is a stream with no transport, so a card about it has no button that works. The TV
 * was right. This is its rule, written once.
 *
 * No display strings: a track reads differently in a 352px footer than in a phone card, so each panel
 * writes its own.
 */
import type { Device, MediaCommand, MediaInfo } from "./index.ts";
import { isReachable } from "./lights.ts";

/** Transport control offered right now (`playPause` = play or pause). */
export function canMedia(d: Device, command: MediaCommand): boolean {
  const list = d.capabilities.media ?? [];
  return command === "playPause" ? list.includes("play") || list.includes("pause") : list.includes(command);
}

/** Something is loaded: a title to show, and something for the skip keys to move through. */
export function mediaLoaded(d: Device): boolean {
  return !!d.state.media && d.state.media.state !== "idle";
}

/** Rooms playing this together (Sonos names its group), or the one room it is in. */
export function mediaRooms(d: Device): string[] {
  return d.state.media?.group ?? [d.name];
}

/**
 * The one speaker worth a card. In order: one the remote can actually start or stop, then one with
 * something loaded, then one that is playing, then whichever fills the most rooms — and the name last,
 * so the answer does not change when the bridge reorders its devices.
 *
 * An idle speaker still wins over nothing: a panel that keeps the card when the house is silent names a
 * room that can be started, so its play key always has somewhere to go. Callers that would rather show
 * nothing than "Nothing playing" check `mediaLoaded` on what comes back.
 */
export function nowPlaying(devices: readonly Device[]): Device | undefined {
  const speakers = devices.filter((d) => d.kind === "speaker" && isReachable(d) && d.state.media);
  const rank = (d: Device): number =>
    (canMedia(d, "playPause") ? 1e6 : 0) + (mediaLoaded(d) ? 1e4 : 0) +
    (d.state.media!.state === "playing" ? 1e3 : 0) + mediaRooms(d).length;
  return [...speakers].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name, "en"))[0];
}

/** Seconds into the track now: interpolated from `position` sampled at `updatedAt` while playing. */
export function mediaPosition(m: MediaInfo | undefined, nowMs: number): number | undefined {
  if (!m || typeof m.position !== "number") return undefined;
  let pos = m.position;
  if (m.state === "playing" && m.updatedAt) {
    const at = Date.parse(m.updatedAt);
    if (Number.isFinite(at)) pos += Math.max(0, (nowMs - at) / 1000);
  }
  if (typeof m.duration === "number" && m.duration > 0) return Math.min(m.duration, Math.max(0, pos));
  return Math.max(0, pos);
}
