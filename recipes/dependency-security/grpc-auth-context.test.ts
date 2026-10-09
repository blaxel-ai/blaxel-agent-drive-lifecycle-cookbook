import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @grpc/grpc-js reaches the recipes through the OpenTelemetry OTLP gRPC
// exporters, so load it through that consumer's own resolution.
const grpc = createRequire(
  new URL(
    "../node_modules/@opentelemetry/otlp-grpc-exporter-base/",
    import.meta.url,
  ),
)("@grpc/grpc-js");

// Throwaway certificates are generated per run (no key material in Git):
// a CA, a CA-signed server and client certificate, and a self-signed rogue
// client the server must not report as authenticated.
let dir = "";
const pem = (name: string) => readFileSync(join(dir, name));
const openssl = (...args: string[]) =>
  execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
const ecKey = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1"];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "grpc-auth-"));
  openssl(
    "req",
    "-x509",
    ...ecKey,
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "2",
    "-subj",
    "/CN=test-ca",
  );
  writeFileSync(join(dir, "server.ext"), "subjectAltName=DNS:localhost\n");
  writeFileSync(join(dir, "client.ext"), "extendedKeyUsage=clientAuth\n");
  for (const [name, cn] of [
    ["server", "localhost"],
    ["client", "trusted-client"],
  ]) {
    openssl(
      "req",
      ...ecKey,
      "-nodes",
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.csr`,
      "-subj",
      `/CN=${cn}`,
    );
    openssl(
      "x509",
      "-req",
      "-in",
      `${name}.csr`,
      "-CA",
      "ca.pem",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      `${name}.pem`,
      "-days",
      "2",
      "-extfile",
      `${name}.ext`,
    );
  }
  openssl(
    "req",
    "-x509",
    ...ecKey,
    "-nodes",
    "-keyout",
    "rogue.key",
    "-out",
    "rogue.pem",
    "-days",
    "2",
    "-subj",
    "/CN=rogue-client",
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const passthrough = (value: Buffer) => value;
const service = {
  whoami: {
    path: "/test.Auth/WhoAmI",
    requestStream: false,
    responseStream: false,
    requestSerialize: passthrough,
    requestDeserialize: passthrough,
    responseSerialize: passthrough,
    responseDeserialize: passthrough,
  },
};

async function peerSeenBy(clientCert: string): Promise<string> {
  const server = new grpc.Server();
  server.addService(service, {
    whoami: (call: any, done: (err: null, value: Buffer) => void) => {
      const cert = call.getAuthContext()?.sslPeerCertificate;
      done(null, Buffer.from(cert?.subject?.CN ?? "unauthenticated"));
    },
  });
  // The advisory's path: certificate-provider credentials that request a client
  // certificate but do not require it (requireClientCertificate: false), as
  // @grpc/grpc-js-xds configures them. One provider supplies identity and CA.
  const provider = new grpc.experimental.FileWatcherCertificateProvider({
    certificateFile: join(dir, "server.pem"),
    privateKeyFile: join(dir, "server.key"),
    caCertificateFile: join(dir, "ca.pem"),
    refreshIntervalMs: 60_000,
  });
  const credentials =
    grpc.experimental.createCertificateProviderServerCredentials(
      provider,
      provider,
      false,
    );
  const port: number = await new Promise((resolve, reject) =>
    server.bindAsync(
      "localhost:0",
      credentials,
      (err: Error | null, p: number) => (err ? reject(err) : resolve(p)),
    ),
  );
  const Client = grpc.makeGenericClientConstructor(service, "Auth");
  const client = new Client(
    `localhost:${port}`,
    grpc.credentials.createSsl(
      pem("ca.pem"),
      pem(`${clientCert}.key`),
      pem(`${clientCert}.pem`),
    ),
  );
  try {
    return await new Promise((resolve, reject) =>
      client.whoami(Buffer.alloc(0), (err: Error | null, value: Buffer) =>
        err ? reject(err) : resolve(value.toString()),
      ),
    );
  } finally {
    client.close();
    server.forceShutdown();
  }
}

describe("@grpc/grpc-js getAuthContext (GHSA-m9gg-hp2v-232j)", () => {
  it("reports a CA-signed client certificate as authenticated", async () => {
    expect(await peerSeenBy("client")).toBe("trusted-client");
  });

  it("does not report an untrusted client certificate as authenticated", async () => {
    expect(await peerSeenBy("rogue")).toBe("unauthenticated");
  });
});
