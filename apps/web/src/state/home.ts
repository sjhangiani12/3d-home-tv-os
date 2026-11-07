import { create } from "zustand";
import type { Device, DeviceAction, HomeScene, SunInfo } from "@appart3d/home";
import { DEFAULT_SCENES } from "@appart3d/home";
import {
  canMedia,
  applyServerDevice,
  applySnapshot,
  devicesByItem,
  failAction,
  isLightLike,
  isOn,
  isReachable,
  moveInOrder,
  resolveAction,
  sortByOrder,
  startAction,
  type DevicesState,
} from "../lib/home";
import { createBridgeClient, createMockClient, HomeHttpError, resolveBridgeBase, type HomeClient } from "../lib/homeClient";
import { useStore } from "./store";

/**
 * "Home" mode state: connection to the home bridge (or the mock), devices with optimistic
 * updates, and the panel's navigation.
 */
export type HomeStatus =
  /** No bridge here (the Home mode stays hidden). */
  | "off"
  | "connecting"
  | "online"
  /** Live events lost; retrying. */
  | "reconnecting"
  /** A bridge answered but this browser is not paired. */
  | "unauthorized"
  /** Explicitly requested (`?home=1`, widget) but unreachable for now. */
  | "offline";

export type HomeView = { kind: "list" } | { kind: "device"; id: string } | { kind: "item"; itemId: string };

export interface HomeState extends DevicesState {
  status: HomeStatus;
  client: HomeClient | null;
  home: string;
  scenes: HomeScene[];
  /** Sun position reported by the bridge (null: unknown / old bridge). */
  sun: SunInfo | null;
  /** Devices per linked 3D item id. */
  byItem: Map<string, Device[]>;
  view: HomeView;
  /** Scene being applied (spinner on its button). */
  runningScene: string | null;
  /**
   * The mood the bridge holds armed ("relax" / "read"), or null. It lives there, not here, so that a
   * press on this panel and a press on the TV cannot leave the house in two states.
   */
  activeScene: string | null;
  /** Compact single-column layout (widget, phones). */
  compact: boolean;
  /** `?widget=1`: menu-bar popover, no editor at all. */
  widget: boolean;
  /** "Arrange" mode: tiles are dragged to reorder them (no toggling). */
  organizing: boolean;

  act: (id: string, action: DeviceAction) => void;
  toggle: (id: string) => void;
  runScene: (id: string) => void;
  /** Master switch: everything off when something is on, all lights on otherwise. */
  masterPower: () => void;
  /** A room pressed as one: its lamps go off when any is lit, else every lamp that answers comes on. */
  roomPower: (room: string) => void;
  openDevice: (id: string) => void;
  /** Click on a linked 3D item: toggles its device, or lists its devices when it has several. */
  itemClicked: (itemId: string) => void;
  back: () => void;
  setCompact: (compact: boolean) => void;
  setOrganizing: (on: boolean) => void;
  /** Drag `id` onto `targetId`'s place: optimistic local reorder, then saved on the bridge (shared by every client). */
  moveDevice: (id: string, targetId: string) => void;
}

let seq = 0;
let orderSeq = 0;
let orderTimer: ReturnType<typeof setTimeout> | undefined;

function withDevices(st: DevicesState): Pick<HomeState, "devices" | "pending" | "byItem"> {
  return { devices: st.devices, pending: st.pending, byItem: devicesByItem(st.devices) };
}

export const useHome = create<HomeState>()((set, get) => ({
  status: "off",
  client: null,
  home: "",
  scenes: DEFAULT_SCENES,
  sun: null,
  devices: [],
  pending: {},
  byItem: new Map(),
  view: { kind: "list" },
  runningScene: null,
  activeScene: null,
  compact: false,
  widget: false,
  organizing: false,

  act: (id, action) => {
    const { client } = get();
    const d = get().devices.find((x) => x.id === id);
    if (!client || !d) return;
    if (!isReachable(d)) {
      useStore.getState().toast(`${d.name} is unreachable (switched off at the wall?).`, "warn");
      return;
    }
    const n = ++seq;
    set(withDevices(startAction(get(), id, action, n)));
    client.action(id, action).then(
      (device) => set(withDevices(resolveAction(get(), id, n, device))),
      (err: unknown) => {
        const before = get().pending[id]?.seq;
        set(withDevices(failAction(get(), id, n)));
        if (before === n) useStore.getState().toast(`${d.name}: ${errorText(err)}`, "error");
      },
    );
  },
  toggle: (id) => get().act(id, { type: "toggle" }),
  runScene: (id) => {
    const { client } = get();
    if (!client) return;
    set({ runningScene: id });
    client.scene(id).then(
      (snap) => set({ ...withDevices(applySnapshot(get(), snap)), runningScene: null, activeScene: snap.activeScene ?? null }),
      (err: unknown) => {
        set({ runningScene: null });
        useStore.getState().toast(`Scene failed: ${errorText(err)}`, "error");
      },
    );
  },
  masterPower: () => {
    const { devices, act } = get();
    const live = devices.filter(isReachable);
    if (live.some(isOn)) {
      for (const d of live) {
        if (!isOn(d)) continue;
        if (d.kind === "fan") {
          if ((d.state.speed ?? 0) > 0) act(d.id, { type: "speed", value: 0 });
          if (d.state.lightOn) act(d.id, { type: "fanLight", on: false });
        } else if (d.kind === "speaker") {
          if (canMedia(d, "pause")) act(d.id, { type: "media", command: "pause" });
        } else if (d.kind === "tv" && d.capabilities.buttons?.includes("tv_power")) act(d.id, { type: "button", name: "tv_power" });
        else act(d.id, { type: "power", on: false });
      }
    } else {
      for (const d of live) if (d.kind === "light" || d.kind === "plug") act(d.id, { type: "power", on: true });
    }
  },
  // There is no room device on the bridge — a room is a name several lamps share — so this is one
  // action each, and a lamp coming on while a mood is armed is re-toned by the bridge exactly as it
  // would be from a single press.
  roomPower: (room) => {
    const { devices, act } = get();
    const lamps = devices.filter((d) => isLightLike(d) && (d.room || "Other") === room && isReachable(d));
    const on = !lamps.some(isOn);
    for (const d of lamps) if (isOn(d) !== on) act(d.id, { type: "power", on });
  },
  openDevice: (id) => set({ view: { kind: "device", id } }),
  itemClicked: (itemId) => {
    const list = get().byItem.get(itemId);
    if (!list?.length) return;
    if (list.length === 1) {
      const d = list[0]!;
      // A speaker opens its "Now playing" view (a stray click must not start / stop the music); the TV
      // opens its card (apps, Ambilight, remote).
      if (d.kind === "speaker" || d.kind === "tv") set({ view: { kind: "device", id: d.id } });
      else if (isReachable(d)) get().toggle(d.id);
      else set({ view: { kind: "device", id: d.id } });
    } else {
      const tv = list.find((d) => d.kind === "tv");
      set({ view: tv ? { kind: "device", id: tv.id } : { kind: "item", itemId } });
    }
  },
  back: () => set({ view: { kind: "list" } }),
  setCompact: (compact) => {
    if (get().compact !== compact) set({ compact });
  },
  setOrganizing: (organizing) => set({ organizing }),
  moveDevice: (id, targetId) => {
    const { client, devices } = get();
    if (!client || id === targetId) return;
    const order = moveInOrder(devices.map((d) => d.id), id, targetId);
    set(withDevices({ devices: sortByOrder(devices, order), pending: get().pending }));
    orderSeq++;
    const n = orderSeq;
    clearTimeout(orderTimer);
    // Several moves while dragging: only the final order is sent.
    orderTimer = setTimeout(() => {
      client.order(order).then(
        (snap) => {
          if (n === orderSeq) useHome.setState((st) => withDevices(applySnapshot(st, snap)));
        },
        (err: unknown) => {
          useStore.getState().toast(`Order not saved: ${errorText(err)}`, "error");
          void client.snapshot().then((snap) => useHome.setState((st) => withDevices(applySnapshot(st, snap))));
        },
      );
    }, 250);
  },
}));

function errorText(err: unknown): string {
  if (err instanceof HomeHttpError) {
    if (err.status === 401 || err.status === 403) return "access denied (pair this device).";
    return err.message;
  }
  if (err instanceof TypeError) return "bridge unreachable.";
  return err instanceof Error ? err.message : "unknown error.";
}

/* ------------------------------------------------------------------ connection */

export interface HomeBootOptions {
  params: URLSearchParams;
  /** Embedded 3D view (`?view=3d`): always Home mode, same-origin bridge. */
  embed?: boolean;
}

/**
 * Finds the bridge (or starts the mock) and keeps the devices live. URL options:
 *   ?home=mock          in-browser mock (development, demos) — `&homeFail=0.3` makes actions fail
 *   ?home=1             open the Home mode at start (PWA start URL); keeps retrying if unreachable
 *   ?bridge=http://h:p  bridge base URL (remembered; `?bridge=` resets to same origin)
 *   ?widget=1           compact popover layout (menu bar app), Home mode only
 *   ?view=3d            embedded 3D view for the native apps (Home mode, see state/embed.ts)
 */
export function startHome({ params, embed = false }: HomeBootOptions): void {
  const homeParam = params.get("home");
  const widget = !embed && params.get("widget") === "1";
  const wanted = embed || widget || homeParam === "1" || homeParam === "mock" || params.has("bridge");
  useHome.setState({ widget, compact: widget });

  const client =
    homeParam === "mock"
      ? createMockClient({ failRate: Number(params.get("homeFail") ?? 0) || 0 })
      : homeParam === "0" && !embed
        ? null
        : createBridgeClient(resolveBridgeBase(params));
  if (!client) return;
  useHome.setState({ client });

  let entered = false;
  const enter = () => {
    if (entered || !wanted) return;
    entered = true;
    const s = useStore.getState();
    if (s.mode !== "home") s.setMode("home");
  };
  if (wanted) {
    useHome.setState({ status: "connecting" });
    enter();
  }

  let unsubscribe: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const refresh = () =>
    client.snapshot().then((snap) => {
      useHome.setState((st) => ({ ...withDevices(applySnapshot(st, snap)), home: snap.home, sun: snap.sun ?? null, scenes: snap.scenes?.length ? snap.scenes : DEFAULT_SCENES, activeScene: snap.activeScene ?? null, status: "online" }));
    });

  const connect = () => {
    refresh().then(
      () => {
        attempt = 0;
        enter();
        if (unsubscribe) return;
        let first = true;
        unsubscribe = client.subscribe(
          (e) => {
            if (e.type === "snapshot") useHome.setState((st) => ({ ...withDevices(applySnapshot(st, e.snapshot)), home: e.snapshot.home, sun: e.snapshot.sun ?? null, activeScene: e.snapshot.activeScene ?? null }));
            else if (e.type === "device") useHome.setState((st) => withDevices(applyServerDevice(st, e.device)));
            else if (e.type === "error") useStore.getState().toast(e.message, "warn");
          },
          (connected) => {
            if (connected) {
              if (!first) void refresh().catch(() => undefined);
              first = false;
              if (useHome.getState().status !== "online") useHome.setState({ status: "online" });
            } else if (useHome.getState().status === "online") useHome.setState({ status: "reconnecting" });
          },
        );
      },
      (err: unknown) => {
        const unauthorized = err instanceof HomeHttpError && (err.status === 401 || err.status === 403);
        if (unauthorized) {
          useHome.setState({ status: "unauthorized" });
          enter();
        } else if (wanted || useHome.getState().status !== "off") useHome.setState({ status: "offline" });
        // Not asked for and nothing answered: stay hidden, no retries (static hosting, dev server).
        if (!wanted && !unauthorized && useHome.getState().status === "off") return;
        clearTimeout(retry);
        retry = setTimeout(connect, Math.min(30000, 2000 * 2 ** attempt++));
      },
    );
  };
  connect();

  // Back from background (phone, menu bar popover): resync right away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && useHome.getState().status !== "off") void refresh().catch(() => undefined);
  });
}

/** Home mode can be shown (a bridge or the mock answered, or it was explicitly requested). */
export function homeAvailable(status: HomeStatus): boolean {
  return status !== "off";
}
