export type BlaxelRetryOptions = {
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxElapsedMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_ELAPSED_MS = 60_000;

export function blaxelErrorCode(error: unknown): string | undefined {
  for (const candidate of errorCandidates(error)) {
    if (
      typeof candidate.code === "string" ||
      typeof candidate.code === "number"
    ) {
      return String(candidate.code);
    }
  }
  return undefined;
}

export function isBlaxelWorkloadNotFound(error: unknown): boolean {
  const code = blaxelErrorCode(error);
  return code === "WORKLOAD_NOT_FOUND" || code === "404";
}

export function isBlaxelWorkloadUnavailable(error: unknown): boolean {
  return blaxelErrorCode(error) === "WORKLOAD_UNAVAILABLE";
}

export async function retryBlaxelUnavailable<T>(
  operation: () => Promise<T>,
  options: BlaxelRetryOptions = {},
): Promise<T> {
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxElapsedMs = options.maxElapsedMs ?? DEFAULT_MAX_ELAPSED_MS;
  const sleep = options.sleep ?? defaultSleep;

  if (initialDelayMs < 0 || maxDelayMs < initialDelayMs || maxElapsedMs < 0) {
    throw new Error("Invalid Blaxel retry configuration");
  }

  const startedAt = Date.now();
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = maxElapsedMs - elapsedMs;
      if (!isBlaxelWorkloadUnavailable(error) || remainingMs <= 0) throw error;

      const boundedDelayMs = Math.min(delayMs, remainingMs);
      await sleep(boundedDelayMs);
      delayMs = Math.min(Math.max(delayMs * 2, 1), maxDelayMs);
    }
  }
}

function errorCandidates(error: unknown): Array<Record<string, unknown>> {
  if (!isRecord(error)) return [];

  const candidates = [error];
  const directError = error.error;
  const body = error.body;
  const response = error.response;

  if (isRecord(directError)) candidates.push(directError);
  if (isRecord(body) && isRecord(body.error)) candidates.push(body.error);
  if (isRecord(response) && isRecord(response.data)) {
    const responseError = response.data.error;
    if (isRecord(responseError)) candidates.push(responseError);
  }

  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
