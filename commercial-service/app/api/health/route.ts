export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, service: "anpos-commercial-service", status: "alive" }, { status: 200 });
}
