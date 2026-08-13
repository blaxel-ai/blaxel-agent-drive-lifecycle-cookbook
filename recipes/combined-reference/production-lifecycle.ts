import { randomUUID } from "node:crypto";
import type { CredentialBroker } from "../network-and-credentials/credentials.js";
import type { Lease, LifecycleCoordinator } from "../../src/coordination.js";
import { BoundedLifecycle } from "../../src/lifecycle.js";
import type { ModelOrchestrator } from "../model-orchestration/model-orchestration.js";
import { buildInvocationNetworkPolicy } from "../network-and-credentials/network-policy.js";
import type { CommandResult, WorkloadIdentity } from "../../src/types.js";
import type { WorkloadPlan } from "../model-orchestration/workloads.js";
import { WorkloadRegistry } from "../model-orchestration/workloads.js";

export type ProductionInvocationInput = {
  agentId: string;
  invocationId: string;
  request: string;
  identity: WorkloadIdentity;
  commandTimeoutSeconds?: number;
};

export type ProductionInvocationResult = {
  answer: string;
  plan: WorkloadPlan;
  commandResult: CommandResult;
};

export type ProductionLifecycleOptions = {
  ownerId?: string;
  leaseTtlMs?: number;
};

export class LifecycleOwnershipError extends Error {
  constructor(key: string) {
    super(`Lifecycle ${key} is owned by another orchestrator`);
    this.name = "LifecycleOwnershipError";
  }
}

export class ProductionLifecycle {
  private readonly ownerId: string;
  private readonly leaseTtlMs: number;

  constructor(
    private readonly lifecycle: BoundedLifecycle,
    private readonly model: ModelOrchestrator,
    private readonly workloads: WorkloadRegistry,
    private readonly credentials: CredentialBroker,
    private readonly coordinator: LifecycleCoordinator,
    options: ProductionLifecycleOptions = {},
  ) {
    this.ownerId = options.ownerId ?? randomUUID();
    this.leaseTtlMs = options.leaseTtlMs ?? 5 * 60 * 1000;
  }

  async invoke(
    input: ProductionInvocationInput,
  ): Promise<ProductionInvocationResult> {
    const key = `${input.agentId}:${input.invocationId}`;
    const leaseOwnerId = `${this.ownerId}:${randomUUID()}`;
    const lease = await this.coordinator.acquire({
      key,
      ownerId: leaseOwnerId,
      ttlMs: this.leaseTtlMs,
    });
    if (!lease) throw new LifecycleOwnershipError(key);

    try {
      return await this.runWithLease(input, lease);
    } finally {
      await this.coordinator.release(lease);
    }
  }

  private async runWithLease(
    input: ProductionInvocationInput,
    _lease: Lease,
  ): Promise<ProductionInvocationResult> {
    const plan = await this.model.plan({
      request: input.request,
      workloads: this.workloads.list(),
    });
    const workload = this.workloads.resolve(plan);
    const credential = workload.credentialDestination
      ? await this.credentials.issue({
          agentId: input.agentId,
          invocationId: input.invocationId,
          audience: workload.credentialDestination,
        })
      : undefined;
    const network = buildInvocationNetworkPolicy(
      {
        allowedDomains: workload.allowedDomains,
        ...(workload.credentialDestination === undefined
          ? {}
          : { credentialDestination: workload.credentialDestination }),
      },
      credential,
    );

    const commandResult = await this.lifecycle.invoke({
      agentId: input.agentId,
      invocationId: input.invocationId,
      identity: input.identity,
      command: workload.command,
      network,
      ...(input.commandTimeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: input.commandTimeoutSeconds }),
    });
    const answer = await this.model.respond({
      request: input.request,
      plan,
      result: commandResult,
    });

    return { answer, plan, commandResult };
  }
}
