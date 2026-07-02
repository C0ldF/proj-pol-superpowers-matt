import { geocodeEndereco, type GeocodeDeps } from './geocode';

export interface LocalPendenteGeo {
  id: string;
  endereco: string | null;
  cep: string | null;
  municipioNome: string;
  uf: string;
}

export interface GeocodePendentesDeps {
  listarPendentes(importacaoId: string, incluirFalhados: boolean): Promise<LocalPendenteGeo[]>;
  marcarSucesso(id: string, lat: number, lng: number): Promise<void>;
  marcarFalha(id: string): Promise<void>;
  geocode: GeocodeDeps;
  esperarMs: (ms: number) => Promise<void>;
}

export interface GeocodarPendentesInput {
  importacaoId: string;
  incluirFalhados?: boolean;
}

export interface GeocodarPendentesResultado {
  total: number;
  sucesso: number;
  falha: number;
}

// 1 req/s — política de uso do Nominatim (ADR 0012).
const INTERVALO_MS = 1000;

// Fase "geocode" do pipeline (spec S3, decisão 3): a ÚNICA fase que fala com
// a rede. Reexecutável livremente — só processa geo_status='pendente' por
// padrão; `--retry` também reprocessa 'falhou'.
export async function geocodarPendentes(
  input: GeocodarPendentesInput,
  deps: GeocodePendentesDeps,
): Promise<GeocodarPendentesResultado> {
  const pendentes = await deps.listarPendentes(input.importacaoId, input.incluirFalhados ?? false);

  let sucesso = 0;
  let falha = 0;

  for (let i = 0; i < pendentes.length; i++) {
    const local = pendentes[i];
    const resultado = await geocodeEndereco(
      { endereco: local.endereco, cep: local.cep, municipio: local.municipioNome, uf: local.uf },
      deps.geocode,
    );

    if (resultado) {
      await deps.marcarSucesso(local.id, resultado.lat, resultado.lng);
      sucesso++;
    } else {
      await deps.marcarFalha(local.id);
      falha++;
    }

    if (i < pendentes.length - 1) await deps.esperarMs(INTERVALO_MS);
  }

  return { total: pendentes.length, sucesso, falha };
}
