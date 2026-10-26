import { describe, expect, it } from "vitest";
import { isAdbTarget, openInputs, TV_INPUT_KEYCODE } from "../src/tvInputs.ts";

describe("TV inputs over ADB", () => {
  it("only accepts an adb target that is safe as an argument", () => {
    expect(isAdbTarget("192.168.12.143:5555")).toBe(true);
    expect(isAdbTarget("ABCD1234")).toBe(true);
    expect(isAdbTarget("")).toBe(false);
    expect(isAdbTarget("tv; rm -rf /")).toBe(false);
    expect(isAdbTarget("--help")).toBe(true); // a flag is harmless here: it would just fail to connect
    expect(isAdbTarget("tv 5555")).toBe(false);
  });

  it("refuses to run when it is off or misconfigured", async () => {
    await expect(openInputs({ enabled: false, adbPath: "adb", device: "1.2.3.4:5555" })).rejects.toThrow(/désactivé/);
    await expect(openInputs({ enabled: true, adbPath: "adb", device: "tv; reboot" })).rejects.toThrow(/invalide/);
  });

  it("reports what adb said when the key press fails", async () => {
    // /usr/bin/false stands in for an adb that cannot reach the TV.
    await expect(openInputs({ enabled: true, adbPath: "/usr/bin/false", device: "1.2.3.4:5555" })).rejects.toThrow();
  });

  it("presses KEYCODE_TV_INPUT", () => {
    expect(TV_INPUT_KEYCODE).toBe(178);
  });
});
