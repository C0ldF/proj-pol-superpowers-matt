import { cookies } from 'next/headers';
import { ssrClient } from '../../lib/supabase/ssr';
import { MapaCalorClient } from './MapaCalorClient';

export default async function MapaCalorPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <p>não autenticado</p>;
  }

  return <MapaCalorClient />;
}
