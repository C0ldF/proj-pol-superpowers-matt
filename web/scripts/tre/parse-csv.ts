import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import type { LinhaCsvTre } from './tipos';

interface LinhaCsvBruta {
  UF?: string; LOCALIDADE?: string; COD_LOCALIDADE_IBGE?: string; ZONA?: string;
  TIPO_LOCAL_VOTACAO?: string; SITUACAO_LOCAL_VOTACAO?: string; NUM_LOCAL?: string;
  DATA_CRIACAO?: string; LOCAL_VOTACAO?: string; TELEFONE?: string; ENDERECO?: string;
  BAIRRO?: string; CEP?: string; LATITUDE?: string; LONGITUDE?: string; SECOES?: string;
  QTD_APTOS?: string; QTD_CANCELADOS?: string; QTD_SUSPENSOS?: string;
  QTD_VAGAS_RESERVADAS?: string; QTD_BASE_HISTORICA?: string;
  [coluna: string]: string | undefined;
}

// O CSV do TRE é Latin-1/CP1252, nunca UTF-8 — decodificar antes de parsear
// (confirmado por inspeção do arquivo real: acentos corrompem se lido como UTF-8).
// COD_BAIRRO é lido pelo csv-parse mas nunca copiado para LinhaCsvTre (ADR 0011).
export function parseCsvTre(buffer: Buffer): LinhaCsvTre[] {
  const texto = iconv.decode(buffer, 'latin1');
  const linhas: LinhaCsvBruta[] = parse(texto, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return linhas.map((l): LinhaCsvTre => ({
    uf: l.UF ?? '',
    localidade: l.LOCALIDADE ?? '',
    codLocalidadeIbge: l.COD_LOCALIDADE_IBGE ?? '',
    zona: l.ZONA ?? '',
    tipoLocalVotacao: l.TIPO_LOCAL_VOTACAO ?? '',
    situacaoLocalVotacao: l.SITUACAO_LOCAL_VOTACAO ?? '',
    numLocal: l.NUM_LOCAL ?? '',
    dataCriacao: l.DATA_CRIACAO ?? '',
    localVotacao: l.LOCAL_VOTACAO ?? '',
    telefone: l.TELEFONE ?? '',
    endereco: l.ENDERECO ?? '',
    bairro: l.BAIRRO ?? '',
    cep: l.CEP ?? '',
    latitude: l.LATITUDE ?? '',
    longitude: l.LONGITUDE ?? '',
    secoes: l.SECOES ?? '',
    qtdAptos: l.QTD_APTOS ?? '',
    qtdCancelados: l.QTD_CANCELADOS ?? '',
    qtdSuspensos: l.QTD_SUSPENSOS ?? '',
    qtdVagasReservadas: l.QTD_VAGAS_RESERVADAS ?? '',
    qtdBaseHistorica: l.QTD_BASE_HISTORICA ?? '',
  }));
}
