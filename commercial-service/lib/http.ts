import { randomUUID } from "node:crypto";

export class RequestInputError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export function requestIdFrom(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : randomUUID();
}

export function idempotencyKeyFrom(request: Request): string | null {
  const supplied = request.headers.get("idempotency-key")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : null;
}

export async function readRawBody(request: Request, maxBytes: number): Promise<Buffer> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new RequestInputError(413, "request_body_too_large");
    }
  }
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel("request_body_too_large");
        throw new RequestInputError(413, "request_body_too_large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function readJsonBody<T>(request: Request, maxBytes = 16_384): Promise<T> {
  const raw = await readRawBody(request, maxBytes);
  if (!raw.length) return {} as T;
  try {
    return JSON.parse(raw.toString("utf8")) as T;
  } catch {
    throw new RequestInputError(400, "invalid_json");
  }
}

export function inputErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RequestInputError)) return null;
  return Response.json({ ok: false, error: error.code }, { status: error.status });
}
