// Domínios raiz conhecidos (sem subdomínio de campanha). Em produção é o
// domínio do produto; em dev, localhost.
const ROOT_HOSTS = new Set(['dominio.com.br', 'localhost']);
const IGNORED = new Set(['www']);

export function extractSubdomain(host: string): string | null {
  const hostname = host.split(':')[0]; // tira a porta
  if (ROOT_HOSTS.has(hostname)) return null;

  const parts = hostname.split('.');
  // localhost com subdomínio: "campanha-a.localhost"
  if (parts.length === 2 && parts[1] === 'localhost') {
    return IGNORED.has(parts[0]) ? null : parts[0];
  }
  // domínio real: precisa de subdomínio + domínio + ao menos 1 TLD parte
  if (parts.length < 3) return null;
  const sub = parts[0];
  return IGNORED.has(sub) ? null : sub;
}
