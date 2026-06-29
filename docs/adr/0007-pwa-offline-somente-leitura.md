# PWA com offline somente de leitura (sem escrita offline)

O app é um PWA instalável (Serwist) com **offline apenas de leitura**: sem sinal,
o usuário consulta dashboard, mapa e sua árvore (cache), mas **todo cadastro exige
conexão**. Em campo sem sinal, os dados são coletados manualmente para
preenchimento posterior.

## Considered Options

- **Offline só leitura (escolhido).** Sem fila de sync, sem resolução de conflito
  de dedup, e o aparelho não persiste PII — menor risco LGPD e muito menos
  complexidade.
- **Cadastro de apoiador offline com fila criptografada.** Rejeitado: a
  produtividade extra não compensa o custo de sync + conflito + PII no dispositivo,
  dado que a conectividade no uso real é adequada.
- **Offline-first total.** Rejeitado: exagero; relatórios/gestão/permissões não
  precisam e multiplicam risco.

## Consequences

- Service worker (Serwist) cacheia leitura; mutações falham graciosamente offline
  com aviso ("sem conexão — anote para cadastrar depois").
- Nada de PII em armazenamento local do dispositivo.
