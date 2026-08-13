import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  createDrive: vi.fn(),
  createSandbox: vi.fn(),
  deleteSandbox: vi.fn(),
  getConfiguration: vi.fn(),
  getSandbox: vi.fn(),
}));

vi.mock("@blaxel/core", () => ({
  DriveInstance: {
    createIfNotExists: sdk.createDrive,
  },
  SandboxInstance: {
    createIfNotExists: sdk.createSandbox,
    delete: sdk.deleteSandbox,
    get: sdk.getSandbox,
  },
  getConfiguration: sdk.getConfiguration,
}));

import { BlaxelRuntimeAdapter } from "../src/index.js";
import type { CreateSandboxInput } from "../src/types.js";

const sandboxInput: CreateSandboxInput = {
  name: "agent-msg-one",
  region: "us-was-1",
  image: "agent-image@sha256:abc",
  memoryMb: 2048,
  ttl: "1h",
  labels: { "agent-id": "agent-1" },
  network: {
    allowedDomains: ["api.example.com"],
    routes: [
      {
        destinations: ["api.example.com"],
        headers: { Authorization: "Bearer {{SECRET:token}}" },
        secrets: { token: "short-lived-token" },
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  sdk.getConfiguration.mockResolvedValue({
    data: {
      regions: [{ name: "us-was-1", proxyAvailable: true }],
    },
  });
});

describe("BlaxelRuntimeAdapter", () => {
  it("reconciles permissions on an existing Drive", async () => {
    const updated = {
      name: "agent-drive-one",
      region: "us-was-1",
      metadata: { labels: { "agent-id": "agent-1" } },
      permissions: [
        { labels: { "agent-id": "agent-1" }, mode: "read-write", path: "/" },
      ],
    };
    const update = vi.fn().mockResolvedValue(updated);
    sdk.createDrive.mockResolvedValue({
      name: "agent-drive-one",
      region: "us-was-1",
      metadata: { labels: {} },
      permissions: [],
      update,
    });

    await new BlaxelRuntimeAdapter().ensureDrive({
      name: "agent-drive-one",
      region: "us-was-1",
      labels: { "agent-id": "agent-1" },
      permissions: [
        { labels: { "agent-id": "agent-1" }, mode: "read-write", path: "/" },
      ],
    });

    expect(update).toHaveBeenCalledWith({
      labels: { "agent-id": "agent-1" },
      permissions: [
        { labels: { "agent-id": "agent-1" }, mode: "read-write", path: "/" },
      ],
    });
  });

  it("replaces a same-name Sandbox when its declarative fingerprint is stale", async () => {
    const freshSandbox = sandboxForRequestedConfiguration();
    sdk.createSandbox
      .mockResolvedValueOnce({
        ...freshSandbox,
        metadata: { labels: { "lifecycle-config": "stale" } },
      })
      .mockImplementationOnce((configuration) =>
        Promise.resolve(sandboxForConfiguration(configuration)),
      );
    sdk.deleteSandbox.mockResolvedValue(undefined);

    await new BlaxelRuntimeAdapter().createSandbox(sandboxInput);

    expect(sdk.deleteSandbox).toHaveBeenCalledWith(sandboxInput.name);
    expect(sdk.createSandbox).toHaveBeenCalledTimes(2);
  });

  it("keeps domain filtering compatible with the public and SDK network shapes", async () => {
    sdk.createSandbox.mockImplementation((configuration) =>
      Promise.resolve(sandboxForConfiguration(configuration)),
    );

    await new BlaxelRuntimeAdapter().createSandbox(sandboxInput);

    expect(sdk.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        network: {
          allowedDomains: ["api.example.com"],
          proxy: {
            allowedDomains: ["api.example.com"],
            routing: sandboxInput.network?.routes,
          },
        },
      }),
    );
  });

  it("fails before Sandbox creation when Proxy is unavailable in the region", async () => {
    sdk.getConfiguration.mockResolvedValue({
      data: {
        regions: [
          { name: "us-was-1", proxyAvailable: false },
          { name: "eu-lon-1", proxyAvailable: true },
        ],
      },
    });

    await expect(
      new BlaxelRuntimeAdapter().createSandbox(sandboxInput),
    ).rejects.toThrow(
      "Sandbox Proxy is not available in region us-was-1; supported regions: eu-lon-1",
    );
    expect(sdk.createSandbox).not.toHaveBeenCalled();
  });

  it("does not check Proxy capability when no network policy is requested", async () => {
    sdk.createSandbox.mockImplementation((configuration) =>
      Promise.resolve(sandboxForConfiguration(configuration)),
    );
    const { network: _network, ...inputWithoutNetwork } = sandboxInput;

    await new BlaxelRuntimeAdapter().createSandbox(inputWithoutNetwork);

    expect(sdk.getConfiguration).not.toHaveBeenCalled();
    expect(sdk.createSandbox).toHaveBeenCalledOnce();
  });

  it("caches a successful Proxy capability check per region", async () => {
    sdk.createSandbox.mockImplementation((configuration) =>
      Promise.resolve(sandboxForConfiguration(configuration)),
    );
    const adapter = new BlaxelRuntimeAdapter();

    await adapter.createSandbox(sandboxInput);
    await adapter.createSandbox({ ...sandboxInput, name: "agent-msg-two" });

    expect(sdk.getConfiguration).toHaveBeenCalledOnce();
  });

  it("uses an auto-killed synchronous process with the documented timeout bound", async () => {
    const sandbox = sandboxForRequestedConfiguration();
    sdk.createSandbox.mockImplementation((configuration) =>
      Promise.resolve(sandboxForConfiguration(configuration, sandbox)),
    );
    const adapter = new BlaxelRuntimeAdapter();
    await adapter.createSandbox(sandboxInput);

    await adapter.execute({
      sandboxName: sandboxInput.name,
      command: "echo ready",
      timeoutSeconds: 60,
    });

    expect(sandbox.process.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "echo ready",
        keepAlive: true,
        timeout: 60,
        waitForCompletion: true,
      }),
    );
  });

  it("treats an already-missing Sandbox as successful cleanup", async () => {
    sdk.deleteSandbox.mockRejectedValue({
      response: { data: { error: { code: "WORKLOAD_NOT_FOUND" } } },
    });

    await expect(
      new BlaxelRuntimeAdapter().deleteSandbox("already-gone"),
    ).resolves.toBeUndefined();
  });

  it("retries deletion while a Sandbox is temporarily unavailable", async () => {
    sdk.deleteSandbox
      .mockRejectedValueOnce({ error: { code: "WORKLOAD_UNAVAILABLE" } })
      .mockResolvedValue(undefined);
    const sleep = vi
      .fn<(delayMs: number) => Promise<void>>()
      .mockResolvedValue();

    await new BlaxelRuntimeAdapter({
      initialDelayMs: 1,
      maxDelayMs: 1,
      maxElapsedMs: 100,
      sleep,
    }).deleteSandbox("temporarily-unavailable");

    expect(sdk.deleteSandbox).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1);
  });
});

function sandboxForRequestedConfiguration() {
  return sandboxForConfiguration({ labels: {} });
}

function sandboxForConfiguration(
  configuration: { labels?: Record<string, string> },
  overrides?: any,
): any {
  if (overrides) {
    return {
      ...overrides,
      metadata: { labels: configuration.labels ?? {} },
    };
  }

  return {
    metadata: { labels: configuration.labels ?? {} },
    fs: { ls: vi.fn().mockResolvedValue([]) },
    drives: {
      list: vi.fn().mockResolvedValue([]),
      mount: vi.fn().mockResolvedValue(undefined),
    },
    process: {
      exec: vi.fn().mockResolvedValue({
        exitCode: 0,
        logs: "ready",
        status: "completed",
      }),
    },
  };
}
