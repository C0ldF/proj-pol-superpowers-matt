import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ssrClient } from './ssr';
import type { Modulo } from '../modulos';

type ResultadoChecagem =
  | { status: 'ok' }
  | { status: 'sem-sessao' }
  | { status: 'sem-modulo' }
  | { status: 'erro'; mensagem: string };

async function checarModulo(modulo: Modulo): Promise<ResultadoChecagem> {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: 'sem-sessao' };

  const { data, error } = await supabase.rpc('actor_tem_modulo', { p_modulo: modulo });
  if (error) return { status: 'erro', mensagem: error.message };
  return data ? { status: 'ok' } : { status: 'sem-modulo' };
}

// Checagem crua, sem semântica HTTP — reusável em Server Components,
// Server Actions e layouts (qualquer lugar que só precise de um booleano,
// não de uma resposta HTTP pronta).
export async function hasModulo(modulo: Modulo): Promise<boolean> {
  const r = await checarModulo(modulo);
  return r.status === 'ok';
}

// Wrapper pra route handler: já devolve o NextResponse certo pra cada
// motivo de bloqueio.
export async function requireModulo(modulo: Modulo): Promise<NextResponse | null> {
  const r = await checarModulo(modulo);
  if (r.status === 'ok') return null;
  if (r.status === 'sem-sessao') return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  if (r.status === 'sem-modulo') return NextResponse.json({ erro: 'módulo não habilitado' }, { status: 403 });
  return NextResponse.json({ erro: r.mensagem }, { status: 500 });
}
