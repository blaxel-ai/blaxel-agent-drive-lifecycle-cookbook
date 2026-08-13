import type { InvocationCredential } from "./credentials.js";
import type { SandboxNetworkPolicy } from "../../src/types.js";

export type WorkloadNetworkPolicy = {
  allowedDomains: string[];
  credentialDestination?: string;
  bypassDomains?: string[];
};

export function buildInvocationNetworkPolicy(
  workload: WorkloadNetworkPolicy,
  credential?: InvocationCredential,
): SandboxNetworkPolicy {
  const allowedDomains = unique(workload.allowedDomains);

  if (!credential) {
    return {
      allowedDomains,
      ...(workload.bypassDomains === undefined
        ? {}
        : { bypassDomains: unique(workload.bypassDomains) }),
    };
  }

  if (!workload.credentialDestination) {
    throw new Error("Credential issued without a credential destination");
  }

  if (credential.audience !== workload.credentialDestination) {
    throw new Error("Credential audience does not match the proxy destination");
  }

  if (!allowedDomains.includes(workload.credentialDestination)) {
    throw new Error(
      "Credential destination must be included in allowedDomains",
    );
  }

  return {
    allowedDomains,
    ...(workload.bypassDomains === undefined
      ? {}
      : { bypassDomains: unique(workload.bypassDomains) }),
    routes: [
      {
        destinations: [workload.credentialDestination],
        headers: {
          [credential.headerName]: `Bearer {{SECRET:${credential.secretName}}}`,
        },
        secrets: {
          [credential.secretName]: credential.token,
        },
      },
    ],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
