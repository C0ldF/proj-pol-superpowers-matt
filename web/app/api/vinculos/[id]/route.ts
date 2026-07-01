import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';
import { removerVinculo } from '../../../../lib/vinculo/remover';
import { buildRemoverDeps } from '../../../../lib/vinculo/build-remover-deps';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { id } = await params;

  const { data: canRemove, error: authErr } = await supabase.rpc('actor_pode_remover_vinculo', {
    actor_uid: user.id,
    p_vinculo_id: id,
  });
  if (authErr || !canRemove) {
    return NextResponse.json({ erro: 'não autorizado ou vínculo não encontrado' }, { status: 403 });
  }

  let destino_id: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    destino_id = (body as Record<string, string>).destino_id ?? null;
  } catch { /* ok, destino_id remains null */ }

  try {
    await removerVinculo({ vinculo_id: id, destino_id }, buildRemoverDeps(supabase));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'erro interno';
    const code = (e as { code?: string }).code;
    const status = code === 'NOT_FOUND' ? 404 : 500;
    return NextResponse.json({ erro: msg }, { status });
  }

  return new NextResponse(null, { status: 204 });
}
