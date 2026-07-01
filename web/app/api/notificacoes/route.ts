import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  // RLS garante que só notificações do usuário autenticado são retornadas
  const { data, error } = await supabase
    .from('notificacao')
    .select('id, tipo, payload, criado_em')
    .is('lido_em', null)
    .order('criado_em', { ascending: false });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ notificacoes: data });
}
