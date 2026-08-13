import { describe, expect, it, vi } from "vitest";
import { BlaxelModelGatewayOrchestrator } from "../index.js";

describe("BlaxelModelGatewayOrchestrator", () => {
  it("uses the configured gateway and returns a structured reviewed-workload plan", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n{"workloadId":"analyze","rationale":"matched"}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const model = new BlaxelModelGatewayOrchestrator({
      endpoint:
        "https://run.blaxel.ai/example/models/model/v1/chat/completions",
      workspace: "example",
      apiKey: "secret",
      fetch: request,
    });

    await expect(
      model.plan({
        request: "Analyze",
        workloads: [{ id: "analyze", description: "Approved analysis" }],
      }),
    ).resolves.toEqual({ workloadId: "analyze", rationale: "matched" });

    expect(request).toHaveBeenCalledOnce();
    const [, options] = request.mock.calls[0] ?? [];
    expect(options?.headers).toMatchObject({
      "X-Blaxel-Authorization": "Bearer secret",
      "X-Blaxel-Workspace": "example",
    });
    expect(options?.body).toContain("Never return a shell command");
  });

  it("rejects malformed model plans", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"command":"rm"}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const model = new BlaxelModelGatewayOrchestrator({
      endpoint:
        "https://run.blaxel.ai/example/models/model/v1/chat/completions",
      workspace: "example",
      apiKey: "secret",
      fetch: request,
    });

    await expect(model.plan({ request: "Run", workloads: [] })).rejects.toThrow(
      "workloadId and rationale",
    );
  });

  it("rejects a model endpoint without the ChatCompletions contract", () => {
    expect(
      () =>
        new BlaxelModelGatewayOrchestrator({
          endpoint: "https://run.blaxel.ai/example/models/model",
          workspace: "example",
          apiKey: "secret",
        }),
    ).toThrow("must implement the ChatCompletions API");
  });
});
