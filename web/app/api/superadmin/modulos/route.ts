import { NextResponse } from 'next/server';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { isModulo } from '../../../../lib/modulos';
import { toggleModulo } from '../../../../scripts/modulos/toggle-modulo';
import { buildToggleModuloDeps } from '../../../../scripts/modulos/build-toggle-modulo-deps';

const ACOES = ['habilitar', 'desabilitar'] as const;
type Acao = (typeof ACOES)[number];
function isAcao(value: string): value is Acao {
  return (ACOES as readonly string[]).includes(value);
}

export async function POST(req: Request) {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  let body: { campanhaId?: string; modulo?: string; acao?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const { campanhaId, modulo, acao } = body;
  if (!campanhaId || !modulo || !acao) {
    return NextResponse.json({ erro: 'campanhaId, modulo e acao são obrigatórios' }, { status: 400 });
  }
  if (!isModulo(modulo)) {
    return NextResponse.json({ erro: `módulo inválido: "${modulo}"` }, { status: 400 });
  }
  if (!isAcao(acao)) {
    return NextResponse.json({ erro: `ação inválida: "${acao}"` }, { status: 400 });
  }

  try {
    await toggleModulo(acao, campanhaId, modulo, buildToggleModuloDeps());
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'erro desconhecido';
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
