import type { WorkloadDefinition } from "../model-orchestration/workloads.js";

export function analysisWorkload(
  apiDomain: string,
  apiPath: string,
): WorkloadDefinition {
  const apiBase = parseApiBase(apiDomain);
  const sourceUrl = new URL(apiPath, apiBase);
  if (sourceUrl.origin !== apiBase.origin) {
    throw new Error("APP_API_PATH must remain on APP_API_DOMAIN");
  }

  return {
    id: "analyze-records",
    description:
      "Fetch records, retain the full JSON artifact, and return a count.",
    command: [
      "python3 /opt/agent/run-analysis.py --source",
      shellQuote(sourceUrl.toString()),
      "--output /data/result.json",
    ].join(" "),
    allowedDomains: [apiBase.hostname],
    credentialDestination: apiBase.hostname,
  };
}

function parseApiBase(domain: string): URL {
  const base = new URL(`https://${domain}`);
  if (
    base.protocol !== "https:" ||
    base.username !== "" ||
    base.password !== "" ||
    base.port !== "" ||
    base.pathname !== "/" ||
    base.search !== "" ||
    base.hash !== ""
  ) {
    throw new Error("APP_API_DOMAIN must be a bare HTTPS hostname");
  }
  return base;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
