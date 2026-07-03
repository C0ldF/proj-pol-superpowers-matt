import { describe, it, expect, vi } from 'vitest';
import { promoverStaging, descartarStaging, listarStagingPendente, type RevisarDeps } from './revisar-staging';
import type { LinhaCsvTre } from './tipos';

function linha(): LinhaCsvTre {
  return {
    uf: 'PI', localidade: 'TERESINA', codLocalidadeIbge: '2211001', zona: '1',
    tipoLocalVotacao: 'CONVENCIONAL', situacaoLocalVotacao: 'ATIVO', numLocal: '3',
    dataCriacao: '2014-01-01', localVotacao: 'ESCOLA TRES', telefone: '',
    endereco: 'RUA TRES, 300', bairro: 'ZZZNADAVER', cep: '64000000',
    latitude: '-5.07', longitude: '-42.81', secoes: '(s: 301, apt: 80)',
    qtdAptos: '80', qtdCancelados: '0', qtdSuspensos: '0',
    qtdVagasReservadas: '0', qtdBaseHistorica: '0',
  };
}

function makeDeps(overrides: Partial<RevisarDeps> = {}): RevisarDeps {
  return {
    listarPendentes: vi.fn(async () => []),
    buscarStaging: vi.fn(async () => ({ importacaoId: 'importacao-1', municipioId: 2211001, linhaOriginal: linha() })),
    upsertZona: vi.fn(async () => 'zona-1'),
    inserirLocalVotacao: vi.fn(async () => {}),
    marcarRevisado: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('promoverStaging', () => {
  it('insere local_votacao com bairro_oficial_id nulo e marca revisado', async () => {
    const deps = makeDeps();
    const r = await promoverStaging('staging-1', 'gestor-x', deps);

    expect(r.promovido).toBe(true);
    expect(deps.inserirLocalVotacao).toHaveBeenCalledWith(expect.objectContaining({
      importacaoId: 'importacao-1', zonaId: 'zona-1', bairroOficialId: null,
    }));
    expect(deps.marcarRevisado).toHaveBeenCalledWith({
      id: 'staging-1', resolvidoBairroOficialId: null, revisadoPor: 'gestor-x',
    });
  });

  it('lança se o staging não existe', async () => {
    const deps = makeDeps({ buscarStaging: vi.fn(async () => null) });
    await expect(promoverStaging('inexistente', 'gestor-x', deps)).rejects.toThrow('staging não encontrado');
  });
});

describe('descartarStaging', () => {
  it('marca revisado sem bairro e sem inserir local_votacao', async () => {
    const deps = makeDeps();
    await descartarStaging('staging-1', 'gestor-x', deps);

    expect(deps.marcarRevisado).toHaveBeenCalledWith({
      id: 'staging-1', resolvidoBairroOficialId: null, revisadoPor: 'gestor-x',
    });
    expect(deps.inserirLocalVotacao).not.toHaveBeenCalled();
  });
});

describe('listarStagingPendente', () => {
  it('delega para deps.listarPendentes', async () => {
    const deps = makeDeps({ listarPendentes: vi.fn(async () => [{ id: 'x' } as never]) });
    const r = await listarStagingPendente('importacao-1', deps);
    expect(r).toHaveLength(1);
    expect(deps.listarPendentes).toHaveBeenCalledWith('importacao-1');
  });
});
