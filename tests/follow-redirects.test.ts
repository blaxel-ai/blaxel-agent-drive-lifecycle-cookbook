import { existsSync, realpathSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * follow-redirects@1.16.1 (GHSA-8r9p-f939-6h3c, GHSA-q3jh-wrc6-jgq8): credential headers must be
 * stripped when a redirect leaves the origin, also for custom `sensitiveHeaders` names containing
 * `^` and for array-form headers. It reaches this project through axios, so it is loaded through
 * axios to exercise the copy axios uses. Both servers listen on loopback; a different port is a
 * different origin for follow-redirects.
 */
function loadFollowRedirects() {
  let req = createRequire(import.meta.url);
  const dir = (req.resolve.paths("axios") ?? [])
    .map((base) => join(base, "axios"))
    .find((c) => existsSync(join(c, "package.json")));
  // Fail rather than fall back: a copy outside axios would prove nothing.
  if (!dir) throw new Error("cannot resolve axios from this project");
  req = createRequire(join(realpathSync(dir), "package.json"));
  return req("follow-redirects") as { http: typeof http };
}

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function redirectOnce(options: Record<string, unknown>) {
  let seen: http.IncomingHttpHeaders | undefined;
  const target = await listen((req, res) => {
    seen = req.headers;
    res.end("ok");
  });
  const origin = await listen((_req, res) => {
    res.writeHead(302, {
      location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/`,
    });
    res.end();
  });
  try {
    const { http: client } = loadFollowRedirects();
    await new Promise<void>((resolve, reject) => {
      const req = client.request(
        {
          host: "127.0.0.1",
          port: (origin.address() as AddressInfo).port,
          path: "/",
          ...options,
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    target.close();
    origin.close();
  }
  expect(seen, "the redirect target was reached").toBeDefined();
  return seen as http.IncomingHttpHeaders;
}

describe("follow-redirects@1.16.1 (transitive via axios)", () => {
  it("strips a custom sensitive header containing ^ on a cross-origin redirect (GHSA-8r9p-f939-6h3c)", async () => {
    const seen = await redirectOnce({
      headers: { "X-Api^Key": "secret" },
      sensitiveHeaders: ["X-Api^Key"],
    });
    expect(seen["x-api^key"]).toBeUndefined();
  });

  it("strips an array-form Authorization header on a cross-origin redirect (GHSA-q3jh-wrc6-jgq8)", async () => {
    const seen = await redirectOnce({
      headers: ["Authorization", "Bearer secret", "X-Trace", "1"],
    });
    expect(seen.authorization).toBeUndefined();
    expect(seen["x-trace"]).toBe("1");
  });
});
