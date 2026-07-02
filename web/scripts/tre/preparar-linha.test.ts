import { describe, it, expect } from 'vitest';
import { prepararLinha } from './preparar-linha';
import type { LinhaCsvTre } from './tipos';

function linhaBase(overrides: Partial<LinhaCsvTre> = {}): LinhaCsvTre {
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

describe('prepararLinha', () => {
  it('convencional + ativo + aptos>0 é elegível ao calor', () => {
    expect(prepararLinha(linhaBase()).elegivelCalor).toBe(true);
  });
  it('situação bloqueado não é elegível', () => {
    expect(prepararLinha(linhaBase({ situacaoLocalVotacao: 'BLOQUEADO' })).elegivelCalor).toBe(false);
  });
  it('tipo preso provisório não é elegível', () => {
    expect(prepararLinha(linhaBase({ tipoLocalVotacao: 'PRESO PROVISORIO' })).elegivelCalor).toBe(false);
  });
  it('qtd_aptos zero não é elegível', () => {
    const r = prepararLinha(linhaBase({ qtdAptos: '0', secoes: '(s: 1, apt: 0)' }));
    expect(r.elegivelCalor).toBe(false);
  });
  it('lat/long presentes → geoStatus nao_necessario', () => {
    expect(prepararLinha(linhaBase()).geoStatus).toBe('nao_necessario');
  });
  it('lat/long ausentes → geoStatus pendente', () => {
    const r = prepararLinha(linhaBase({ latitude: '', longitude: '' }));
    expect(r.geoStatus).toBe('pendente');
  });
  it('CEP inválido gera aviso cep_invalido', () => {
    expect(prepararLinha(linhaBase({ cep: '123' })).avisos).toContain('cep_invalido');
  });
  it('qtd_aptos divergente da soma das seções gera aviso', () => {
    const r = prepararLinha(linhaBase({ qtdAptos: '999', secoes: '(s: 1, apt: 20)' }));
    expect(r.avisos).toContain('qtd_aptos_diverge_soma_secoes');
  });
  it('rowHash é estável para a mesma linha', () => {
    const linha = linhaBase();
    expect(prepararLinha(linha).rowHash).toBe(prepararLinha(linha).rowHash);
  });
  it('rowHash muda se a linha muda', () => {
    const a = prepararLinha(linhaBase());
    const b = prepararLinha(linhaBase({ numLocal: '2' }));
    expect(a.rowHash).not.toBe(b.rowHash);
  });
});
