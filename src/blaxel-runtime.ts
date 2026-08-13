import { createHash, randomUUID } from "node:crypto";
import { DriveInstance, SandboxInstance, getConfiguration } from "@blaxel/core";
import {
  isBlaxelWorkloadNotFound,
  isBlaxelWorkloadUnavailable,
  retryBlaxelUnavailable,
  type BlaxelRetryOptions,
} from "./blaxel-errors.js";
import type {
  CommandResult,
  CreateSandboxInput,
  EnsureDriveInput,
  ExecuteCommandInput,
  MountDriveInput,
  RuntimeAdapter,
} from "./types.js";

type Sandbox = Awaited<ReturnType<typeof SandboxInstance.get>>;

export class BlaxelRuntimeAdapter implements RuntimeAdapter {
  private readonly sandboxes = new Map<string, Sandbox>();
  private readonly proxyRegionChecks = new Map<string, Promise<void>>();

  constructor(private readonly retryOptions: BlaxelRetryOptions = {}) {}

  async ensureDrive(input: EnsureDriveInput): Promise<{ name: string }> {
    let drive = await DriveInstance.createIfNotExists({
      name: input.name,
      region: input.region,
      labels: input.labels,
      permissions: input.permissions,
    });

    if (drive.region !== input.region) {
      throw new Error(
        `Drive ${input.name} is in ${drive.region ?? "an unknown region"}; expected ${input.region}`,
      );
    }

    const labels = {
      ...(drive.metadata.labels ?? {}),
      ...input.labels,
    };
    if (
      !sameStringMap(drive.metadata.labels, labels) ||
      !samePermissions(drive.permissions, input.permissions)
    ) {
      drive = await drive.update({ labels, permissions: input.permissions });
    }

    return { name: drive.name };
  }

  async createSandbox(input: CreateSandboxInput): Promise<{ name: string }> {
    if (input.network !== undefined) {
      await this.ensureProxyRegionSupported(input.region);
    }

    const fingerprint = sandboxFingerprint(input);
    const labels = { ...input.labels, "lifecycle-config": fingerprint };
    const configuration = {
      name: input.name,
      region: input.region,
      image: input.image,
      memory: input.memoryMb,
      ttl: input.ttl,
      labels,
      ...(input.environment === undefined
        ? {}
        : {
            envs: Object.entries(input.environment).map(([name, value]) => ({
              name,
              value,
            })),
          }),
      ...(input.network === undefined
        ? {}
        : {
            network: {
              allowedDomains: input.network.allowedDomains,
              proxy: {
                allowedDomains: input.network.allowedDomains,
                ...(input.network.bypassDomains === undefined
                  ? {}
                  : { bypass: input.network.bypassDomains }),
                ...(input.network.routes === undefined
                  ? {}
                  : { routing: input.network.routes }),
              },
            },
          }),
    };

    let sandbox = await SandboxInstance.createIfNotExists(configuration);
    if (sandbox.metadata.labels?.["lifecycle-config"] !== fingerprint) {
      await this.deleteSandbox(input.name);
      sandbox = await SandboxInstance.createIfNotExists(configuration);
    }

    if (sandbox.metadata.labels?.["lifecycle-config"] !== fingerprint) {
      throw new Error(
        `Sandbox ${input.name} did not match its requested configuration`,
      );
    }

    await retryBlaxelUnavailable(() => sandbox.fs.ls("/"), this.retryOptions);
    this.sandboxes.set(input.name, sandbox);
    return { name: input.name };
  }

  async mountDrive(input: MountDriveInput): Promise<void> {
    const sandbox = await this.getSandbox(input.sandboxName);

    try {
      await sandbox.drives.mount({
        driveName: input.driveName,
        mountPath: input.mountPath,
        drivePath: input.drivePath,
      });
    } catch (error) {
      if (!isBlaxelWorkloadUnavailable(error)) throw error;

      await retryBlaxelUnavailable(async () => {
        const mounts = await sandbox.drives.list();
        const alreadyMounted = mounts.some(
          (mount) =>
            mount.driveName === input.driveName &&
            mount.mountPath === input.mountPath,
        );
        if (!alreadyMounted) {
          await sandbox.drives.mount({
            driveName: input.driveName,
            mountPath: input.mountPath,
            drivePath: input.drivePath,
          });
        }
      }, this.retryOptions);
    }

    const mounts = await retryBlaxelUnavailable(
      () => sandbox.drives.list(),
      this.retryOptions,
    );
    const mounted = mounts.some(
      (mount) =>
        mount.driveName === input.driveName &&
        mount.mountPath === input.mountPath,
    );

    if (!mounted) {
      throw new Error(
        `Drive ${input.driveName} was not visible at ${input.mountPath}`,
      );
    }
  }

  async execute(input: ExecuteCommandInput): Promise<CommandResult> {
    const sandbox = await this.getSandbox(input.sandboxName);
    const result = await sandbox.process.exec({
      name: `invocation-${randomUUID()}`,
      command: input.command,
      timeout: input.timeoutSeconds,
      waitForCompletion: true,
      keepAlive: true,
      ...(input.environment === undefined ? {} : { env: input.environment }),
    });

    if (
      result.status === "failed" ||
      result.status === "killed" ||
      result.status === "stopped" ||
      (result.exitCode !== undefined && result.exitCode !== 0)
    ) {
      throw new Error(
        `Sandbox command ${result.status}: ${result.stderr || result.logs || "no logs"}`,
      );
    }

    return {
      logs: result.logs ?? "",
      ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
      ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
      ...(result.status === undefined ? {} : { status: result.status }),
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    };
  }

  async deleteSandbox(sandboxName: string): Promise<void> {
    try {
      await retryBlaxelUnavailable(
        () => SandboxInstance.delete(sandboxName),
        this.retryOptions,
      );
    } catch (error) {
      if (!isBlaxelWorkloadNotFound(error)) throw error;
    } finally {
      this.sandboxes.delete(sandboxName);
    }
  }

  private async getSandbox(name: string): Promise<Sandbox> {
    const existing = this.sandboxes.get(name);
    if (existing) return existing;

    const sandbox = await retryBlaxelUnavailable(
      () => SandboxInstance.get(name),
      this.retryOptions,
    );
    this.sandboxes.set(name, sandbox);
    return sandbox;
  }

  private async ensureProxyRegionSupported(region: string): Promise<void> {
    const existing = this.proxyRegionChecks.get(region);
    if (existing) return existing;

    const pending = verifyProxyRegion(region).catch((error: unknown) => {
      this.proxyRegionChecks.delete(region);
      throw error;
    });
    this.proxyRegionChecks.set(region, pending);
    return pending;
  }
}

async function verifyProxyRegion(region: string): Promise<void> {
  const { data } = await getConfiguration({ throwOnError: true });
  const regions = data.regions ?? [];
  const requested = regions.find((candidate) => candidate.name === region);

  if (requested?.proxyAvailable === true) return;

  const supported = regions
    .filter((candidate) => candidate.proxyAvailable === true)
    .map((candidate) => candidate.name)
    .filter((name): name is string => name !== undefined)
    .sort();
  const supportedText =
    supported.length === 0
      ? "none reported by /configuration"
      : supported.join(", ");

  if (requested === undefined) {
    throw new Error(
      `Sandbox Proxy capability check could not find region ${region}; supported regions: ${supportedText}`,
    );
  }

  throw new Error(
    `Sandbox Proxy is not available in region ${region}; supported regions: ${supportedText}`,
  );
}

function sandboxFingerprint(input: CreateSandboxInput): string {
  return createHash("sha256")
    .update(stableSerialize(input))
    .digest("hex")
    .slice(0, 32);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function samePermissions(actual: unknown, expected: unknown): boolean {
  return stableSerialize(actual ?? []) === stableSerialize(expected);
}

function sameStringMap(actual: unknown, expected: unknown): boolean {
  return stableSerialize(actual ?? {}) === stableSerialize(expected);
}
