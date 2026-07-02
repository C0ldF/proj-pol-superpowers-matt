export interface LoteResumo {
  status: string;
  municipioId: number;
  ano: number;
}

export interface LoteListagem {
  id: string;
  municipioId: number;
  ano: number;
  status: string;
  totalPublicados: number | null;
  totalStaging: number | null;
  totalErros: number | null;
  publicadoEm: string | null;
}

export interface LoteDeps {
  buscarLote(importacaoId: string): Promise<LoteResumo | null>;
  atualizarStatus(importacaoId: string, status: string, publicadoEm?: string): Promise<void>;
  detectarReconciliacao(importacaoId: string): Promise<number>;
  listarLotes(): Promise<LoteListagem[]>;
}

// Fase "publicar" (spec S3, decisão 2 e 15): torna o lote visível pra
// campanhas (RLS liga em status='publicado') e dispara a checagem de
// reconciliação (ADR 0017). Não exige staging zerado nem geocode completo —
// publicar é sobre liberar o que já foi curado, não terminar 100% da revisão.
export async function publicarLote(importacaoId: string, deps: LoteDeps): Promise<{ alertasReconciliacao: number }> {
  const lote = await deps.buscarLote(importacaoId);
  if (!lote) throw new Error(`lote não encontrado: ${importacaoId}`);
  if (lote.status !== 'pendente_revisao') {
    throw new Error(`lote está em '${lote.status}', só pode publicar a partir de 'pendente_revisao'`);
  }

  const alertasReconciliacao = await deps.detectarReconciliacao(importacaoId);
  await deps.atualizarStatus(importacaoId, 'publicado', new Date().toISOString());

  return { alertasReconciliacao };
}

// Libera o índice único parcial (município+ano) pra um novo lote ser publicado.
export async function despublicarLote(importacaoId: string, deps: LoteDeps): Promise<void> {
  const lote = await deps.buscarLote(importacaoId);
  if (!lote) throw new Error(`lote não encontrado: ${importacaoId}`);
  if (lote.status !== 'publicado') {
    throw new Error(`lote está em '${lote.status}', só pode despublicar a partir de 'publicado'`);
  }
  await deps.atualizarStatus(importacaoId, 'arquivado');
}

export async function listarLotes(deps: LoteDeps): Promise<LoteListagem[]> {
  return deps.listarLotes();
}
