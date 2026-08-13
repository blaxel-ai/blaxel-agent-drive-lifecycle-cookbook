import { describe, expect, it, vi } from "vitest";
import {
  blaxelErrorCode,
  isBlaxelWorkloadNotFound,
  retryBlaxelUnavailable,
} from "../src/index.js";

describe("Blaxel structured errors", () => {
  it("reads nested structured error codes", () => {
    const error = {
      response: {
        data: {
          error: { code: "WORKLOAD_NOT_FOUND", origin: "platform" },
        },
      },
    };

    expect(blaxelErrorCode(error)).toBe("WORKLOAD_NOT_FOUND");
    expect(isBlaxelWorkloadNotFound(error)).toBe(true);
  });

  it("recognizes numeric not-found responses from the SDK", () => {
    const error = { code: 404, error: "Drive not found" };

    expect(blaxelErrorCode(error)).toBe("404");
    expect(isBlaxelWorkloadNotFound(error)).toBe(true);
  });

  it("retries workload unavailability with exponential backoff", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ error: { code: "WORKLOAD_UNAVAILABLE" } })
      .mockRejectedValueOnce({ code: "WORKLOAD_UNAVAILABLE" })
      .mockResolvedValue("ready");
    const sleep = vi
      .fn<(delayMs: number) => Promise<void>>()
      .mockResolvedValue();

    await expect(
      retryBlaxelUnavailable(operation, {
        initialDelayMs: 10,
        maxDelayMs: 100,
        maxElapsedMs: 1_000,
        sleep,
      }),
    ).resolves.toBe("ready");

    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("does not retry a non-retryable error", async () => {
    const operation = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue({ error: { code: "FORBIDDEN" } });

    await expect(retryBlaxelUnavailable(operation)).rejects.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    expect(operation).toHaveBeenCalledOnce();
  });
});
