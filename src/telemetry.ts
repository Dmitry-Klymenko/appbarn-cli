export type CliTelemetryEvent = 'ci_provider_detected';
export type CliTelemetryDimensions = { ci_provider?: 'local' | 'github_actions' | 'gitlab_ci' | 'azure_pipelines' | 'bitrise' | 'codemagic' };
export type CliTelemetrySink = { write(event: Readonly<Record<string, unknown>>): void | Promise<void> };

let sink: CliTelemetrySink | undefined;

export function setCliTelemetrySink(value: CliTelemetrySink | undefined) {
  sink = value;
}

export async function recordCliTelemetry(
  event: CliTelemetryEvent,
  result: 'success' | 'denied' | 'failed',
  dimensions?: CliTelemetryDimensions,
) {
  if (!sink) return;
  try {
    await sink.write({
      event_name: event,
      source: 'cli',
      result,
      occurred_at: Date.now(),
      ...(dimensions ? { dimensions } : {}),
    });
  } catch {
    // CLI telemetry is optional and never changes command behavior.
  }
}
