import packageJson from "@/package.json";

export const runtime = "nodejs";

const identity = packageJson as {
  name: string;
  version: string;
  anpos?: {
    source_protocol_version?: string;
    runtime_contract?: string;
  };
};

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: identity.name,
      service_version: identity.version,
      source_protocol_version: identity.anpos?.source_protocol_version ?? null,
      runtime_contract: identity.anpos?.runtime_contract ?? null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
