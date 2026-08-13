import "dotenv/config";
import { describe, expect, it } from "vitest";
import { BlaxelModelGatewayOrchestrator } from "../index.js";

const describeLiveModel =
  process.env.RUN_BLAXEL_MODEL_LIVE_TESTS === "1" ? describe : describe.skip;

describeLiveModel("Blaxel Model Gateway", () => {
  it("returns ChatCompletions content from the configured endpoint", async () => {
    const model = new BlaxelModelGatewayOrchestrator({
      endpoint: required("BL_MODEL_ENDPOINT"),
      workspace: required("BL_WORKSPACE"),
      apiKey: required("BL_API_KEY"),
    });

    const answer = await model.respond({
      request: "Confirm the smoke test completed.",
      plan: { workloadId: "smoke-test", rationale: "live validation" },
      result: { logs: "completed", status: "completed", exitCode: 0 },
    });

    expect(answer.trim().length).toBeGreaterThan(0);
  }, 120_000);
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
