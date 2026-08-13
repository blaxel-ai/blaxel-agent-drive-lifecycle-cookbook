import type {
  CommandResult,
  CreateSandboxInput,
  EnsureDriveInput,
  ExecuteCommandInput,
  MountDriveInput,
  RuntimeAdapter,
} from "../../src/types.js";

type FakeDrive = EnsureDriveInput & {
  files: Map<string, string>;
};

type FakeSandbox = CreateSandboxInput & {
  mountedDrive?: string;
  mountPath?: string;
};

export class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly drives = new Map<string, FakeDrive>();
  readonly sandboxes = new Map<string, FakeSandbox>();
  readonly operations: string[] = [];
  readonly createdSandboxes: CreateSandboxInput[] = [];
  readonly executedCommands: ExecuteCommandInput[] = [];

  driveCreates = 0;
  sandboxCreates = 0;
  mounts = 0;
  executions = 0;
  sandboxDeletes = 0;

  failMount = false;
  failCleanup = false;

  async ensureDrive(input: EnsureDriveInput): Promise<{ name: string }> {
    this.operations.push(`drive:${input.name}`);
    await Promise.resolve();

    if (!this.drives.has(input.name)) {
      this.driveCreates += 1;
      this.drives.set(input.name, { ...input, files: new Map() });
    }

    return { name: input.name };
  }

  async createSandbox(input: CreateSandboxInput): Promise<{ name: string }> {
    this.operations.push(`sandbox:${input.name}`);
    this.sandboxCreates += 1;
    this.createdSandboxes.push(input);
    await Promise.resolve();
    this.sandboxes.set(input.name, { ...input });
    return { name: input.name };
  }

  async mountDrive(input: MountDriveInput): Promise<void> {
    this.operations.push(`mount:${input.sandboxName}`);
    this.mounts += 1;

    if (this.failMount) throw new Error("Mount failed");

    const drive = this.drives.get(input.driveName);
    const sandbox = this.sandboxes.get(input.sandboxName);
    if (!drive || !sandbox) throw new Error("Missing drive or Sandbox");

    const allowed = drive.permissions.some((permission) =>
      Object.entries(permission.labels).every(
        ([key, value]) => sandbox.labels[key] === value,
      ),
    );

    if (drive.permissions.length > 0 && !allowed) {
      throw new Error("Permission denied: workload identity did not match");
    }

    sandbox.mountedDrive = input.driveName;
    sandbox.mountPath = input.mountPath;
  }

  async execute(input: ExecuteCommandInput): Promise<CommandResult> {
    this.operations.push(`execute:${input.sandboxName}`);
    this.executions += 1;
    this.executedCommands.push(input);

    const sandbox = this.sandboxes.get(input.sandboxName);
    const drive = sandbox?.mountedDrive
      ? this.drives.get(sandbox.mountedDrive)
      : undefined;
    if (!sandbox || !drive || !sandbox.mountPath) {
      throw new Error(
        "Command execution started before initialization completed",
      );
    }

    if (input.command === "timeout") {
      throw new Error(`Command timed out after ${input.timeoutSeconds}s`);
    }

    if (input.command === "fail") {
      throw new Error("Command failed");
    }

    const [operation, path, ...valueParts] = input.command.split(":");
    if (!operation || !path)
      throw new Error(`Unsupported command: ${input.command}`);

    if (operation === "write") {
      const value = valueParts.join(":");
      drive.files.set(path, value);
      return { logs: value, stdout: value, status: "completed" };
    }

    if (operation === "read") {
      const value = drive.files.get(path);
      if (value === undefined) throw new Error(`File not found: ${path}`);
      return { logs: value, stdout: value, status: "completed" };
    }

    throw new Error(`Unsupported command: ${input.command}`);
  }

  async deleteSandbox(sandboxName: string): Promise<void> {
    this.operations.push(`delete:${sandboxName}`);
    this.sandboxDeletes += 1;
    if (this.failCleanup) throw new Error("Cleanup failed");
    this.sandboxes.delete(sandboxName);
  }
}
