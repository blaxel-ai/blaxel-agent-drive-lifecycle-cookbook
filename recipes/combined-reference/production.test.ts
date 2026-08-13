import { describe, expect, it } from "vitest";
import {
  BoundedLifecycle,
  CleanupReconciler,
  ExampleHmacCredentialBroker,
  InMemoryLifecycleCoordinator,
  LifecycleOwnershipError,
  ProductionLifecycle,
  WorkloadRegistry,
  type ModelOrchestrator,
  type ModelRequest,
  type WorkloadPlan,
} from "../index.js";
import { FakeRuntimeAdapter } from "../../tests/support/fake-runtime.js";
import { analysisWorkload } from "./analysis-workload.js";

class FixedModel implements ModelOrchestrator {
  readonly planInputs: ModelRequest[] = [];

  constructor(private readonly selectedWorkload: string) {}

  async plan(input: ModelRequest): Promise<WorkloadPlan> {
    this.planInputs.push(input);
    return {
      workloadId: this.selectedWorkload,
      rationale: "pre-reviewed match",
    };
  }

  async respond(): Promise<string> {
    return "completed";
  }
}

const identity = { labels: { "agent-id": "agent-1" } };

describe("ProductionLifecycle", () => {
  it("rejects API configuration that could escape the reviewed workload", () => {
    expect(() =>
      analysisWorkload("api.example.com; touch /tmp/pwned", "/v1/records"),
    ).toThrow();
    expect(() =>
      analysisWorkload("api.example.com", "//other.example.com/records"),
    ).toThrow("must remain on APP_API_DOMAIN");
  });

  it("limits the model to a reviewed workload and injects a short-lived proxy secret", async () => {
    const runtime = new FakeRuntimeAdapter();
    const coordinator = new InMemoryLifecycleCoordinator();
    const model = new FixedModel("analyze-records");
    const production = new ProductionLifecycle(
      new BoundedLifecycle(runtime, {}, { coordinator }),
      model,
      new WorkloadRegistry([
        {
          id: "analyze-records",
          description: "Analyze approved records",
          command: "write:/result.txt:42",
          allowedDomains: ["api.example.com"],
          credentialDestination: "api.example.com",
        },
      ]),
      new ExampleHmacCredentialBroker(
        "a-secure-development-key-with-32-characters",
      ),
      coordinator,
      { ownerId: "owner-1" },
    );

    const result = await production.invoke({
      agentId: "agent-1",
      invocationId: "message-1",
      request: "Count the approved records",
      identity,
    });

    expect(result.answer).toBe("completed");
    expect(model.planInputs).toEqual([
      {
        request: "Count the approved records",
        workloads: [
          { id: "analyze-records", description: "Analyze approved records" },
        ],
      },
    ]);
    expect(runtime.createdSandboxes[0]?.network).toMatchObject({
      allowedDomains: ["api.example.com"],
      routes: [
        {
          destinations: ["api.example.com"],
          headers: { Authorization: "Bearer {{SECRET:invocation-token}}" },
        },
      ],
    });
    const token =
      runtime.createdSandboxes[0]?.network?.routes?.[0]?.secrets?.[
        "invocation-token"
      ];
    expect(token?.split(".")).toHaveLength(3);
    expect(JSON.stringify(model.planInputs)).not.toContain(token);
    expect(runtime.sandboxDeletes).toBe(1);
  });

  it("rejects an unregistered model selection before creating a Sandbox", async () => {
    const runtime = new FakeRuntimeAdapter();
    const coordinator = new InMemoryLifecycleCoordinator();
    const production = new ProductionLifecycle(
      new BoundedLifecycle(runtime, {}, { coordinator }),
      new FixedModel("arbitrary-shell"),
      new WorkloadRegistry([]),
      new ExampleHmacCredentialBroker(
        "a-secure-development-key-with-32-characters",
      ),
      coordinator,
    );

    await expect(
      production.invoke({
        agentId: "agent-1",
        invocationId: "message-2",
        request: "Run anything",
        identity,
      }),
    ).rejects.toThrow("unknown workload");
    expect(runtime.sandboxCreates).toBe(0);
  });

  it("rejects a lifecycle already leased by another owner", async () => {
    const runtime = new FakeRuntimeAdapter();
    const coordinator = new InMemoryLifecycleCoordinator();
    await coordinator.acquire({
      key: "agent-1:message-3",
      ownerId: "owner-a",
      ttlMs: 60_000,
    });
    const production = new ProductionLifecycle(
      new BoundedLifecycle(runtime, {}, { coordinator }),
      new FixedModel("unused"),
      new WorkloadRegistry([]),
      new ExampleHmacCredentialBroker(
        "a-secure-development-key-with-32-characters",
      ),
      coordinator,
      { ownerId: "owner-b" },
    );

    await expect(
      production.invoke({
        agentId: "agent-1",
        invocationId: "message-3",
        request: "Run",
        identity,
      }),
    ).rejects.toBeInstanceOf(LifecycleOwnershipError);
  });
});

describe("CleanupReconciler", () => {
  it("deletes and closes stale cleanup records", async () => {
    const runtime = new FakeRuntimeAdapter();
    const coordinator = new InMemoryLifecycleCoordinator();
    await coordinator.expectSandbox({
      lifecycleKey: "agent-1:message-stale",
      sandboxName: "sandbox-stale",
      agentId: "agent-1",
      invocationId: "message-stale",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await new CleanupReconciler(runtime, coordinator).runOnce({
      olderThan: new Date("2026-01-02T00:00:00Z"),
    });

    expect(result).toEqual({ inspected: 1, deleted: 1, failed: 0 });
    expect(runtime.operations).toContain("delete:sandbox-stale");
    await expect(
      coordinator.listPendingCleanup({
        olderThan: new Date("2027-01-01T00:00:00Z"),
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  it("retains a cleanup record when deletion fails", async () => {
    const runtime = new FakeRuntimeAdapter();
    runtime.failCleanup = true;
    const coordinator = new InMemoryLifecycleCoordinator();
    await coordinator.expectSandbox({
      lifecycleKey: "agent-1:message-stale",
      sandboxName: "sandbox-stale",
      agentId: "agent-1",
      invocationId: "message-stale",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await new CleanupReconciler(runtime, coordinator).runOnce({
      olderThan: new Date("2026-01-02T00:00:00Z"),
    });

    expect(result).toEqual({ inspected: 1, deleted: 0, failed: 1 });
    const pending = await coordinator.listPendingCleanup({
      olderThan: new Date("2027-01-01T00:00:00Z"),
      limit: 10,
    });
    expect(pending[0]?.lastError).toBe("Cleanup failed");
  });
});
