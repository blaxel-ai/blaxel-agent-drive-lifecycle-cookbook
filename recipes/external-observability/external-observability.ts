import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

export type ExternalObservability = {
  shutdown(): Promise<void>;
};

/**
 * Starts OTLP/HTTP trace and metric export. The exporters use standard OTEL_*
 * environment variables for endpoint, headers, TLS, and timeouts.
 */
export function startExternalObservability(
  serviceName = "agent-drive-lifecycle",
): ExternalObservability {
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 10_000,
      }),
    ],
  });
  sdk.start();

  return {
    shutdown: () => sdk.shutdown(),
  };
}
