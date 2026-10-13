import { createReadStream } from 'node:fs';
import { inspectArtifact, type IdentityFallback } from './artifact.js';
import { ApiClient } from './client.js';
import type { Provenance } from './provenance.js';
import { recordCliTelemetry } from './telemetry.js';
import { CLI_USER_AGENT } from './version.js';

export interface UploadOptions {
  apiBase: string;
  token: string;
  appId: string;
  environmentId: string;
  file: string;
  identity?: IdentityFallback;
  provenance: Provenance;
  idempotencyKey?: string;
  workspaceId?: string;
  sourceBuildId?: string;
}

type ReserveResponse = {
  build_id: string;
  state: string;
  put?: { url: string; headers: Record<string, string> };
};

async function putArtifact(
  file: string,
  size: number,
  capability: NonNullable<ReserveResponse['put']>,
): Promise<Response> {
  const headers = new Headers(capability.headers);
  // Node streams otherwise use chunked transfer encoding, which R2's S3 PUT
  // endpoint rejects with HTTP 411.
  headers.set('Content-Length', String(size));
  return fetch(capability.url, {
    method: 'PUT',
    headers,
    body: createReadStream(file) as unknown as BodyInit,
    ...({ duplex: 'half' } as RequestInit),
  });
}

export async function uploadBuild(options: UploadOptions) {
  if (options.provenance.provider !== 'local') {
    await recordCliTelemetry('ci_provider_detected', 'success', { ci_provider: options.provenance.provider });
  }
  const artifact = await inspectArtifact(options.file, options.identity);
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const body = {
    app_id: options.appId,
    environment_id: options.environmentId,
    ...artifact,
    idempotency_key: idempotencyKey,
    source_build_id: options.sourceBuildId ?? null,
    provenance: options.provenance,
  };
  const client = new ApiClient(options.apiBase, options.token);
  const workspaceHeaders = options.workspaceId ? { 'X-AppBarn-Workspace-Id': options.workspaceId } : undefined;

  const reserve = async () => client.request<ReserveResponse>('/builds', {
    method: 'POST',
    ...(workspaceHeaders ? { headers: workspaceHeaders } : {}),
    body: JSON.stringify(body),
  });

  let reservation = await reserve();
  if (reservation.state === 'ready') return reservation;
  if (!reservation.put) throw new Error('Upload capability missing');

  let uploaded = await putArtifact(options.file, artifact.size_bytes, reservation.put);
  if (uploaded.status === 401 || uploaded.status === 403) {
    reservation = await reserve();
    if (reservation.state === 'ready') return reservation;
    if (!reservation.put) throw new Error('Upload capability missing');
    uploaded = await putArtifact(options.file, artifact.size_bytes, reservation.put);
  }
  if (!uploaded.ok) throw new Error(`Artifact upload failed: HTTP ${uploaded.status}`);

  return client.request(`/builds/${encodeURIComponent(reservation.build_id)}/finalise`, {
    method: 'POST',
    ...(workspaceHeaders ? { headers: workspaceHeaders } : {}),
  });
}
