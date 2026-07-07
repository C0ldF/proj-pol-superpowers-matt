import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ssrClient } from '../../lib/supabase/ssr';
import { MapaCalorClient } from './MapaCalorClient';

export default async function MapaCalorPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <MapaCalorClient />;
}
