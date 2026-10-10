import {
  loadApiProxyConfig,
  proxyApiRequest,
} from '../../../lib/api-proxy';
import {
  isSameOriginMutation,
  loadWebSessionConfig,
  sessionAccessToken,
} from '../../../lib/web-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ApiProxyRouteContext {
  readonly params: Promise<{ path: string[] }>;
}

async function handle(request: Request, context: ApiProxyRouteContext): Promise<Response> {
  const { path } = await context.params;
  const session = loadWebSessionConfig(process.env);
  const sessionConfig = session.status === 'configured' ? session.config : null;
  return proxyApiRequest(request, path, loadApiProxyConfig(process.env), {
    fetchImpl: fetch,
    accessToken: async (incoming) =>
      sessionConfig === null ? null : sessionAccessToken(incoming, sessionConfig),
    allowMutation: (incoming) =>
      isSameOriginMutation(incoming, sessionConfig === null ? null : sessionConfig.publicOrigin),
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
