import {
  loadApiProxyConfig,
  noServerAccessToken,
  proxyApiRequest,
} from '../../../lib/api-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ApiProxyRouteContext {
  readonly params: Promise<{ path: string[] }>;
}

async function handle(request: Request, context: ApiProxyRouteContext): Promise<Response> {
  const { path } = await context.params;
  // No browser login session exists yet, so no bearer token is attached and
  // the control API keeps answering 401 until a server-side session lands.
  return proxyApiRequest(request, path, loadApiProxyConfig(process.env), {
    fetchImpl: fetch,
    accessToken: noServerAccessToken,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
