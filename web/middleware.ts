import { NextRequest, NextResponse } from 'next/server';
import { extractSubdomain } from './lib/subdomain';
import { publicClient } from './lib/supabase/server';

export const config = {
  // Ignora assets e a própria rota de saúde.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|health).*)'],
};

export async function middleware(req: NextRequest) {
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

  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete('x-campanha-subdominio');
  requestHeaders.set('x-campanha-subdominio', subdominio);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
