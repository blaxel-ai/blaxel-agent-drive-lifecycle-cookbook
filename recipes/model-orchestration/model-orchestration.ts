import type { CommandResult } from "../../src/types.js";
import type { WorkloadPlan } from "./workloads.js";

export type ModelRequest = {
  request: string;
  workloads: Array<{ id: string; description: string }>;
};

export interface ModelOrchestrator {
  plan(input: ModelRequest): Promise<WorkloadPlan>;
  respond(input: {
    request: string;
    plan: WorkloadPlan;
    result: CommandResult;
  }): Promise<string>;
}

export type BlaxelModelGatewayConfig = {
  endpoint: string;
  workspace: string;
  apiKey: string;
  fetch?: typeof fetch;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class BlaxelModelGatewayOrchestrator implements ModelOrchestrator {
  private readonly request: typeof fetch;

  constructor(private readonly config: BlaxelModelGatewayConfig) {
    const endpoint = new URL(config.endpoint);
    if (!endpoint.pathname.endsWith("/v1/chat/completions")) {
      throw new Error(
        "Model endpoint must implement the ChatCompletions API at /v1/chat/completions",
      );
    }
    this.request = config.fetch ?? fetch;
  }

  async plan(input: ModelRequest): Promise<WorkloadPlan> {
    const content = await this.complete([
      {
        role: "system",
        content:
          "Select exactly one pre-reviewed workload. Return JSON only with workloadId and rationale. Never return a shell command.",
      },
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ]);
    const parsed = parseJsonObject(content);

    if (
      typeof parsed.workloadId !== "string" ||
      typeof parsed.rationale !== "string"
    ) {
      throw new Error(
        "Model plan must contain workloadId and rationale strings",
      );
    }

    return {
      workloadId: parsed.workloadId,
      rationale: parsed.rationale,
    };
  }

  async respond(input: {
    request: string;
    plan: WorkloadPlan;
    result: CommandResult;
  }): Promise<string> {
    return this.complete([
      {
        role: "system",
        content:
          "Answer from the compact command result. Do not claim access to files that are not named in the result.",
      },
      {
        role: "user",
        content: JSON.stringify({
          request: input.request,
          workloadId: input.plan.workloadId,
          commandResult: {
            logs: input.result.logs,
            status: input.result.status,
          },
        }),
      },
    ]);
  }

  private async complete(
    messages: Array<{ role: "system" | "user"; content: string }>,
  ): Promise<string> {
    const response = await this.request(this.config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Blaxel-Authorization": `Bearer ${this.config.apiKey}`,
        "X-Blaxel-Workspace": this.config.workspace,
      },
      body: JSON.stringify({ messages, temperature: 0 }),
    });

    if (!response.ok) {
      throw new Error(`Model gateway returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Model gateway returned no message content");
    return content;
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(normalized);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Model plan must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
