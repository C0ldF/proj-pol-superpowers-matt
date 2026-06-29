import { createClient } from '@supabase/supabase-js';

// Cliente anon para uso no middleware (Edge). Lê só a view pública.
export function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}
