import { createHash } from 'node:crypto';
import type { SecaoParseada, TipoLocal, SituacaoLocal } from './tipos';

const MAPA_ACENTOS: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
};

// Espelha public.normalizar_texto (SQL, extensions.unaccent) para uso local
// (dry-run, hashing) — o match oficial sempre roda no Postgres via RPC.
export function normalizarTexto(txt: string): string {
  const semAcento = (txt ?? '')
    .toLowerCase()
    .split('')
    .map((c) => MAPA_ACENTOS[c] ?? c)
    .join('');
  return semAcento.trim().replace(/\s+/g, ' ');
}

export function mapTipoLocal(raw: string): TipoLocal {
  const t = normalizarTexto(raw);
  if (t.includes('transito')) return 'transito';
  if (t.includes('preso') || t.includes('presidio')) return 'preso_provisorio';
  if (t === 'convencional') return 'convencional';
  return 'outro';
}

export function mapSituacaoLocal(raw: string): SituacaoLocal {
  return normalizarTexto(raw) === 'ativo' ? 'ativo' : 'bloqueado';
}

// Tolerante de propósito — o formato do CSV do TRE muda entre ciclos eleitorais.
// Ignora espaços extras, grupos malformados (s:/apt: vazio) e seções duplicadas,
// registrando um aviso em vez de lançar exceção.
export function parseSecoes(raw: string): { secoes: SecaoParseada[]; avisos: string[] } {
  const avisos: string[] = [];
  if (!raw || !raw.trim()) return { secoes: [], avisos };

  const regex = /\(\s*s:\s*(\d*)\s*,\s*apt:\s*(\d*)\s*\)/gi;
  const vistos = new Set<number>();
  const secoes: SecaoParseada[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    const [, numeroStr, aptosStr] = match;
    if (!numeroStr || !aptosStr) {
      avisos.push('secao_malformada');
      continue;
    }
    const numero = parseInt(numeroStr, 10);
    const aptos = parseInt(aptosStr, 10);
    if (vistos.has(numero)) {
      avisos.push('secao_duplicada');
      continue;
    }
    vistos.add(numero);
    secoes.push({ numero, aptos });
  }

  return { secoes, avisos };
}

export function normalizarCep(raw: string): { cep: string | null; avisoInvalido: boolean } {
  const digitos = (raw ?? '').replace(/\D/g, '');
  if (!digitos) return { cep: null, avisoInvalido: false };
  return { cep: digitos, avisoInvalido: digitos.length !== 8 };
}

// SHA-256 da linha crua do CSV (chaves ordenadas) — usado para diff/auditoria
// entre reimportações, não para dedup automático.
export function hashLinha(linha: Record<string, string>): string {
  const chaves = Object.keys(linha).sort();
  const canonico = chaves.map((k) => `${k}=${linha[k] ?? ''}`).join('|');
  return createHash('sha256').update(canonico).digest('hex');
}
