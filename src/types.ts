export type WorkloadIdentity = {
  labels: Record<string, string>;
};

export type DrivePermission = {
  labels: Record<string, string>;
  mode: "read" | "read-write";
  path?: string;
};

export type DriveHandle = {
  name: string;
};

export type SandboxHandle = {
  name: string;
};

export type CommandResult = {
  logs: string;
  stdout?: string;
  stderr?: string;
  status?: string;
  exitCode?: number;
};

export type EnsureDriveInput = {
  name: string;
  region: string;
  labels: Record<string, string>;
  permissions: DrivePermission[];
};

export type CreateSandboxInput = {
  name: string;
  region: string;
  image: string;
  memoryMb: number;
  ttl: string;
  labels: Record<string, string>;
  environment?: Record<string, string>;
  network?: SandboxNetworkPolicy;
};

export type SandboxProxyRoute = {
  destinations: string[];
  headers?: Record<string, string>;
  body?: Record<string, string>;
  secrets?: Record<string, string>;
};

export type SandboxNetworkPolicy = {
  allowedDomains: string[];
  bypassDomains?: string[];
  routes?: SandboxProxyRoute[];
};

export type MountDriveInput = {
  sandboxName: string;
  driveName: string;
  mountPath: string;
  drivePath: string;
};

export type ExecuteCommandInput = {
  sandboxName: string;
  command: string;
  timeoutSeconds: number;
  environment?: Record<string, string>;
};

export interface RuntimeAdapter {
  ensureDrive(input: EnsureDriveInput): Promise<DriveHandle>;
  createSandbox(input: CreateSandboxInput): Promise<SandboxHandle>;
  mountDrive(input: MountDriveInput): Promise<void>;
  execute(input: ExecuteCommandInput): Promise<CommandResult>;
  deleteSandbox(sandboxName: string): Promise<void>;
}
