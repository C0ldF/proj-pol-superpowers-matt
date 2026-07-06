import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';

export async function POST() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
