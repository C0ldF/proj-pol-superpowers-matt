import { NextResponse } from 'next/server';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../lib/supabase/server';

export async function GET() {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  const { data, error } = await adminClient()
    .from('campanha')
    .select('id, nome, subdominio, modulos_habilitados');
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
