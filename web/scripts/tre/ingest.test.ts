import { describe, it, expect, vi } from 'vitest';
import { ingerirLote, type IngestDeps } from './ingest';
import type { LinhaCsvTre } from './tipos';

function linha(overrides: Partial<LinhaCsvTre> = {}): LinhaCsvTre {
  return {
    uf: 'PI', localidade: 'TERESINA', codLocalidadeIbge: '2211001', zona: '1',
    tipoLocalVotacao: 'CONVENCIONAL', situacaoLocalVotacao: 'ATIVO', numLocal: '1',
    dataCriacao: '2014-01-01', localVotacao: 'ESCOLA TESTE', telefone: '',
    endereco: 'RUA TESTE, 1', bairro: 'AEROPORTO', cep: '64000000',
    latitude: '-5.0', longitude: '-42.8', secoes: '(s: 1, apt: 100)',
    qtdAptos: '100', qtdCancelados: '0', qtdSuspensos: '0',
    qtdVagasReservadas: '0', qtdBaseHistorica: '0',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    upsertMunicipio: vi.fn(async () => {}),
    upsertZona: vi.fn(async () => 'zona-id'),
    criarImportacao: vi.fn(async () => 'importacao-id'),
    atualizarImportacao: vi.fn(async () => {}),
    inserirLocalVotacao: vi.fn(async () => {}),
    inserirStaging: vi.fn(async () => {}),
    ...overrides,
  };
}

const baseInput = {
  municipioId: 2211001, municipioNome: 'TERESINA', uf: 'PI', ano: 2026,
  arquivoNome: 'x.csv', arquivoSha256: 'hash', arquivoTamanhoBytes: 10, operador: 'teste',
};

describe('ingerirLote', () => {
  it('linha válida do município pedido vira local_votacao publicado, bairro_oficial_id=null, sem chamar match', async () => {
    const deps = makeDeps();
    const r = await ingerirLote({ ...baseInput, linhas: [linha()] }, deps);

    expect(r.totalPublicados).toBe(1);
    expect(r.totalStaging).toBe(0);
    expect(deps.inserirLocalVotacao).toHaveBeenCalledWith(
      expect.objectContaining({ bairroOficialId: null }),
    );
    expect(deps.inserirStaging).not.toHaveBeenCalled();
  });

  it('linha de outro município é descartada silenciosamente — não conta em totalLinhas nem em nenhum bucket', async () => {
    const deps = makeDeps();
    const linhaTeresina = linha({ codLocalidadeIbge: '2211001' });
    const linhaOutraCidade = linha({ codLocalidadeIbge: '2207702', localVotacao: 'ESCOLA PARNAIBA' });
    const r = await ingerirLote({ ...baseInput, linhas: [linhaTeresina, linhaOutraCidade] }, deps);

    expect(r.totalLinhas).toBe(1);
    expect(r.totalPublicados).toBe(1);
    expect(deps.inserirLocalVotacao).toHaveBeenCalledTimes(1);
    expect(deps.inserirLocalVotacao).toHaveBeenCalledWith(
      expect.objectContaining({ local: expect.objectContaining({ nome: 'ESCOLA TESTE' }) }),
    );
  });

  it('linha sem NUM_LOCAL vira staging com erro_parse', async () => {
    const deps = makeDeps();
    const r = await ingerirLote({ ...baseInput, linhas: [linha({ numLocal: '' })] }, deps);

    expect(r.totalErros).toBe(1);
    expect(deps.inserirStaging).toHaveBeenCalledWith(expect.objectContaining({ motivos: ['erro_parse'] }));
  });

  it('segunda linha com mesma zona+num_local vira staging com num_local_duplicado_mesma_zona', async () => {
    const deps = makeDeps();
    const linhaA = linha({ numLocal: '5', zona: '2' });
    const linhaB = linha({ numLocal: '5', zona: '2', localVotacao: 'OUTRO LOCAL' });
    const r = await ingerirLote({ ...baseInput, linhas: [linhaA, linhaB] }, deps);

    expect(r.totalPublicados).toBe(1);
    expect(r.totalStaging).toBe(1);
    expect(deps.inserirStaging).toHaveBeenCalledWith(
      expect.objectContaining({ motivos: ['num_local_duplicado_mesma_zona'] }),
    );
  });

  it('mesma num_local em zonas diferentes NÃO é tratada como duplicata', async () => {
    const deps = makeDeps();
    const linhaA = linha({ numLocal: '7', zona: '1' });
    const linhaB = linha({ numLocal: '7', zona: '2' });
    const r = await ingerirLote({ ...baseInput, linhas: [linhaA, linhaB] }, deps);

    expect(r.totalPublicados).toBe(2);
    expect(r.totalStaging).toBe(0);
  });

  it('dry-run nunca escreve', async () => {
    const deps = makeDeps();
    const r = await ingerirLote({ ...baseInput, linhas: [linha()], dryRun: true }, deps);

    expect(r.totalPublicados).toBe(1);
    expect(r.importacaoId).toBeNull();
    expect(deps.criarImportacao).not.toHaveBeenCalled();
    expect(deps.upsertMunicipio).not.toHaveBeenCalled();
    expect(deps.inserirLocalVotacao).not.toHaveBeenCalled();
    expect(deps.inserirStaging).not.toHaveBeenCalled();
    expect(deps.atualizarImportacao).not.toHaveBeenCalled();
  });

  it('lote termina em pendente_revisao, nunca publicado sozinho', async () => {
    const deps = makeDeps();
    await ingerirLote({ ...baseInput, linhas: [linha()] }, deps);
    const chamada = (deps.atualizarImportacao as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[1].status && c[1].status !== 'processando',
    );
    expect(chamada?.[1].status).toBe('pendente_revisao');
  });
});
