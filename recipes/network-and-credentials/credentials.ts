import { createHmac } from "node:crypto";

export type InvocationCredential = {
  audience: string;
  headerName: string;
  secretName: string;
  token: string;
  expiresAt: Date;
};

export interface CredentialBroker {
  issue(input: {
    agentId: string;
    invocationId: string;
    audience: string;
  }): Promise<InvocationCredential>;
}

/**
 * Illustrative token issuer for tests and local recipe exploration only.
 * Production applications should provide their own CredentialBroker.
 */
export class ExampleHmacCredentialBroker implements CredentialBroker {
  constructor(
    private readonly signingKey: string,
    private readonly ttlSeconds = 300,
  ) {
    if (signingKey.length < 32) {
      throw new Error(
        "Credential signing key must contain at least 32 characters",
      );
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new Error("Credential TTL must be a positive integer");
    }
  }

  async issue(input: {
    agentId: string;
    invocationId: string;
    audience: string;
  }): Promise<InvocationCredential> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAt + this.ttlSeconds;
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({
      sub: input.agentId,
      jti: input.invocationId,
      aud: input.audience,
      iat: issuedAt,
      exp: expiresAtSeconds,
    });
    const unsigned = `${header}.${payload}`;
    const signature = createHmac("sha256", this.signingKey)
      .update(unsigned)
      .digest("base64url");

    return {
      audience: input.audience,
      headerName: "Authorization",
      secretName: "invocation-token",
      token: `${unsigned}.${signature}`,
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
