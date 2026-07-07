import { NextResponse } from 'next/server';
import { requireSuperadmin } from '../../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../../lib/supabase/server';
import { isStatusCampanha } from '../../../../../lib/campanha/constantes';
import { transicionarStatus } from '../../../../../lib/campanha/transicionar-status';

export async function POST(req: Request) {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  let body: { campanhaId?: string; novoStatus?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const { campanhaId, novoStatus } = body;
  if (!campanhaId || !novoStatus) {
    return NextResponse.json({ erro: 'campanhaId e novoStatus são obrigatórios' }, { status: 400 });
  }
  if (!isStatusCampanha(novoStatus)) {
    return NextResponse.json({ erro: `status inválido: "${novoStatus}"` }, { status: 400 });
  }

  const admin = adminClient();
  const { data: atual, error: erroSelect } = await admin
    .from('campanha')
    .select('status')
    .eq('id', campanhaId)
    .single();
  if (erroSelect || !atual) {
    return NextResponse.json({ erro: 'campanha não encontrada' }, { status: 400 });
  }
  if (!isStatusCampanha(atual.status)) {
    return NextResponse.json({ erro: 'status atual da campanha é inválido' }, { status: 500 });
  }

  const resultado = transicionarStatus(atual.status, novoStatus);
  if (!resultado.valida) {
    return NextResponse.json({ erro: resultado.erro }, { status: 400 });
  }

  const { data, error } = await admin
    .from('campanha')
    .update({ ...resultado.update, atualizado_em: new Date().toISOString() })
    .eq('id', campanhaId)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 400 });
  }
  return NextResponse.json({ campanha: data });
}
