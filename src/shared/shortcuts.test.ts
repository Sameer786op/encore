import { describe, expect, it } from "vitest";
import { globalKeysFor, parseCombo, toAccelerator } from "./shortcuts";

describe("shortcut combinations", () => {
  it("reads modifiers and a key", () => {
    expect(parseCombo("Ctrl+Alt+ArrowRight")).toEqual({ modifiers: ["Ctrl", "Alt"], key: "ArrowRight" });
    expect(parseCombo("Space")).toEqual({ modifiers: [], key: "Space" });
    expect(parseCombo("Ctrl++")).toEqual({ modifiers: ["Ctrl"], key: "+" });
  });

  it("rejects things that aren't combinations", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("Ctrl+")).toBeNull();
    expect(parseCombo("Hyper+K")).toBeNull();
    expect(parseCombo("Ctrl+NotAKey")).toBeNull();
  });

  it("turns combinations into Electron accelerators", () => {
    expect(toAccelerator("Ctrl+Alt+ArrowRight")).toBe("Control+Alt+Right");
    expect(toAccelerator("Ctrl+Shift+L")).toBe("Control+Shift+L");
    expect(toAccelerator("Alt+F9")).toBe("Alt+F9");
  });

  it("won't make a global shortcut out of plain typing", () => {
    expect(toAccelerator("M")).toBeNull();
    expect(toAccelerator("Shift+M")).toBeNull();
    expect(toAccelerator("Space")).toBeNull();
  });

  it("fills in the defaults around the ones that were changed", () => {
    const keys = globalKeysFor({ enabled: true, keys: { like: "Ctrl+Shift+H", mini: "" } });
    expect(keys.like).toBe("Ctrl+Shift+H");
    expect(keys.mini).toBe("");
    expect(keys.playPause).toBe("Ctrl+Alt+P");
  });
});
