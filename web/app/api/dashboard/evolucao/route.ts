import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

export async function GET() {
  return authenticatedRpc('evolucao_pessoas');
}
