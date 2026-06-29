# Ciclo de vida da Campanha: cobrança manual, estados e retenção

Assinatura mensal com **cobrança manual fora do sistema** (sem gateway no MVP) —
o Superadmin controla o status. A Campanha tem três estados:

- **Ativa** — operação normal.
- **Suspensa** (inadimplência) — **acesso bloqueado**, dados **preservados** por
  carência de **30 dias**. Bloqueio, não destruição.
- **Encerrada** (fim da eleição, ou fim da carência sem pagamento) — inicia a
  retenção.

## Retenção / expurgo

No encerramento, o cliente pode **exportar a base** (direito LGPD); depois, dados
operacionais e logs são **expurgados em até 1 mês após o fim da eleição**
(âncora: data de eleição da Campanha). **Campanha = um pleito** (ADR 0005): nova
eleição = nova Campanha; não há reaproveitamento automático da base.

## Consequences

- Campanha carrega `status` e `data_eleicao`.
- Job de expurgo programado por Campanha; exportação disponível antes do expurgo.
- Integração de pagamento automático fica para fase futura, se desejado.
