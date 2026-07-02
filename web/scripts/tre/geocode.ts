export interface GeocodeInput {
  endereco: string | null;
  cep: string | null;
  municipio: string;
  uf: string;
}

export interface GeocodeResultado {
  lat: number;
  lng: number;
}

export interface GeocodeDeps {
  fetchImpl: typeof fetch;
  userAgent: string;
  timeoutMs?: number;
}

// Nominatim/OSM — sem custo, sem API key (ADR 0012). Nunca lança: falha de
// rede/timeout/resposta vazia sempre vira `null`, nunca exceção — quem chama
// (geocode-pendentes.ts) trata isso como geo_status='falhou', não aborta o lote.
export async function geocodeEndereco(
  input: GeocodeInput,
  deps: GeocodeDeps,
): Promise<GeocodeResultado | null> {
  const partes = [input.endereco, input.municipio, input.uf, input.cep, 'Brasil'].filter(Boolean);
  const query = partes.join(', ');
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5000);

  try {
    const resp = await deps.fetchImpl(url, {
      headers: { 'User-Agent': deps.userAgent },
      signal: controller.signal,
    });
    if (!resp.ok) return null;

    const dados = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (!dados.length) return null;

    const lat = Number(dados[0].lat);
    const lng = Number(dados[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Rate-limit da política de uso do Nominatim: 1 req/s.
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
