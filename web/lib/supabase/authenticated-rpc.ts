import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ssrClient } from './ssr';

// Generic opcional: authenticatedRpc<RankingRow[]>('ranking_liderancas')
// documenta no call site o shape esperado, sem mudar o comportamento em
// runtime (o dado ainda vem cru do Postgres via supabase-js, sem validação).
export async function authenticatedRpc<T = unknown>(rpcName: string) {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data, error } = await supabase.rpc(rpcName);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data as T);
}
