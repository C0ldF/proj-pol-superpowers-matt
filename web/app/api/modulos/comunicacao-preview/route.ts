import { NextResponse } from 'next/server';
import { requireModulo } from '../../../../lib/supabase/require-modulo';

// Força a rota a nunca ser tratada como estática/cacheável pelo App Router —
// o resultado depende de sessão + estado mutável em modulos_habilitados, e
// nunca deve ser servido de um cache entre requests diferentes. Na prática
// o uso de cookies() dentro de requireModulo já opta a rota pra dinâmica
// automaticamente nesta versão do Next.js, mas deixamos explícito pra não
// depender desse comportamento implícito sobreviver a um refactor futuro.
export const dynamic = 'force-dynamic';

export async function GET() {
  const blocked = await requireModulo('comunicacao');
  if (blocked) return blocked;
  return NextResponse.json({ preview: true });
}
