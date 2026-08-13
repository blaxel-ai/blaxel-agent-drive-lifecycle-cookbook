import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Tracer,
} from "@opentelemetry/api";
import type {
  LifecycleAttributes,
  LifecycleObserver,
} from "../../src/observability.js";

export class OpenTelemetryLifecycleObserver implements LifecycleObserver {
  private readonly tracer: Tracer;
  private readonly operations: Counter;
  private readonly duration: Histogram;

  constructor(instrumentationName = "blaxel-agent-drive-lifecycle-cookbook") {
    this.tracer = trace.getTracer(instrumentationName);
    const meter = metrics.getMeter(instrumentationName);
    this.operations = meter.createCounter("agent_lifecycle_operations", {
      description: "Lifecycle operations grouped by step and outcome.",
    });
    this.duration = meter.createHistogram(
      "agent_lifecycle_operation_duration_ms",
      {
        description: "Lifecycle operation duration in milliseconds.",
        unit: "ms",
      },
    );
  }

  async step<T>(
    name: string,
    attributes: LifecycleAttributes,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    const spanAttributes = compactAttributes(attributes);

    return this.tracer.startActiveSpan(
      `agent.lifecycle.${name}`,
      { attributes: spanAttributes },
      async (span) => {
        try {
          const result = await operation();
          this.operations.add(1, {
            ...spanAttributes,
            outcome: "success",
            step: name,
          });
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          this.operations.add(1, {
            ...spanAttributes,
            outcome: "failure",
            step: name,
          });
          span.recordException(asError(error));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: asError(error).message,
          });
          throw error;
        } finally {
          this.duration.record(performance.now() - startedAt, {
            ...spanAttributes,
            step: name,
          });
          span.end();
        }
      },
    );
  }

  event(name: string, attributes: LifecycleAttributes): void {
    const activeSpan = trace.getActiveSpan();
    activeSpan?.addEvent(name, compactAttributes(attributes));
  }
}

function compactAttributes(attributes: LifecycleAttributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined,
    ),
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
