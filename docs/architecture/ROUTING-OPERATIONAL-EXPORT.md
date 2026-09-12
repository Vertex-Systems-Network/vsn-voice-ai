# Routing Operational Export Boundary

The realtime gateway keeps operational counters and cost/routing measurements in native Go integer types internally. The cross-service export boundary must not expose 64-bit counters or signed 64-bit measurements as JSON numbers because browser and JavaScript consumers can silently lose precision above `Number.MAX_SAFE_INTEGER`.

`RoutingOperationalExport` therefore serializes potentially 64-bit values as canonical base-10 decimal strings. Bounded basis-point values, schema version, warning count, and critical count remain JSON integers because their ranges are explicitly capped within 32-bit bounds.

The export is content-safe operational metadata only. It does not carry audio, transcripts, request payloads, tenant/customer identifiers, credentials, document or email content, payment data, billing-ledger truth, or accrued-spend claims. Provider cost values remain estimated configured rates derived from the existing routing observability boundary.

The canonical wire contract is `packages/contracts/schemas/routing-operational-export.schema.json`. Consumers must validate against that versioned schema and must not infer additional fields from internal Go structs.
