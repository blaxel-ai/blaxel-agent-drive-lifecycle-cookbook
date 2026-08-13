import { driveNameForAgent, sandboxNameForInvocation } from "./names.js";
import {
  NoopLifecycleCoordinator,
  type LifecycleCoordinator,
} from "./coordination.js";
import {
  NoopLifecycleObserver,
  type LifecycleObserver,
} from "./observability.js";
import type {
  CommandResult,
  RuntimeAdapter,
  WorkloadIdentity,
} from "./types.js";
import type { SandboxNetworkPolicy } from "./types.js";

export type LifecycleConfig = {
  region: string;
  image: string;
  memoryMb: number;
  /** Maximum Sandbox age from creation, not an idle timeout. */
  sandboxTtl: string;
  mountPath: string;
  defaultCommandTimeoutSeconds: number;
};

export type InvocationInput = {
  agentId: string;
  invocationId: string;
  identity: WorkloadIdentity;
  command: string;
  timeoutSeconds?: number;
  environment?: Record<string, string>;
  network?: SandboxNetworkPolicy;
};

export type InitializeInput = Omit<
  InvocationInput,
  "command" | "timeoutSeconds"
>;

export type PreparedInvocation = {
  key: string;
  agentId: string;
  invocationId: string;
  driveName: string;
  sandboxName: string;
};

export type LifecycleServices = {
  coordinator?: LifecycleCoordinator;
  observer?: LifecycleObserver;
};

export class InvocationExecutionError extends AggregateError {
  constructor(primaryError: unknown, cleanupError: unknown) {
    super(
      [primaryError, cleanupError],
      "Invocation failed and Sandbox cleanup also failed",
    );
    this.name = "InvocationExecutionError";
  }
}

const DEFAULT_CONFIG: LifecycleConfig = {
  region: "us-was-1",
  image: "blaxel/base-image:latest",
  memoryMb: 2048,
  sandboxTtl: "1h",
  mountPath: "/data",
  defaultCommandTimeoutSeconds: 60,
};

export class BoundedLifecycle {
  private readonly config: LifecycleConfig;
  private readonly coordinator: LifecycleCoordinator;
  private readonly observer: LifecycleObserver;
  private readonly initialization = new Map<
    string,
    Promise<PreparedInvocation>
  >();
  private readonly prepared = new Map<string, PreparedInvocation>();
  private readonly cleanup = new Map<string, Promise<void>>();

  constructor(
    private readonly runtime: RuntimeAdapter,
    config: Partial<LifecycleConfig> = {},
    services: LifecycleServices = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    validateCommandTimeout(this.config.defaultCommandTimeoutSeconds);
    this.coordinator = services.coordinator ?? new NoopLifecycleCoordinator();
    this.observer = services.observer ?? new NoopLifecycleObserver();
  }

  async initialize(input: InitializeInput): Promise<PreparedInvocation> {
    const key = this.invocationKey(input.agentId, input.invocationId);
    const ready = this.prepared.get(key);
    if (ready) return ready;

    const active = this.initialization.get(key);
    if (active) return active;

    const pending = this.prepare(input, key)
      .then((invocation) => {
        this.prepared.set(key, invocation);
        return invocation;
      })
      .finally(() => {
        this.initialization.delete(key);
      });

    this.initialization.set(key, pending);
    return pending;
  }

  async invoke(input: InvocationInput): Promise<CommandResult> {
    const timeoutSeconds =
      input.timeoutSeconds ?? this.config.defaultCommandTimeoutSeconds;
    validateCommandTimeout(timeoutSeconds);
    const prepared = await this.initialize(input);
    let primaryError: unknown;

    try {
      return await this.observer.step(
        "execute_command",
        this.attributes(prepared),
        () =>
          this.runtime.execute({
            sandboxName: prepared.sandboxName,
            command: input.command,
            timeoutSeconds,
            ...(input.environment === undefined
              ? {}
              : { environment: input.environment }),
          }),
      );
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await this.teardown(prepared);
      } catch (cleanupError) {
        if (primaryError !== undefined) {
          throw new InvocationExecutionError(primaryError, cleanupError);
        }
        throw cleanupError;
      }
    }
  }

  async teardown(prepared: PreparedInvocation): Promise<void> {
    const existing = this.cleanup.get(prepared.key);
    if (existing) return existing;

    const pending = this.observer
      .step("delete_sandbox", this.attributes(prepared), () =>
        this.runtime.deleteSandbox(prepared.sandboxName),
      )
      .then(() => {
        this.prepared.delete(prepared.key);
        return this.coordinator.markSandboxDeleted(prepared.sandboxName);
      })
      .catch(async (error: unknown) => {
        await this.coordinator.markCleanupFailed(prepared.sandboxName, error);
        throw error;
      })
      .finally(() => {
        this.cleanup.delete(prepared.key);
      });

    this.cleanup.set(prepared.key, pending);
    return pending;
  }

  private async prepare(
    input: InitializeInput,
    key: string,
  ): Promise<PreparedInvocation> {
    const driveName = driveNameForAgent(input.agentId);
    const sandboxName = sandboxNameForInvocation(
      input.agentId,
      input.invocationId,
    );
    let sandboxCreated = false;

    await this.observer.step(
      "ensure_drive",
      { agent_id: input.agentId, drive_name: driveName },
      () =>
        this.runtime.ensureDrive({
          name: driveName,
          region: this.config.region,
          labels: {
            "agent-id": input.agentId,
            "managed-by": "blaxel-agent-drive-lifecycle-cookbook",
          },
          permissions: [
            {
              labels: { "agent-id": input.agentId },
              mode: "read-write",
              path: "/",
            },
          ],
        }),
    );

    await this.coordinator.expectSandbox({
      lifecycleKey: key,
      sandboxName,
      agentId: input.agentId,
      invocationId: input.invocationId,
      createdAt: new Date(),
    });

    try {
      await this.observer.step(
        "create_sandbox",
        { agent_id: input.agentId, sandbox_name: sandboxName },
        () =>
          this.runtime.createSandbox({
            name: sandboxName,
            region: this.config.region,
            image: this.config.image,
            memoryMb: this.config.memoryMb,
            ttl: this.config.sandboxTtl,
            labels: {
              ...input.identity.labels,
              "agent-id": input.identity.labels["agent-id"] ?? "unmatched",
              "invocation-id": input.invocationId,
              "managed-by": "blaxel-agent-drive-lifecycle-cookbook",
            },
            ...(input.environment === undefined
              ? {}
              : { environment: input.environment }),
            ...(input.network === undefined ? {} : { network: input.network }),
          }),
      );
      sandboxCreated = true;

      await this.observer.step(
        "mount_drive",
        {
          agent_id: input.agentId,
          sandbox_name: sandboxName,
          drive_name: driveName,
        },
        () =>
          this.runtime.mountDrive({
            sandboxName,
            driveName,
            mountPath: this.config.mountPath,
            drivePath: "/",
          }),
      );
    } catch (error) {
      if (sandboxCreated) {
        try {
          await this.observer.step(
            "delete_sandbox_after_initialization_failure",
            { agent_id: input.agentId, sandbox_name: sandboxName },
            () => this.runtime.deleteSandbox(sandboxName),
          );
          await this.coordinator.markSandboxDeleted(sandboxName);
        } catch (cleanupError) {
          await this.coordinator.markCleanupFailed(sandboxName, cleanupError);
          throw new InvocationExecutionError(error, cleanupError);
        }
      } else {
        await this.coordinator.markSandboxDeleted(sandboxName);
      }
      throw error;
    }

    return {
      key,
      agentId: input.agentId,
      invocationId: input.invocationId,
      driveName,
      sandboxName,
    };
  }

  private invocationKey(agentId: string, invocationId: string): string {
    return `${agentId}:${invocationId}`;
  }

  private attributes(prepared: PreparedInvocation): Record<string, string> {
    return {
      agent_id: prepared.agentId,
      invocation_id: prepared.invocationId,
      sandbox_name: prepared.sandboxName,
      drive_name: prepared.driveName,
    };
  }
}

function validateCommandTimeout(timeoutSeconds: number): void {
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 60
  ) {
    throw new RangeError(
      "Command timeout must be an integer from 1 to 60 seconds when waiting for completion",
    );
  }
}
