# CRUD de campanha (criar + mudar status)

Data: 2026-07-07
Depende de S7 (`requireSuperadmin()`, painel `/superadmin/dashboard`,
`DashboardSuperadminClient`) e do schema da S0 (`public.campanha`,
migration `0002_campanha.sql`). Não está no roadmap original — fecha um
débito explícito do S7 ("CRUD de campanha — continua manual, fatia própria
depois").

## Objetivo

Duas operações no painel Superadmin que hoje só existem via
`execute_sql`/`seed.sql` manual: criar uma campanha nova, e mudar o status
de uma campanha existente (`ativa`/`suspensa`/`encerrada`).

## Escopo desta fatia

Explicitamente **fora** do ciclo de vida completo do ADR 0015: sem job de
expurgo agendado, sem exportação de dados LGPD, sem edição de campos já
criados (nome/cargo/abrangência/data de eleição são imutáveis após a
criação nesta fatia — só `status` muda). Essas peças ficam pra uma fatia
futura, decisão do usuário ao escolher o escopo desta.

## Decisões desta fatia

1. **Sem função Postgres nova — mutação direta via `adminClient()`
   (`service_role`).** Diferente do toggle de módulo (S6/S7, que precisa de
   `SECURITY DEFINER` porque `actor_tem_modulo()` roda no contexto de
   `authenticated` e lê `auth.uid()`), aqui não há checagem de identidade
   nenhuma na mutação em si — o gate já aconteceu em `requireSuperadmin()`
   antes de qualquer rota chamar `adminClient()`. Criar uma função SQL só
   pra fazer um `INSERT`/`UPDATE` que o `service_role` já pode fazer direto
   seria indireção sem ganho de segurança. Mesma lógica de
   `GET /api/superadmin/campanhas` (S7), que já lê direto via
   `adminClient().from('campanha').select(...)` sem RPC.
2. **`POST /api/superadmin/campanhas` no mesmo arquivo do `GET` já
   existente.** Rotas Next.js exportam múltiplos métodos do mesmo arquivo
   — não há razão pra separar. Corpo:
   `{subdominio, nome, cargo, abrangencia, municipioId?, uf, dataEleicao}`.
   Validação em TS espelha a `CHECK` constraint do banco (`abrangencia_geo`,
   migration `0002`): `abrangencia='municipal'` exige `municipioId` presente
   e `uf` ausente; `abrangencia='estadual'` exige `uf` presente e
   `municipioId` ausente. Validar em TS antes do `INSERT` evita que um
   corpo malformado vire um erro de constraint de banco genérico (500) em
   vez de uma mensagem clara (400) — mesmo raciocínio já aplicado em
   `POST /api/superadmin/modulos` (S7), que valida `modulo`/`acao` em TS
   antes de chamar a função SQL.
3. **`cargo`/`abrangencia` como listas fechadas em TS, mesmo padrão de
   `web/lib/modulos.ts` (S6).** Novo arquivo `web/lib/campanha.ts` exporta
   `CARGOS = ['vereador', 'prefeito', 'deputado_estadual'] as const`,
   `ABRANGENCIAS = ['municipal', 'estadual'] as const`, e os type guards
   `isCargo`/`isAbrangencia` — únicas fontes da verdade no TS, refletindo os
   enums Postgres `cargo`/`abrangencia` (migration `0002`). Requests com
   valor fora da lista são rejeitados em TS (400) antes de tocar o banco.
4. **Sucesso da criação retorna a linha criada (`201`), não só
   `{ok:true}`.** Diferente de `POST /api/superadmin/modulos` (que só
   precisa confirmar sucesso — o cliente já tem a lista completa em
   memória e só espelha um toggle local), aqui o cliente não tem a nova
   campanha em memória ainda — precisa do `id` real (gerado pelo banco,
   `gen_random_uuid()`) pra inserir na lista sem um refetch completo.
5. **Duplicidade de `subdominio`: erro de banco (`unique`) traduzido pra
   `400` com mensagem, não `500`.** A constraint `unique` em
   `campanha.subdominio` já existe (migration `0002`) — a rota captura o
   erro do `insert` e, se for violação de unicidade, retorna
   `{erro: 'subdomínio já em uso'}` em vez de deixar vazar o erro cru do
   Postgres (mesmo padrão de tratamento de erro de `toggleModulo` — erro
   lançado vira `400` com a mensagem, nunca `500`).
6. **Máquina de estados: `ativa` ↔ `suspensa` bidirecional; `encerrada` é
   terminal.** `(ativa|suspensa) → encerrada` é permitido; qualquer
   transição SAINDO de `encerrada` é rejeitada (`400`). Bate com o ADR 0015
   ("Encerrada — fim da eleição... inicia a retenção") — não faz sentido
   reverter uma campanha que já iniciou o processo de retenção/expurgo
   (mesmo que o job de expurgo em si seja fora de escopo aqui, o *estado*
   já reflete essa decisão irreversível). Transição pro mesmo status atual
   (ex.: `ativa`→`ativa`) também é rejeitada (`400`, "já está nesse
   status") — não é uma transição real, é um no-op disfarçado de mutação.
7. **`suspensa_em`: setado ao entrar em `suspensa`, limpo (`null`) ao
   sair.** A coluna já existe (migration `0002`, hoje sempre `null` porque
   nada a escreve ainda). Entrar em `suspensa` grava `now()`; sair de
   `suspensa` de volta pra `ativa` limpa pra `null` — sem isso, depois de
   reativar uma campanha, a coluna ficaria com um timestamp obsoleto
   sugerindo "ainda suspensa desde X", o que é falso. Transição pra
   `encerrada` não mexe em `suspensa_em` (preserva o histórico de quando a
   suspensão aconteceu, se aconteceu, mesmo depois de encerrada).
8. **Validação da máquina de estados isolada numa função pura testável.**
   Novo arquivo `web/lib/campanha/transicionar-status.ts` — mesmo padrão de
   orquestrador puro já estabelecido (`loginCampanha`, `toggleModulo`,
   `criarSuperadmin`): recebe o status atual + o novo status, retorna se a
   transição é válida (e, se não for, por quê), sem tocar banco. A rota
   chama essa função antes de qualquer `UPDATE`.
9. **`municipioId` é um campo numérico livre no formulário, não um
   dropdown de municípios reais.** O S3 já tem uma tabela `municipio` real
   (dimensão IBGE) — um dropdown de verdade poderia consultá-la, mas isso é
   uma peça de UI adicional (busca, paginação de ~180 municípios do PI) sem
   necessidade real: o Superadmin já lida com códigos IBGE brutos nos
   scripts CLI do S3 (`--municipio 2211001`). Um input numérico simples
   mantém esta fatia pequena; o dropdown fica pra quando/se a UI ganhar uma
   fatia de design de verdade.
10. **Botões de transição de status mostram só as opções legais pro estado
    atual** — não um dropdown genérico com as 3 opções sempre visíveis.
    `ativa` mostra "Suspender"+"Encerrar"; `suspensa` mostra
    "Reativar"+"Encerrar"; `encerrada` não mostra nenhum botão (readonly,
    reforça visualmente que é terminal). Mesmo padrão pessimista do toggle
    de módulo (S7): botão desabilitado durante a requisição, UI só reflete
    o novo estado depois do `200`.

## Não-objetivos

- Job agendado de expurgo pós-encerramento (ADR 0015) — fora de escopo,
  trabalho novo (scheduler/cron), não cabe numa fatia de CRUD.
- Exportação de dados LGPD antes do expurgo (ADR 0015) — idem, feature
  separada.
- Edição de `nome`/`cargo`/`abrangencia`/`municipio_id`/`uf`/`data_eleicao`
  depois de criada — só `status` muda nesta fatia.
- Dropdown de municípios reais (busca na tabela `municipio` do S3) —
  decisão 9.
- Exclusão (`DELETE`) de campanha — não pedido, e inconsistente com o
  modelo de retenção do ADR 0015 (campanhas se encerram, não se apagam).
- Qualquer validação de unicidade além de `subdominio` (ex.: nome
  duplicado) — banco não impõe isso, não é pedido.
- Estilo/CSS no formulário/botões novos — mesmo nível de acabamento do
  resto do painel Superadmin hoje.

## Schema (sem migration nova)

`public.campanha` já tem todas as colunas necessárias (migration `0002`):
`subdominio text unique`, `nome text`, `cargo cargo`,
`abrangencia abrangencia`, `municipio_id bigint`, `uf char(2)`,
`status campanha_status default 'ativa'`, `data_eleicao date`,
`suspensa_em timestamptz`. Nenhuma migration nova nesta fatia.

## Camada Next.js

### `web/lib/campanha.ts`

```
CARGOS = ['vereador', 'prefeito', 'deputado_estadual'] as const
Cargo = (typeof CARGOS)[number]
isCargo(value: string): value is Cargo

ABRANGENCIAS = ['municipal', 'estadual'] as const
Abrangencia = (typeof ABRANGENCIAS)[number]
isAbrangencia(value: string): value is Abrangencia
```

### `web/lib/campanha/transicionar-status.ts`

```
STATUS_CAMPANHA = ['ativa', 'suspensa', 'encerrada'] as const
StatusCampanha = (typeof STATUS_CAMPANHA)[number]

transicionarStatus(atual: StatusCampanha, novo: StatusCampanha):
  { valida: true } | { valida: false; erro: string }

Regras:
  - atual === novo               → { valida: false, erro: 'já está nesse status' }
  - atual === 'encerrada'         → { valida: false, erro: 'campanha encerrada não pode mudar de status' }
  - qualquer outra combinação     → { valida: true }
    (ativa→suspensa, ativa→encerrada, suspensa→ativa, suspensa→encerrada)
```

### `POST /api/superadmin/campanhas` (adiciona ao arquivo existente)

```
1. bloqueado = await requireSuperadmin(); se bloqueado, retorna
2. body: {subdominio, nome, cargo, abrangencia, municipioId?, uf?, dataEleicao}
3. valida: todos os campos obrigatórios presentes — 400 se não
4. valida: isCargo(cargo), isAbrangencia(abrangencia) — 400 se não
5. valida: abrangencia==='municipal' → municipioId presente e uf ausente
           abrangencia==='estadual'  → uf presente e municipioId ausente
           — 400 se não (mensagem explica qual campo esperado)
6. adminClient().from('campanha').insert({...}).select().single()
7. erro de unicidade (subdominio duplicado) → 400 {erro: 'subdomínio já em uso'}
   outro erro de banco → 400 {erro: error.message}
8. sucesso → 201 com a linha criada
```

### `POST /api/superadmin/campanhas/status` (rota nova)

```
1. bloqueado = await requireSuperadmin(); se bloqueado, retorna
2. body: {campanhaId, novoStatus}
3. valida: campanhaId e novoStatus presentes, novoStatus é um StatusCampanha válido — 400 se não
4. adminClient().from('campanha').select('status').eq('id', campanhaId).single()
   — campanha não encontrada → 400 {erro: 'campanha não encontrada'}
5. transicionarStatus(atual, novoStatus) — se inválida, 400 {erro: <mensagem da função>}
6. monta o update:
   { status: novoStatus, atualizado_em: now(),
     suspensa_em: novoStatus === 'suspensa' ? now() : (atual === 'suspensa' ? null : <mantém> ) }
7. adminClient().from('campanha').update(...).eq('id', campanhaId)
8. sucesso → 200 {ok: true}
```

### `DashboardSuperadminClient.tsx` (estende o componente do S7)

- Formulário "Nova campanha" acima da tabela: inputs
  `subdominio`/`nome`/`dataEleicao`, `<select>` de `cargo` (3 opções fixas),
  `<select>` de `abrangencia` (2 opções fixas), e — condicional ao valor de
  `abrangencia` — um input numérico `municipioId` (se `municipal`) ou um
  input de texto `uf` (se `estadual`, maxlength 2). Submit dispara
  `POST /api/superadmin/campanhas`; sucesso prepende a campanha criada na
  lista em memória (sem refetch) e limpa o formulário; erro mostra
  `body.erro` num elemento `role="alert"`.
- Cada linha da tabela ganha, ao lado dos checkboxes de módulo, os botões
  de transição de status (decisão 10): calculados a partir do `status`
  atual da linha, nunca hardcoded como uma lista fixa de 3 opções. Clique
  dispara `POST /api/superadmin/campanhas/status`
  `{campanhaId, novoStatus}`; pessimista (desabilita durante a requisição,
  só atualiza o `status` local depois do `200`).

## Testes (critério de pronto)

### `transicionarStatus` (unitário, sem banco)

1. `ativa`→`suspensa`: válida.
2. `suspensa`→`ativa`: válida.
3. `ativa`→`encerrada`: válida.
4. `suspensa`→`encerrada`: válida.
5. `encerrada`→`ativa` (ou qualquer coisa saindo de `encerrada`): inválida,
   mensagem explica que é terminal.
6. `ativa`→`ativa` (mesmo status): inválida, mensagem "já está nesse
   status".

### `POST /api/superadmin/campanhas`

7. 401/403 mesma regra de `requireSuperadmin()` (já testado em outras
   rotas do painel, S7).
8. 400 com campo obrigatório faltando, sem chamar `insert`.
9. 400 com `cargo`/`abrangencia` fora da lista fechada, sem chamar
   `insert`.
10. 400 com `abrangencia='municipal'` e `municipioId` ausente (ou `uf`
    presente junto) — e o caso simétrico pra `'estadual'`.
11. 400 com `subdominio` duplicado (constraint de unicidade simulada no
    mock), sem vazar o erro cru do Postgres.
12. 201 com a linha criada em caso de sucesso.

### `POST /api/superadmin/campanhas/status`

13. 401/403 mesma regra.
14. 400 com `campanhaId` inexistente.
15. 400 com transição inválida (delega pra `transicionarStatus`, já testada
    isoladamente acima — aqui só confirma que a rota rejeita e não chama
    `update`).
16. 200 com transição válida — confirma que `suspensa_em` é setado ao
    entrar em `suspensa` e limpo ao sair.

### `DashboardSuperadminClient`

17. Preencher e submeter o formulário de nova campanha dispara
    `POST /api/superadmin/campanhas` com o corpo certo; sucesso adiciona a
    linha na tabela sem refetch.
18. Erro na criação mostra `body.erro` em `role="alert"`.
19. Uma campanha `ativa` mostra os botões "Suspender"/"Encerrar" (não
    "Reativar"); uma `suspensa` mostra "Reativar"/"Encerrar"; uma
    `encerrada` não mostra nenhum botão.
20. Clicar num botão de transição dispara
    `POST /api/superadmin/campanhas/status` com `{campanhaId, novoStatus}`
    certo, desabilita o botão durante a requisição, e atualiza o `status`
    exibido só depois do `200`.
