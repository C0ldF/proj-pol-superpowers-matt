// Login preso ao subdomínio (ADR 0008): sessão de uma campanha não vale no
// subdomínio de outra. Sem sessão (token null) não há conflito.
export function sessaoConflitaSubdominio(args: {
  tokenCampanhaId: string | null;
  campanhaIdResolvida: string | null;
}): boolean {
  const { tokenCampanhaId, campanhaIdResolvida } = args;
  if (!tokenCampanhaId) return false;
  return tokenCampanhaId !== campanhaIdResolvida;
}
