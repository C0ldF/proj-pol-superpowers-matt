import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';
import { buildCriarDeps } from '../../../lib/pessoa/build-criar-deps';
import { criarPessoa } from '../../../lib/pessoa/criar';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const campanha_id = user.app_metadata?.campanha_id as string | undefined;
  if (!campanha_id) return NextResponse.json({ erro: 'campanha não identificada' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }

  const { nome, titulo, cpf, telefone, email_contato,
          responsavel_id, papel, confirmar_compartilhado } = body as Record<string, string | boolean | undefined>;

  if (!nome || !responsavel_id || !papel) {
    return NextResponse.json({ erro: 'nome, responsavel_id e papel são obrigatórios' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const user_agent = req.headers.get('user-agent') ?? undefined;

  const deps = await buildCriarDeps();
  const result = await criarPessoa({
    campanha_id,
    nome: nome as string,
    titulo: titulo as string | undefined,
    cpf: cpf as string | undefined,
    telefone: telefone as string | undefined,
    email_contato: email_contato as string | undefined,
    responsavel_id: responsavel_id as string,
    papel: papel as string,
    criado_por: user.id,
    confirmar_compartilhado: Boolean(confirmar_compartilhado),
    ip,
    user_agent,
  }, deps);

  if (result.tipo === 'duplicata') {
    return NextResponse.json({
      error: 'pessoa_duplicada',
      match_por: result.match_por,
      pessoa_existente: result.pessoa_existente,
    }, { status: 409 });
  }

  const public_id = result.public_id;
  return NextResponse.json({ public_id }, { status: 201 });
}
