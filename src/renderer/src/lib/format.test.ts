import { describe, expect, it } from "vitest";
import { relativeDate, timeAgo } from "./format";

// times in the computer's own time zone, as the app shows them
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

describe("relativeDate", () => {
  const now = at(2026, 11, 3, 19, 45).getTime();

  it("counts calendar days, not 24-hour spans", () => {
    expect(relativeDate(at(2026, 11, 3, 0, 5).toISOString(), now)).toBe("Today");
    expect(relativeDate(at(2026, 11, 2, 23, 50).toISOString(), now)).toBe("Yesterday");
    expect(relativeDate(at(2026, 11, 1, 19, 36).toISOString(), now)).toBe("2 days ago");
    // 2 days and 23 hours back is three days ago, not two
    expect(relativeDate(at(2026, 10, 31, 20, 42).toISOString(), now)).toBe("3 days ago");
  });

  it("gives the date from a week back", () => {
    expect(relativeDate(at(2026, 10, 27, 12).toISOString(), now)).toBe(at(2026, 10, 27, 12).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
  });

  it("says nothing for a missing date", () => {
    expect(relativeDate("", now)).toBe("");
  });
});

describe("timeAgo", () => {
  const now = at(2026, 11, 3, 9, 0).getTime();

  it("counts minutes and hours, then days", () => {
    expect(timeAgo(at(2026, 11, 3, 8, 59).toISOString(), now)).toBe("1 minute ago");
    expect(timeAgo(at(2026, 11, 3, 6, 0).toISOString(), now)).toBe("3 hours ago");
    expect(timeAgo(at(2026, 11, 1, 22, 0).toISOString(), now)).toBe("2 days ago");
  });
});
