import { adminClient } from '../../lib/supabase/server';
import type { ToggleModuloDeps } from './toggle-modulo';

export function buildToggleModuloDeps(): ToggleModuloDeps {
  const admin = adminClient();
  return {
    async chamarRpc(rpcName, args) {
      return admin.rpc(rpcName, args);
    },
  };
}
