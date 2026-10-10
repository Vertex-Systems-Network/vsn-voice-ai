import { beginLogin, loadWebSessionConfig } from '../../../lib/web-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const session = loadWebSessionConfig(process.env);
  if (session.status !== 'configured') {
    return Response.redirect(new URL('/?login=unavailable', request.url), 303);
  }
  return beginLogin(session.config);
}
