import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const coreRequire = createRequire(require.resolve("@blaxel/core"));
const expressRequire = createRequire(coreRequire.resolve("express"));
const Ajv = coreRequire("ajv");
const qs = expressRequire("qs");
// ip-address reaches the SDK through @modelcontextprotocol/sdk -> express-rate-limit.
const { Address4, Address6 } = createRequire(
  require.resolve("express-rate-limit"),
)("ip-address");

describe("security regressions through SDK dependency resolution", () => {
  it("rejects malformed hosts and ports through the actual Ajv resolver", () => {
    const resolver = new Ajv().opts.uriResolver;
    expect(resolver.parse("https://user@[@127.0.0.1/schema").error).toMatch(
      /host is malformed/i,
    );
    expect(() =>
      resolver.serialize({
        scheme: "https",
        host: "trusted.example",
        port: "@127.0.0.1:8124",
        path: "/schema",
      }),
    ).toThrow(/port is malformed/i);
    expect(resolver.resolve("https://example.com/", "schema")).toBe(
      "https://example.com/schema",
    );
  });

  it("no longer ships toml through the SDK (GHSA-9j65-hcg3-gc64, GHSA-9qmh-m7c6-f92p)", () => {
    expect(() => coreRequire.resolve("toml")).toThrow(/cannot find module/i);
    const { parse } = coreRequire("smol-toml");
    expect(parse("answer = 42").answer).toBe(42);
  });

  it("enforces comma array limits through Express-resolved qs", () => {
    const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
    expect(() => qs.parse("a[]=1,2,3,4", options)).toThrow(
      /array limit exceeded/i,
    );
    expect(qs.parse("a[]=1,2,3", options).a).toEqual([["1", "2", "3"]]);
  });

  it("stringifies comma arrays whose elements carry a non-callable toString (GHSA-6pq8-jhm2-2vcw)", () => {
    for (const toString of [1, "x", {}]) {
      expect(() =>
        qs.stringify({ a: [{ toString }] }, { arrayFormat: "comma" }),
      ).not.toThrow();
    }
  });

  it("never matches an address against a subnet of the other family (GHSA-j6r3-76f7-8jcv)", () => {
    expect(new Address6("a00::1").isInSubnet(new Address4("10.0.0.0/8"))).toBe(
      false,
    );
    expect(new Address4("32.0.0.1").isInSubnet(new Address6("2000::/3"))).toBe(
      false,
    );
    expect(
      new Address4("10.1.2.3").isInSubnet(new Address4("10.0.0.0/8")),
    ).toBe(true);
  });
});
