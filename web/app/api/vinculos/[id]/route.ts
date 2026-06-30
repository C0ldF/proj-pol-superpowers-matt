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

  let destino_id: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    destino_id = (body as Record<string, string>).destino_id ?? null;
  } catch { /* ok, destino_id remains null */ }

  try {
    await removerVinculo({ vinculo_id: id, destino_id }, buildRemoverDeps());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'erro interno';
    return NextResponse.json({ erro: msg }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
