import { describe, it, expect } from 'vitest';
import { validarNovaCampanha } from './validar-nova-campanha';

const CORPO_MUNICIPAL_VALIDO = {
  subdominio: 'campanha-nova', nome: 'Campanha Nova', cargo: 'prefeito',
  abrangencia: 'municipal', municipioId: 2211001, dataEleicao: '2028-10-01',
};

describe('validarNovaCampanha', () => {
  it('corpo municipal válido: ok, monta o objeto pronto pro insert', () => {
    const r = validarNovaCampanha(CORPO_MUNICIPAL_VALIDO);
    expect(r).toEqual({
      ok: true,
      campanha: {
        subdominio: 'campanha-nova', nome: 'Campanha Nova', cargo: 'prefeito',
        abrangencia: 'municipal', municipio_id: 2211001, uf: null, data_eleicao: '2028-10-01',
      },
    });
  });

  it('corpo estadual válido: ok, normaliza uf, municipio_id null', () => {
    const r = validarNovaCampanha({
      subdominio: 'campanha-estadual', nome: 'Campanha Estadual', cargo: 'deputado_estadual',
      abrangencia: 'estadual', uf: ' pi ', dataEleicao: '2028-10-01',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.campanha.uf).toBe('PI');
      expect(r.campanha.municipio_id).toBeNull();
    }
  });

  it('normaliza subdominio pra minúsculo', () => {
    const r = validarNovaCampanha({ ...CORPO_MUNICIPAL_VALIDO, subdominio: 'ABC-Novo' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.campanha.subdominio).toBe('abc-novo');
  });

  it('falha com campo obrigatório ausente', () => {
    const { nome: _nome, ...semNome } = CORPO_MUNICIPAL_VALIDO;
    expect(validarNovaCampanha(semNome).ok).toBe(false);
  });

  it('falha com subdominio em formato inválido mesmo após normalizar (delega pra subdominioValido, já testada isoladamente)', () => {
    expect(validarNovaCampanha({ ...CORPO_MUNICIPAL_VALIDO, subdominio: 'a b' }).ok).toBe(false);
  });

  it('falha com cargo/abrangencia fora da lista fechada', () => {
    expect(validarNovaCampanha({ ...CORPO_MUNICIPAL_VALIDO, cargo: 'presidente' }).ok).toBe(false);
    expect(validarNovaCampanha({ ...CORPO_MUNICIPAL_VALIDO, abrangencia: 'nacional' }).ok).toBe(false);
  });

  it('falha quando municipal sem municipioId, ou com uf junto', () => {
    const { municipioId: _m, ...semMunicipio } = CORPO_MUNICIPAL_VALIDO;
    expect(validarNovaCampanha(semMunicipio).ok).toBe(false);
    expect(validarNovaCampanha({ ...CORPO_MUNICIPAL_VALIDO, uf: 'PI' }).ok).toBe(false);
  });

  it('falha quando estadual sem uf, ou com municipioId junto', () => {
    const corpoEstadual = {
      subdominio: 'campanha-est', nome: 'Campanha Estadual', cargo: 'deputado_estadual',
      abrangencia: 'estadual', uf: 'PI', dataEleicao: '2028-10-01',
    };
    const { uf: _uf, ...semUf } = corpoEstadual;
    expect(validarNovaCampanha(semUf).ok).toBe(false);
    expect(validarNovaCampanha({ ...corpoEstadual, municipioId: 2211001 }).ok).toBe(false);
  });

  it('falha com uf inválida após normalizar (delega pra ufValida, já testada isoladamente)', () => {
    const corpoEstadual = {
      subdominio: 'campanha-est', nome: 'Campanha Estadual', cargo: 'deputado_estadual',
      abrangencia: 'estadual', uf: 'P1', dataEleicao: '2028-10-01',
    };
    expect(validarNovaCampanha(corpoEstadual).ok).toBe(false);
  });

  it('falha com dataEleicao inválida (delega pra dataEleicaoValida, já testada isoladamente)', () => {
    expect(validarNovaCampanha({ ...CORPO_MUNICIPAL_VALIDO, dataEleicao: '2028-02-30' }).ok).toBe(false);
  });
});
