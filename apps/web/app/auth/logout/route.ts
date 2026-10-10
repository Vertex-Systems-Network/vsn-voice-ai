import { loadWebSessionConfig, logout } from '../../../lib/web-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const session = loadWebSessionConfig(process.env);
  if (session.status !== 'configured') {
    return Response.redirect(new URL('/', request.url), 303);
  }
  return logout(request, session.config);
}
