import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { Hub } from "../src/hub.ts";
import { MockAdapter } from "../src/mock.ts";

describe("hub: hidden devices", () => {
  it("leaves `hiddenDevices` out of the device list, the snapshot and scenes", async () => {
    const cfg = defaultConfig();
    cfg.defaultScene = null;
    const hub = new Hub(cfg, { adapters: [new MockAdapter(0)], sunElevation: 10, sunIntervalMs: 3_600_000 });
    await hub.start();
    const id = hub.devices().find((d) => d.kind === "light")!.id;
    const before = hub.devices().length;
    cfg.hiddenDevices = [id];
    hub.setConfig(cfg);
    expect(hub.devices().map((d) => d.id)).not.toContain(id);
    expect(hub.devices()).toHaveLength(before - 1);
    expect(hub.snapshot().devices.map((d) => d.id)).not.toContain(id);
    hub.stop();
  });
});
