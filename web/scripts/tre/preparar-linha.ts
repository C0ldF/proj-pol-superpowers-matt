import { mapTipoLocal, mapSituacaoLocal, parseSecoes, normalizarCep, hashLinha } from './normalizar';
import type { LinhaCsvTre, LocalPreparado } from './tipos';

function parseNumero(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Combina normalizar.ts para transformar uma linha crua do CSV numa estrutura
// pronta pra INSERT em local_votacao — sem tocar rede/banco (puro, testável).
export function prepararLinha(linha: LinhaCsvTre): LocalPreparado {
  const tipo = mapTipoLocal(linha.tipoLocalVotacao);
  const situacao = mapSituacaoLocal(linha.situacaoLocalVotacao);
  const { secoes, avisos: avisosSecoes } = parseSecoes(linha.secoes);
  const { cep, avisoInvalido: cepInvalido } = normalizarCep(linha.cep);
  const latitude = parseNumero(linha.latitude);
  const longitude = parseNumero(linha.longitude);
  const qtdAptos = parseNumero(linha.qtdAptos) ?? 0;

  const avisos = [...avisosSecoes];
  if (cepInvalido) avisos.push('cep_invalido');

  const somaSecoes = secoes.reduce((acc, s) => acc + s.aptos, 0);
  if (secoes.length > 0 && somaSecoes !== qtdAptos) {
    avisos.push('qtd_aptos_diverge_soma_secoes');
  }

  const elegivelCalor = tipo === 'convencional' && situacao === 'ativo' && qtdAptos > 0;
  const temGeo = latitude !== null && longitude !== null;

  return {
    zonaNumero: parseNumero(linha.zona) ?? 0,
    bairroNomeOriginal: linha.bairro,
    numLocal: parseNumero(linha.numLocal) ?? 0,
    nome: linha.localVotacao,
    endereco: linha.endereco || null,
    cep,
    tipo,
    situacao,
    qtdAptos,
    qtdCancelados: parseNumero(linha.qtdCancelados),
    qtdSuspensos: parseNumero(linha.qtdSuspensos),
    qtdVagasReservadas: parseNumero(linha.qtdVagasReservadas),
    qtdBaseHistorica: parseNumero(linha.qtdBaseHistorica),
    telefone: linha.telefone || null,
    dataCriacaoTre: linha.dataCriacao || null,
    latitude,
    longitude,
    geoStatus: temGeo ? 'nao_necessario' : 'pendente',
    elegivelCalor,
    avisos,
    rowHash: hashLinha(linha as unknown as Record<string, string>),
    secoes,
    linhaOriginal: linha,
  };
}
