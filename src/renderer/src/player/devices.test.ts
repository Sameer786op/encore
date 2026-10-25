import { describe, expect, it } from "vitest";
import { lostOutput } from "./devices";

const speakers = [
  { id: "default", group: "spk" },
  { id: "communications", group: "spk" },
  { id: "a1", group: "spk" },
];
const withHeadphones = [
  { id: "default", group: "hp" },
  { id: "communications", group: "spk" },
  { id: "a1", group: "spk" },
  { id: "b2", group: "hp" },
];

describe("lostOutput", () => {
  it("notices the headphones being unplugged", () => {
    expect(lostOutput(withHeadphones, speakers)).toBe(true);
  });

  it("ignores headphones being plugged in, even though the default moves to them", () => {
    expect(lostOutput(speakers, withHeadphones)).toBe(false);
  });

  it("ignores another device going away", () => {
    const usb = [...speakers, { id: "c3", group: "usb" }];
    expect(lostOutput(usb, speakers)).toBe(false);
  });

  it("falls back to counting when devices aren't named", () => {
    const blank = (n: number) => Array.from({ length: n }, () => ({ id: "", group: "" }));
    expect(lostOutput(blank(3), blank(2))).toBe(true);
    expect(lostOutput(blank(2), blank(3))).toBe(false);
  });
});
