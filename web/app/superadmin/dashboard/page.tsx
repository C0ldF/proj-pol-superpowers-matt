import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';
import { DashboardSuperadminClient } from './DashboardSuperadminClient';

export default async function SuperadminDashboardPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <p>não autenticado</p>;
  }

  const { data: ehSuperadmin } = await supabase.rpc('actor_e_superadmin');
  if (!ehSuperadmin) {
    return <p>acesso restrito ao superadmin</p>;
  }

  return <DashboardSuperadminClient />;
}
