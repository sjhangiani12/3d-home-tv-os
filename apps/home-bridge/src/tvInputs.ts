/**
 * Opens the TV's own INPUTS panel (HDMI 1, 2, 3…) from the bridge.
 *
 * Fire OS keeps input switching to itself: tuning a passthrough channel needs
 * `com.amazon.tv.permission.TUNE_INPUT` (signature|amazon), so our launcher cannot do it. What it
 * *can* do is ask the Mac, which has ADB on the TV: `input keyevent 178` (KEYCODE_TV_INPUT) draws
 * Fire OS's own input picker over whatever is on screen, and the remote does the rest.
 */
import { execFile } from "node:child_process";
import { expandHome, type BridgeConfig } from "./config.ts";

/** KEYCODE_TV_INPUT: opens the TV's input picker. */
export const TV_INPUT_KEYCODE = 178;

/** `host`, `host:port` or a USB serial — it becomes an adb argument, so keep it boring. */
export function isAdbTarget(s: string): boolean {
  return s.length > 0 && s.length <= 100 && /^[A-Za-z0-9._-]+(:\d{1,5})?$/.test(s);
}

function run(exe: string, args: string[], timeout: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout, encoding: "utf8" }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`.trim();
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out });
    });
  });
}

export type TvAdbConfig = BridgeConfig["tvAdb"];

/**
 * Wakes the TV's adb connection if it dropped, then presses the Inputs key. Throws with the adb
 * output when it fails, so the launcher can show why.
 */
export async function openInputs(cfg: TvAdbConfig, timeout = 8000): Promise<void> {
  if (!cfg.enabled) throw new Error("ADB TV désactivé (tvAdb.enabled)");
  if (!isAdbTarget(cfg.device)) throw new Error(`appareil ADB invalide : ${cfg.device}`);
  const adb = expandHome(cfg.adbPath);
  // Reconnects after a TV reboot; a no-op (exit 0) when already connected.
  await run(adb, ["connect", cfg.device], timeout);
  const key = await run(adb, ["-s", cfg.device, "shell", "input", "keyevent", String(TV_INPUT_KEYCODE)], timeout);
  if (key.code !== 0) throw new Error(key.out || "adb n'a pas répondu");
}
