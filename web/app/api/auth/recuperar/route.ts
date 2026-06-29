import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '../../../../lib/supabase/server';
import { ssrClient } from '../../../../lib/supabase/ssr';
import { cpfHmac } from '../../../../lib/cpf-hmac';
import { resolverEmailParaRecuperacao } from '../../../../lib/auth/recuperacao';

const REDIRECT = '/redefinir-senha';

export async function POST(req: NextRequest) {
  const subdominio = req.headers.get('x-campanha-subdominio') ?? '';
  const generico = NextResponse.json({ ok: true }); // resposta sempre genérica
  if (!subdominio) return generico;

  let body: { identificador?: string };
  try { body = await req.json(); } catch { return generico; }
  if (!body.identificador) return generico;

  const admin = adminClient();
  const email = await resolverEmailParaRecuperacao(
    { identificador: body.identificador, subdominio },
    {
      cpfHmac: (cpf) => cpfHmac(cpf),
      resolverEmailPorCpf: async (sub, hmac) => {
        const { data } = await admin.rpc('auth_login_email', { p_subdominio: sub, p_cpf_hmac: hmac });
        return (data as string | null) ?? null;
      },
    },
  );

  if (email) {
    const ssr = ssrClient(await cookies());
    const origin = new URL(req.url).origin;
    await ssr.auth.resetPasswordForEmail(email, { redirectTo: `${origin}${REDIRECT}` });
  }
  return generico;
}
