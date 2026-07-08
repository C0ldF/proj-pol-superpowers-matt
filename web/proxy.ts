import { NextRequest, NextResponse } from 'next/server';
import { extractSubdomain } from './lib/subdomain';
import { publicClient } from './lib/supabase/server';

export const config = {
  // Ignora assets e a própria rota de saúde.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|health).*)'],
};

export async function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const subdominio = extractSubdomain(host);

  // Sem subdomínio (domínio raiz) → segue sem campanha selecionada.
  if (!subdominio) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.delete('x-campanha-subdominio');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const supabase = publicClient();
  const { data } = await supabase
    .from('campanha_publica')
    .select('subdominio, nome, status')
    .eq('subdominio', subdominio)
    .maybeSingle();

  // Subdomínio inexistente → 404.
  if (!data) {
    return new NextResponse('Campanha não encontrada', { status: 404 });
  }
  // Campanha não ativa (suspensa/encerrada) → bloqueio.
  if (data.status !== 'ativa') {
    return new NextResponse('Campanha indisponível', { status: 403 });
  }

  // Reforço de sessão: a sessão precisa pertencer à campanha deste subdomínio.
  const { ssrClient } = await import('./lib/supabase/ssr');
  const { adminClient } = await import('./lib/supabase/server');
  const supabaseSsr = ssrClient(req.cookies as unknown as Parameters<typeof ssrClient>[0]);
  const { data: userData } = await supabaseSsr.auth.getUser();
  const tokenCampanhaId =
    (userData.user?.app_metadata as { campanha_id?: string } | undefined)?.campanha_id ?? null;

  if (tokenCampanhaId) {
    const { sessaoConflitaSubdominio } = await import('./lib/auth/sessao-subdominio');
    const { data: camp } = await adminClient()
      .from('campanha').select('id').eq('subdominio', subdominio).maybeSingle();
    if (sessaoConflitaSubdominio({ tokenCampanhaId, campanhaIdResolvida: camp?.id ?? null })) {
      await supabaseSsr.auth.signOut();
      return new NextResponse('Sessão inválida para esta campanha', { status: 403 });
    }
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete('x-campanha-subdominio');
  requestHeaders.set('x-campanha-subdominio', subdominio);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
