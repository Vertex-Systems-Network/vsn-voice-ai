import { db, ensureSchema } from "./db";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeRateLimit(
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(scope)) throw new Error("Invalid rate-limit scope");
  if (!subject || subject.length > 200) throw new Error("Invalid rate-limit subject");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new Error("Invalid rate-limit limit");
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) throw new Error("Invalid rate-limit window");

  await ensureSchema();
  const result = await db().query(
    `INSERT INTO rate_limit_windows(scope,subject,window_start,request_count,updated_at)
     VALUES (
       $1,$2,
       to_timestamp(floor(extract(epoch from clock_timestamp()) / $3) * $3),
       1,NOW()
     )
     ON CONFLICT (scope,subject,window_start) DO UPDATE SET
       request_count=rate_limit_windows.request_count + 1,
       updated_at=NOW()
     RETURNING request_count,
       GREATEST(
         1,
         CEIL(EXTRACT(EPOCH FROM ((window_start + ($3 * interval '1 second')) - clock_timestamp())))::int
       ) AS retry_after_seconds`,
    [scope, subject, windowSeconds],
  );
  const count = Number(result.rows[0]?.request_count ?? limit + 1);
  const retryAfterSeconds = Number(result.rows[0]?.retry_after_seconds ?? windowSeconds);
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

export function rateLimitResponse(decision: RateLimitDecision): Response {
  return Response.json(
    { ok: false, error: "rate_limited", retry_after_seconds: decision.retryAfterSeconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
        "X-RateLimit-Limit": String(decision.limit),
        "X-RateLimit-Remaining": String(decision.remaining),
      },
    },
  );
}
