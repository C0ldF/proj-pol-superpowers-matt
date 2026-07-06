import { NextRequest, NextResponse } from 'next/server';
import { loginSuperadmin } from '../../../../lib/auth/login-superadmin';
import { buildLoginSuperadminDeps } from '../../../../lib/auth/build-login-superadmin-deps';

const ERRO_GENERICO = 'e-mail ou senha inválidos';

export async function POST(req: NextRequest) {
  let body: { email?: string; senha?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  }
  if (!body.email || !body.senha) {
    return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  }

  const deps = await buildLoginSuperadminDeps();
  const { ok } = await loginSuperadmin({ email: body.email, senha: body.senha }, deps);

  if (!ok) return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  return NextResponse.json({ ok: true });
}
