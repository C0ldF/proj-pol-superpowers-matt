import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { parseCsvTre } from './parse-csv';

const fixturePath = join(__dirname, '__fixtures__/tre-sample.csv');

describe('parseCsvTre', () => {
  it('parseia a fixture e retorna 10 linhas tipadas', () => {
    const linhas = parseCsvTre(readFileSync(fixturePath));
    expect(linhas).toHaveLength(10);
    expect(linhas[0].bairro).toBe('AEROPORTO');
    expect(linhas[0].numLocal).toBe('1');
  });

  it('linha com LATITUDE/LONGITUDE vazios tipa como string vazia, não "NaN"', () => {
    const linhas = parseCsvTre(readFileSync(fixturePath));
    const transito = linhas.find((l) => l.numLocal === '2')!;
    expect(transito.latitude).toBe('');
    expect(transito.longitude).toBe('');
  });

  it('nunca expõe COD_BAIRRO no objeto tipado (ADR 0011)', () => {
    const linhas = parseCsvTre(readFileSync(fixturePath));
    expect(Object.keys(linhas[0])).not.toContain('codBairro');
  });

  it('decodifica latin1 corretamente — acentos não corrompem', () => {
    const header = 'UF,COD_LOCALIDADE_TSE_ZONA,COD_LOCALIDADE_IBGE_ZONA,LOCALIDADE_ZONA,COD_LOCALIDADE_TSE,COD_LOCALIDADE_IBGE,LOCALIDADE,ZONA,TIPO_LOCAL_VOTACAO,SITUACAO_LOCAL_VOTACAO,NUM_LOCAL,DATA_CRIACAO,LOCAL_VOTACAO,TELEFONE,ENDERECO,COD_BAIRRO,BAIRRO,CEP,LATITUDE,LONGITUDE,QTD_SECOES,SECOES,QTD_APTOS,QTD_CANCELADOS,QTD_SUSPENSOS,QTD_VAGAS_RESERVADAS,QTD_BASE_HISTORICA';
    const linha = 'PI,1,1,TERESINA,1,2211001,TERESINA,1,CONVENCIONAL,ATIVO,99,2014-01-01,LOCAL,,"AV CENTENÁRIO, S/N",0,AEROPORTO,64000000,-5.0,-42.8,1,"(s: 1, apt: 1)",1,0,0,0,0';
    const bufferLatin1 = iconv.encode(`${header}\n${linha}\n`, 'latin1');

    const [resultado] = parseCsvTre(bufferLatin1);
    expect(resultado.endereco).toBe('AV CENTENÁRIO, S/N');
  });
});
