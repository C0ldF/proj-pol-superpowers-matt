import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../../lib/supabase/ssr';
import { adminClient } from '../../../../../lib/supabase/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { id } = await params;

  const { data: count, error } = await adminClient().rpc('subarvore_count', {
    p_vinculo_id: id,
  });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  // busca responsavel_id do vínculo para retornar o "acima"
  const { data: v } = await adminClient()
    .from('vinculo')
    .select('responsavel_id, pessoa:responsavel_id(public_id, nome)')
    .eq('id', id)
    .single();

  return NextResponse.json({
    count: count as number,
    responsavel_acima: v?.pessoa ?? null,
  });
}
