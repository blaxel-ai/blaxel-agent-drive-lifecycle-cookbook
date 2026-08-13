import { describe, expect, it } from "vitest";
import {
  buildInvocationNetworkPolicy,
  ExampleHmacCredentialBroker,
} from "../index.js";

describe("credentials and network policy", () => {
  it("issues an audience-bound expiring credential", async () => {
    const broker = new ExampleHmacCredentialBroker(
      "a-secure-development-key-with-32-characters",
      60,
    );
    const credential = await broker.issue({
      agentId: "agent-1",
      invocationId: "message-1",
      audience: "api.example.com",
    });
    const payload = JSON.parse(
      Buffer.from(credential.token.split(".")[1] ?? "", "base64url").toString(),
    ) as Record<string, unknown>;

    expect(payload).toMatchObject({
      sub: "agent-1",
      jti: "message-1",
      aud: "api.example.com",
    });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(60);
  });

  it("rejects a credential whose audience differs from its proxy route", () => {
    expect(() =>
      buildInvocationNetworkPolicy(
        {
          allowedDomains: ["api.example.com"],
          credentialDestination: "api.example.com",
        },
        {
          audience: "other.example.com",
          headerName: "Authorization",
          secretName: "token",
          token: "secret",
          expiresAt: new Date(),
        },
      ),
    ).toThrow("audience does not match");
  });
});
