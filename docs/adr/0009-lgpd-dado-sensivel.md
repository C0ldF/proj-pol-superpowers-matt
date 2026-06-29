# LGPD: a base é dado sensível (opinião política) — arcabouço de conformidade

Registrar que uma Pessoa apoia um candidato é **dado pessoal sensível** (LGPD
Art. 5º, II — opinião política / filiação política). Toda a base, portanto, é
sensível e cai no regime mais rígido do Art. 11. O sistema é construído desde o
início com:

- **Base legal rastreável por Pessoa** — campo configurável (default **legítimo
  interesse + opt-out**) com data e origem; registra também o ato de fornecimento
  dos dados. A *escolha* da base legal é decisão do jurídico do cliente.
- **Direitos do titular (Art. 18):** fluxos de acesso, correção, **exclusão** e
  exportação dos dados de um titular; **revogação** de consentimento / opt-out.
- **Trilha de auditoria:** quem viu/editou/exportou o quê.
- **Minimização e retenção:** guardar o necessário; política de descarte
  pós-eleição.

## Consequences

- Modelo de dados carrega campos de base legal/consentimento e suporta
  **soft-delete + expurgo** para atender exclusão e retenção.
- Eleva o patamar de segurança (criptografia, auditoria, residência) — ver ADR de
  criptografia/residência.
- "Entregou os dados = autorizou" é registrado, mas não é assumido como
  consentimento específico suficiente; cabe ao jurídico do cliente confirmar.
