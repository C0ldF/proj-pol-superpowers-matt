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
   (`service_role`).** Como a rota já executa `requireSuperadmin()` e
   depois usa `adminClient()` (`service_role`), criar uma função SQL
   `SECURITY DEFINER` não acrescenta isolamento nem segurança — a mutação é
   feita direto via `adminClient()`, mesmo padrão já usado por
   `GET /api/superadmin/campanhas` (S7).
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
3. **`cargo`/`abrangencia`/`status` como listas fechadas em TS, mesmo
   padrão de `web/lib/modulos.ts` (S6).** Novo arquivo `web/lib/campanha.ts`
   exporta `CARGOS`/`ABRANGENCIAS`/`STATUS_CAMPANHA` +
   `isCargo`/`isAbrangencia`/`isStatusCampanha` — únicas fontes da verdade
   no TS, refletindo os enums Postgres `cargo`/`abrangencia`/
   `campanha_status` (migration `0002`). Requests com valor fora da lista
   são rejeitados em TS (400) antes de tocar o banco, sem `includes(...)`
   solto espalhado pelas rotas.
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
7. **Regra de `suspensa_em` embutida na própria função de transição, não
   espalhada entre ela e a rota.** `suspensa_em` (coluna já existente,
   migration `0002`, hoje sempre `null`) precisa ser setada ao entrar em
   `suspensa` e limpa (`null`) ao sair de volta pra `ativa` — sem isso, uma
   campanha reativada ficaria com um timestamp obsoleto sugerindo "ainda
   suspensa desde X". Transição pra `encerrada` não mexe em `suspensa_em`
   (preserva o histórico de quando a suspensão aconteceu, se aconteceu).
   `transicionarStatus()` (decisão 8) já devolve o `update` completo com
   esse campo calculado — a rota só aplica o resultado, nunca decide
   `suspensa_em` por conta própria. Isso evita que uma alteração futura na
   regra exija lembrar de mudar dois lugares.
8. **`transicionarStatus()`: função pura que valida E monta o update.**
   Novo arquivo `web/lib/campanha/transicionar-status.ts` — mesmo padrão de
   orquestrador puro já estabelecido (`loginCampanha`, `toggleModulo`,
   `criarSuperadmin`). Recebe o status atual + o novo status; se a
   transição for inválida, devolve o motivo; se for válida, devolve o
   objeto de update pronto pra aplicar (`status`, `suspensa_em`), sem tocar
   banco. Encapsula a decisão 7 inteira — a rota nunca calcula
   `suspensa_em` sozinha, só aplica o que a função devolve.
9. **`municipioId` permanece um campo numérico livre nesta fatia.** A
   seleção assistida de municípios (consulta à dimensão IBGE do S3) fica
   pra uma futura melhoria de UX.
10. **Botões de transição de status mostram só as opções legais pro estado
    atual** — não um dropdown genérico com as 3 opções sempre visíveis.
    `ativa` mostra "Suspender"+"Encerrar"; `suspensa` mostra
    "Reativar"+"Encerrar"; `encerrada` não mostra nenhum botão (readonly,
    reforça visualmente que é terminal). Mesmo padrão pessimista do toggle
    de módulo (S7): botão desabilitado durante a requisição, UI só reflete
    o novo estado depois do `200`.
11. **`subdominio`: valida formato antes de tentar o `insert`, não só
    unicidade.** Sem essa validação o banco aceitaria qualquer string como
    `subdominio` (é só `text unique`, sem `CHECK` de formato) — mas
    `web/middleware.ts` extrai subdomínios de host reais (`extractSubdomain`,
    `web/lib/subdomain.ts`), então um valor com espaço, maiúscula ou
    pontuação nunca resolveria de volta pra essa campanha. Regex
    `^[a-z0-9-]+$`, tamanho entre 3 e 63 caracteres (limite de label DNS) —
    400 se não bater, com a mesma mensagem de "formato inválido".
12. **`uf`: normaliza antes de validar/gravar.** `trim()` +
    `toUpperCase()` primeiro, depois valida que restam exatamente 2 letras
    (`^[A-Z]{2}$`) — sem isso, `"ma"`, `"Ma"`, `" MA"` e `"MA"` seriam
    tratados como valores diferentes/alguns rejeitados, todos
    representando o mesmo estado. O valor gravado no banco é sempre a
    versão normalizada.
13. **`dataEleicao`: valida formato `YYYY-MM-DD` e que representa uma data
    real, sem confiar em `Date.parse()` sozinho.** `Date.parse()`/
    `new Date(...)` normalizam datas impossíveis em vez de rejeitar —
    `Date.parse('2028-02-30')` retorna um timestamp válido correspondente a
    `2028-03-01`, não `NaN` (confirmado empiricamente em Node). A validação
    correta é: regex `^(\d{4})-(\d{2})-(\d{2})$` captura os componentes,
    constrói `new Date(`${s}T00:00:00.000Z`)`, e compara
    `getUTCFullYear()`/`getUTCMonth()+1`/`getUTCDate()` de volta contra os
    números capturados — se algum não bater, a data não existe (rejeita
    `"2028-02-30"`, aceita `"2028-02-29"` em ano bissexto e rejeita em ano
    não-bissexto). Rejeita também string vazia e formato errado
    (`"10/01/2028"`), que já falham na regex antes de chegar no `Date`.
14. **`POST /api/superadmin/campanhas/status` também retorna a linha
    atualizada (`200 {campanha}`), não só `{ok:true}`.** Mesmo raciocínio
    da decisão 4: o cliente já tem a campanha em memória, mas
    `atualizado_em`/`suspensa_em` são calculados no servidor — devolver a
    linha inteira evita que o cliente precise recalcular esses campos
    localmente (ou fingir que sabe o valor de `atualizado_em`) só pra
    manter a UI consistente até o próximo refetch.

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

STATUS_CAMPANHA = ['ativa', 'suspensa', 'encerrada'] as const
StatusCampanha = (typeof STATUS_CAMPANHA)[number]
isStatusCampanha(value: string): value is StatusCampanha
```

Todas as 3 constantes de domínio (`CARGOS`/`ABRANGENCIAS`/`STATUS_CAMPANHA`)
e seus type guards vivem juntos em `campanha.ts` — uma única fonte de
constantes do domínio `campanha`, em vez de espalhadas entre esse arquivo e
`transicionar-status.ts`. Organização que escala melhor se surgirem outras
regras envolvendo `StatusCampanha` no futuro.

### `web/lib/campanha/transicionar-status.ts`

```
import { type StatusCampanha } from '../campanha';

transicionarStatus(atual: StatusCampanha, novo: StatusCampanha):
  | { valida: true; update: { status: StatusCampanha; suspensa_em?: string | null } }
  | { valida: false; erro: string }

Regras:
  - atual === novo             → { valida: false, erro: 'já está nesse status' }
  - atual === 'encerrada'      → { valida: false, erro: 'campanha encerrada não pode mudar de status' }
  - novo === 'suspensa'        → update = { status: 'suspensa', suspensa_em: <now ISO> }
  - suspensa → ativa           → update = { status: 'ativa', suspensa_em: null }
  - (ativa|suspensa) → encerrada → update = { status: 'encerrada' }
    (`suspensa_em` OMITIDO do update, não setado pra `null` — preserva o
    valor que já estiver na linha, seja ele `null` ou um timestamp real de
    uma suspensão anterior)
```

### `POST /api/superadmin/campanhas` (adiciona ao arquivo existente)

```
1. bloqueado = await requireSuperadmin(); se bloqueado, retorna
2. body: {subdominio, nome, cargo, abrangencia, municipioId?, uf?, dataEleicao}
3. valida: todos os campos obrigatórios presentes — 400 se não
4. valida: subdominio bate ^[a-z0-9-]+$, tamanho 3-63 — 400 se não
5. valida: isCargo(cargo), isAbrangencia(abrangencia) — 400 se não
6. valida: abrangencia==='municipal' → municipioId presente e uf ausente
           abrangencia==='estadual'  → uf presente e municipioId ausente
           — 400 se não (mensagem explica qual campo esperado)
7. se abrangencia==='estadual': uf = uf.trim().toUpperCase(); valida ^[A-Z]{2}$ — 400 se não
8. valida: dataEleicao bate ^\d{4}-\d{2}-\d{2}$ E os componentes capturados
   batem com getUTCFullYear/getUTCMonth+1/getUTCDate de
   new Date(`${dataEleicao}T00:00:00.000Z`) — 400 se não (ver decisão 13,
   Date.parse() sozinho normaliza datas impossíveis em vez de rejeitar)
9. adminClient().from('campanha').insert({...}).select().single()
10. erro de unicidade (subdominio duplicado) → 400 {erro: 'subdomínio já em uso'}
    outro erro de banco → 400 {erro: error.message}
11. sucesso → 201 com a linha criada
```

### `POST /api/superadmin/campanhas/status` (rota nova)

```
1. bloqueado = await requireSuperadmin(); se bloqueado, retorna
2. body: {campanhaId, novoStatus}
3. valida: campanhaId presente, novoStatus presente e isStatusCampanha(novoStatus) — 400 se não
4. adminClient().from('campanha').select('status').eq('id', campanhaId).single()
   — campanha não encontrada → 400 {erro: 'campanha não encontrada'}
5. resultado = transicionarStatus(atual, novoStatus)
   — se { valida: false }, 400 {erro: resultado.erro}
6. adminClient().from('campanha')
     .update({ ...resultado.update, atualizado_em: now() })
     .eq('id', campanhaId).select().single()
   (a rota só aplica resultado.update — nunca decide suspensa_em sozinha)
7. sucesso → 200 { campanha: <linha atualizada> }
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

1. `ativa`→`suspensa`: válida, `update.suspensa_em` é um timestamp (não
   `null`, não ausente).
2. `suspensa`→`ativa`: válida, `update.suspensa_em === null`.
3. `ativa`→`encerrada`: válida, `update` NÃO tem a chave `suspensa_em`
   (omitida, não `null`) — não mexe no que já estiver na linha.
4. `suspensa`→`encerrada`: válida, `update` também NÃO tem `suspensa_em` —
   preserva o timestamp de quando a suspensão aconteceu, mesmo depois de
   encerrada (prova direta da decisão 7).
5. `encerrada`→`ativa` (ou qualquer coisa saindo de `encerrada`): inválida,
   mensagem explica que é terminal.
6. `ativa`→`ativa` (mesmo status): inválida, mensagem "já está nesse
   status".

### `POST /api/superadmin/campanhas`

7. 401/403 mesma regra de `requireSuperadmin()` (já testado em outras
   rotas do painel, S7).
8. 400 com campo obrigatório faltando, sem chamar `insert`.
9. 400 com `subdominio` fora do formato (`"Meu Site"`, `"ABC"`,
   `"teste!!!"`, string com menos de 3 ou mais de 63 caracteres), sem
   chamar `insert`.
10. 400 com `cargo`/`abrangencia` fora da lista fechada, sem chamar
    `insert`.
11. 400 com `abrangencia='municipal'` e `municipioId` ausente (ou `uf`
    presente junto) — e o caso simétrico pra `'estadual'`.
12. `uf` é normalizada antes de gravar: `" ma "` vira `"MA"` no `insert`
    (teste de sucesso que confirma o valor enviado ao `insert`); `uf` com
    formato inválido depois de normalizada (ex.: `"M4"`, `"MAS"`) → 400.
13. 400 com `dataEleicao` vazia, em formato errado (`"10/01/2028"`), ou
    sintaticamente válida mas impossível (`"2028-02-30"`).
14. 400 com `subdominio` duplicado (constraint de unicidade simulada no
    mock), sem vazar o erro cru do Postgres.
15. 201 com a linha criada em caso de sucesso.

### `POST /api/superadmin/campanhas/status`

16. 401/403 mesma regra.
17. 400 com `campanhaId` inexistente.
18. 400 com `novoStatus` fora da lista fechada (ex.: `"banana"`, `"ativo"`
    — não confundir com `"ativa"`), sem chamar `transicionarStatus` nem
    `update`.
19. 400 com transição inválida (delega pra `transicionarStatus`, já testada
    isoladamente acima — aqui só confirma que a rota rejeita e não chama
    `update`).
20. 200 com transição válida — confirma que a rota aplica exatamente
    `resultado.update` (nunca calcula `suspensa_em` por conta própria) e
    retorna `{campanha: <linha atualizada>}`.

### `DashboardSuperadminClient`

21. Preencher e submeter o formulário de nova campanha dispara
    `POST /api/superadmin/campanhas` com o corpo certo; sucesso adiciona a
    linha na tabela sem refetch.
22. Erro na criação mostra `body.erro` em `role="alert"`.
23. Uma campanha `ativa` mostra os botões "Suspender"/"Encerrar" (não
    "Reativar"); uma `suspensa` mostra "Reativar"/"Encerrar"; uma
    `encerrada` não mostra nenhum botão.
24. Clicar num botão de transição dispara
    `POST /api/superadmin/campanhas/status` com `{campanhaId, novoStatus}`
    certo, desabilita o botão durante a requisição, e atualiza o `status`
    exibido só depois do `200`.
