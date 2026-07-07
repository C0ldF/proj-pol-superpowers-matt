import { NextResponse } from 'next/server';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../lib/supabase/server';
import { validarNovaCampanha, type NovaCampanhaInput } from '../../../../lib/campanha/validar-nova-campanha';

export async function GET() {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  const { data, error } = await adminClient()
    .from('campanha')
    .select('id, nome, subdominio, modulos_habilitados, status');
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  let body: NovaCampanhaInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }

  const resultado = validarNovaCampanha(body);
  if (!resultado.ok) {
    return NextResponse.json({ erro: resultado.erro }, { status: 400 });
  }

  const { data, error } = await adminClient()
    .from('campanha')
    .insert(resultado.campanha)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ erro: 'subdomínio já em uso' }, { status: 400 });
    }
    return NextResponse.json({ erro: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
