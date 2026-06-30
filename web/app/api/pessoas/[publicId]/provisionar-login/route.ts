import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../../lib/supabase/ssr';
import { adminClient } from '../../../../../lib/supabase/server';

function gerarSenhaTemporaria(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const papel = user.app_metadata?.papel as string | undefined;
  if (papel !== 'gestor') {
    return NextResponse.json({ erro: 'apenas Gestor pode provisionar login' }, { status: 403 });
  }

  const campanha_id = user.app_metadata?.campanha_id as string;

  let body: { email?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  if (!body.email) return NextResponse.json({ erro: 'email obrigatório' }, { status: 400 });

  const admin = adminClient();

  // resolve UUID interno pelo public_id
  const { data: pessoa, error: pessoaErr } = await admin
    .from('pessoa')
    .select('id, cpf_hmac')
    .eq('public_id', publicId)
    .eq('campanha_id', campanha_id)
    .single();

  if (pessoaErr || !pessoa) {
    return NextResponse.json({ erro: 'pessoa não encontrada' }, { status: 404 });
  }

  const senha_temporaria = gerarSenhaTemporaria();

  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: senha_temporaria,
    email_confirm: true,
  });

  if (createErr || !newUser.user) {
    return NextResponse.json({ erro: createErr?.message ?? 'erro ao criar usuário' }, { status: 500 });
  }

  // inserir usuario_campanha via função SECURITY DEFINER
  const { error: ucErr } = await admin.rpc('inserir_usuario_campanha_provisionado', {
    p_user_id:    newUser.user.id,
    p_campanha_id: campanha_id,
    p_cpf_hmac:   pessoa.cpf_hmac,
    p_pessoa_id:  pessoa.id,
  });

  if (ucErr) {
    // rollback: remover auth.users criado
    await admin.auth.admin.deleteUser(newUser.user.id);
    return NextResponse.json({ erro: ucErr.message }, { status: 500 });
  }

  return NextResponse.json({ senha_temporaria }, { status: 201 });
}
