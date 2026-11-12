import { describe, expect, it } from "vitest";
import { TimeoutError, withDeadline } from "./deadline";

describe("withDeadline", () => {
  it("passes a result through when it arrives in time", async () => {
    expect(await withDeadline(Promise.resolve(7), 50, "a sum")).toBe(7);
  });

  it("passes a failure through as it is", async () => {
    await expect(withDeadline(Promise.reject(new Error("no")), 50, "a sum")).rejects.toThrow("no");
  });

  it("gives up with a TimeoutError that says what was slow", async () => {
    const never = new Promise<number>(() => undefined);
    const error = await withDeadline(never, 20, "Asking YouTube").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toBe("Asking YouTube took more than 0 s");
  });
});
