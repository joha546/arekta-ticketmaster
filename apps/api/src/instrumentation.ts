import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { metrics } from '@opentelemetry/api';

let errorCounter: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null =
  null;
let sdk: NodeSDK | null = null;

export function initInstrumentation() {
  if (sdk) {
    return;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317';
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'api';

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: '0.0.1',
      'service.namespace': 'arekta-ticketmaster',
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: endpoint }),
      exportIntervalMillis: 10000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const meter = metrics.getMeter('api');
  errorCounter = meter.createCounter('http_errors_total', {
    description: 'Total HTTP errors returned by the API',
  });
}

export function getErrorCounter() {
  if (!errorCounter) {
    const meter = metrics.getMeter('api');
    errorCounter = meter.createCounter('http_errors_total');
  }
  return errorCounter;
}

export async function shutdownInstrumentation() {
  await sdk?.shutdown();
}
