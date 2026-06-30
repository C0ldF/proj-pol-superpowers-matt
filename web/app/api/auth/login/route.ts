import { NextRequest, NextResponse } from 'next/server';
import { loginCampanha } from '../../../../lib/auth/login';
import { buildLoginDeps } from '../../../../lib/auth/build-login-deps';

const ERRO_GENERICO = 'CPF/e-mail ou senha inválidos';

export async function POST(req: NextRequest) {
  const subdominio = req.headers.get('x-campanha-subdominio') ?? '';
  if (!subdominio) return NextResponse.json({ erro: 'Campanha não identificada' }, { status: 400 });

  let body: { identificador?: string; senha?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  }
  if (!body.identificador || !body.senha) {
    return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const deps = await buildLoginDeps();
  const { ok } = await loginCampanha(
    { identificador: body.identificador, senha: body.senha, subdominio, ip }, deps,
  );

  if (!ok) return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  return NextResponse.json({ ok: true });
}
