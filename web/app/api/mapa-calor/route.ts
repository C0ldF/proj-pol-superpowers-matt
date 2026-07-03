import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';

const GRANULARIDADES = ['zona', 'bairro'] as const;
type Granularidade = (typeof GRANULARIDADES)[number];

function granularidadeValida(v: string | null): v is Granularidade {
  return v !== null && (GRANULARIDADES as readonly string[]).includes(v);
}

export async function GET(req: NextRequest) {
  const granularidadeParam = new URL(req.url).searchParams.get('granularidade') ?? 'zona';
  if (!granularidadeValida(granularidadeParam)) {
    return NextResponse.json({ erro: 'granularidade inválida' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data, error } = await supabase.rpc('mapa_calor_agregado', {
    granularidade: granularidadeParam,
  });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
