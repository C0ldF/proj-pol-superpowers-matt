export interface LinhaCsvTre {
  uf: string;
  localidade: string;
  codLocalidadeIbge: string;
  zona: string;
  tipoLocalVotacao: string;
  situacaoLocalVotacao: string;
  numLocal: string;
  dataCriacao: string;
  localVotacao: string;
  telefone: string;
  endereco: string;
  bairro: string;
  cep: string;
  latitude: string;
  longitude: string;
  secoes: string;
  qtdAptos: string;
  qtdCancelados: string;
  qtdSuspensos: string;
  qtdVagasReservadas: string;
  qtdBaseHistorica: string;
}

export type TipoLocal = 'convencional' | 'transito' | 'preso_provisorio' | 'outro';
export type SituacaoLocal = 'ativo' | 'bloqueado';
export type GeoStatus = 'pendente' | 'sucesso' | 'falhou' | 'manual' | 'nao_necessario';

export interface SecaoParseada {
  numero: number;
  aptos: number;
}

export interface LocalPreparado {
  zonaNumero: number;
  bairroNomeOriginal: string;
  numLocal: number;
  nome: string;
  endereco: string | null;
  cep: string | null;
  tipo: TipoLocal;
  situacao: SituacaoLocal;
  qtdAptos: number;
  qtdCancelados: number | null;
  qtdSuspensos: number | null;
  qtdVagasReservadas: number | null;
  qtdBaseHistorica: number | null;
  telefone: string | null;
  dataCriacaoTre: string | null;
  latitude: number | null;
  longitude: number | null;
  geoStatus: GeoStatus;
  elegivelCalor: boolean;
  avisos: string[];
  rowHash: string;
  secoes: SecaoParseada[];
  linhaOriginal: LinhaCsvTre;
}
