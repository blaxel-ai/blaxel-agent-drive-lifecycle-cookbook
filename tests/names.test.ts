import { describe, expect, it } from "vitest";
import { driveNameForAgent, sandboxNameForInvocation } from "../src/index.js";

describe("resource names", () => {
  it("normalizes arbitrary identifiers into bounded resource names", () => {
    const name = sandboxNameForInvocation(
      "Agent / With Spaces",
      "Invocation:123",
    );

    expect(name).toMatch(/^agent-msg-[a-z0-9-]+$/);
    expect(name.length).toBeLessThanOrEqual(49);
  });

  it("handles long separator-heavy input in linear time", () => {
    const name = driveNameForAgent(`agent${"-".repeat(100_000)}tail`);

    expect(name).toMatch(/^agent-drive-agent-tail-[a-z0-9]+$/);
    expect(name.length).toBeLessThanOrEqual(49);
  });
});
