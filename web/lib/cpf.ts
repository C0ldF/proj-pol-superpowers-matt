export function normalizarCpf(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

export function cpfValido(cpf: string): boolean {
  const d = normalizarCpf(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // todos iguais

  const calc = (fatorInicial: number, ate: number): number => {
    let soma = 0;
    let fator = fatorInicial;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * fator--;
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calc(10, 9) === Number(d[9]) && calc(11, 10) === Number(d[10]);
}
