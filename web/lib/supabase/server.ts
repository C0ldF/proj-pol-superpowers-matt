import { createClient } from '@supabase/supabase-js';

// Cliente anon para uso no middleware (Edge). Lê só a view pública.
export function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

// Cliente service-role para uso server-side (rotas/seed). Ignora RLS; nunca expor ao cliente.
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY ausente');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
