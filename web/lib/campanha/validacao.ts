export function subdominioValido(s: string): boolean {
  return /^[a-z0-9-]+$/.test(s) && s.length >= 3 && s.length <= 63;
}

export function ufValida(s: string): boolean {
  return /^[A-Z]{2}$/.test(s);
}

export function dataEleicaoValida(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  const data = new Date(`${s}T00:00:00.000Z`);
  return (
    data.getUTCFullYear() === Number(y) &&
    data.getUTCMonth() + 1 === Number(mo) &&
    data.getUTCDate() === Number(d)
  );
}
