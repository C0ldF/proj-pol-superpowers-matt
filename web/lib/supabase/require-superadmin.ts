import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ssrClient } from './ssr';

type ResultadoChecagem =
  | { status: 'ok' }
  | { status: 'sem-sessao' }
  | { status: 'nao-e-superadmin' }
  | { status: 'erro'; mensagem: string };

async function checarSuperadmin(): Promise<ResultadoChecagem> {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: 'sem-sessao' };

  const { data, error } = await supabase.rpc('actor_e_superadmin');
  if (error) return { status: 'erro', mensagem: error.message };
  return data ? { status: 'ok' } : { status: 'nao-e-superadmin' };
}

export async function requireSuperadmin(): Promise<NextResponse | null> {
  const r = await checarSuperadmin();
  if (r.status === 'ok') return null;
  if (r.status === 'sem-sessao') return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  if (r.status === 'nao-e-superadmin') return NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
  return NextResponse.json({ erro: r.mensagem }, { status: 500 });
}
