import { cookies } from 'next/headers';
import { ssrClient } from '../../lib/supabase/ssr';
import { DashboardClient } from './DashboardClient';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <p>não autenticado</p>;
  }

  return <DashboardClient />;
}
