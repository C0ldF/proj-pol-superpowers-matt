# Fatia E — Cadastro de pessoas e vínculos (UI)

**Status:** aprovado (design conversado e confirmado pelo usuário).

## Contexto

O S2 (2026-06-30, ver ADR 0003/0004/0016) construiu o backend completo da
rede política — grafo Pessoa+Vínculo, RLS por sub-árvore, realocação
automática ao remover vínculo, criptografia em camadas (ADR 0010) — mas
**nenhuma tela consome isso**. `POST /api/pessoas`, `DELETE
/api/vinculos/[id]` e `GET /api/vinculos/[id]/impacto` existem e têm teste,
mas o produto inteiro (dashboard, mapa de calor, ranking) só **exibe**
dado que fisicamente não há como inserir hoje pelo produto — só via
`execute_sql` manual. Esta fatia completa o fluxo de gerenciamento de
pessoas: cadastrar apoiador, montar hierarquia, listar/ver/remover.

**Estado atual do backend (`web/lib/pessoa/`, `web/lib/vinculo/`,
`web/app/api/pessoas/`, `web/app/api/vinculos/`):**
- `POST /api/pessoas` — cria Pessoa+Vínculo via RPC
  `criar_pessoa_com_vinculo` (SECURITY DEFINER). Aceita
  `nome, titulo, cpf, telefone, email_contato, responsavel_id, papel,
  confirmar_compartilhado`. Dedup por título/CPF (HMAC) — se encontra
  duplicata e `confirmar_compartilhado` não veio, retorna `409` com
  `{ error: 'pessoa_duplicada', match_por, pessoa_existente }`. `base_legal`
  e `origem_coleta` já vêm fixos (`legitimointeresse`/`manual`, hardcoded em
  `build-criar-deps.ts`) — não editáveis nesta fatia.
- `DELETE /api/vinculos/[id]` — remove o vínculo. **Só realoca a
  sub-árvore se o body trouxer `destino_id`** — `removerVinculo()`
  (`web/lib/vinculo/remover.ts:16-19`) chama `realocarSubarvore` apenas
  quando `count > 0 && destino_id` veio preenchido; se `destino_id` for
  omitido, a sub-árvore fica **órfã** (vínculos dos filhos continuam
  apontando pro responsável removido). O backend **não** escolhe um
  default sozinho — quem chama a API decide o destino. Verificado no
  código, não é responsabilidade que a UI possa deixar implícita (ver
  decisão 12).
  `GET /api/vinculos/[id]/impacto` — retorna `{ count, responsavel_acima }`
  pra exibir antes de confirmar; `removerVinculo` recalcula `count`
  internamente no momento do `DELETE` (não recebe nem confia em nenhum
  número vindo do client) — já é seguro contra a árvore ter mudado entre
  a consulta de impacto e a confirmação.
- `POST /api/pessoas/[publicId]/provisionar-login` — existe, **fora do
  escopo desta fatia** (adiado).
- **Não existe nenhum endpoint de leitura/listagem** — nem `GET
  /api/pessoas`, nem `GET /api/pessoas/[publicId]`, nem busca de
  zona/seção. Esta fatia cria os três.

**RLS já faz o trabalho pesado de visibilidade:** `pessoa_select` e
`vinculo_select` (policies já existentes desde o S2) usam
`actor_pode_ver_pessoa(auth.uid(), id)` — um `select` via `ssrClient`
(RLS do usuário, não `adminClient`) já retorna exatamente a sub-árvore
visível do actor, sem função nova. Os 3 endpoints novos desta fatia são
essencialmente `select`s finos sobre isso.

**Campos já modelados na tabela `pessoa` e nunca expostos:** `secao_id`
(nullable — o que ancora a pessoa no mapa de calor, ADR 0006; FK
`pessoa_secao_id_fkey` é `NO ACTION`/RESTRICT, não `SET NULL` — mas
nenhum fluxo do produto apaga uma `secao` hoje, o caso é inalcançável
nesta fatia, só relevante se um dia existir exclusão de seção),
`titulo_enc`/`titulo_hmac` (CPF só tem `cpf_hmac`, **nunca** existe
`cpf_enc` — CPF nunca pode ser exibido em texto puro, só título pode, via
`decryptTitulo()` de `web/lib/titulo-enc.ts`), `base_legal`,
`data_coleta`, `consentimento_dado_em`/`consentimento_revogado_em`
(LGPD, ADR 0009 — só leitura nesta fatia).

## Decisões

### Escopo desta fatia

1. **Cadastrar + listar + remover.** Fora de escopo (adiado
   deliberadamente): editar pessoa depois de criada, provisionar login de
   liderança, revogar consentimento/exportar dados (direitos do titular,
   ADR 0009), UI de auditoria (ADR 0014). Cada um vira fatia própria
   depois.
2. **`secao_id` entra no form de cadastro (opcional)** — sem isso, toda
   pessoa criada por esta fatia ficaria permanentemente invisível pro
   mapa de calor (Força conta por `secao_id` → `local` → `geo`, ADR
   0006), desconectando a feature nova da que já existe. Exige: migration
   nova (RPC `criar_pessoa_com_vinculo` ganha `p_secao_id uuid DEFAULT
   NULL`, INSERT em `pessoa` passa a incluir a coluna), `CriarPessoaDeps`
   (`web/lib/pessoa/criar.ts`) e `build-criar-deps.ts` propagam o campo,
   `POST /api/pessoas` aceita `secao_id` opcional no corpo.

### `GET /api/pessoas` (lista, nova)

3. **Busca por nome, sem paginação, ordenado por nome.** `?q=<termo>`
   faz `WHERE unaccent(nome) ILIKE unaccent('%<termo>%')` — substring
   (não só prefixo), `ILIKE` já é case-insensitive por definição do
   Postgres, e `unaccent()` torna a busca também acento-insensitive
   ("jose" acha "José"); as extensões `unaccent`/`pg_trgm` já estão
   habilitadas neste banco desde o S3 (ingestão TRE), sem custo de
   habilitar de novo. RLS já filtra a sub-árvore antes de qualquer
   busca, impossível ver pessoa fora dela. Sem `q`, lista tudo que a
   RLS libera. `ORDER BY nome ASC` sempre. Sem paginação nesta fatia —
   volume de uma campanha em MVP é dezenas a poucas centenas de
   pessoas, YAGNI adicionar cursor/offset agora; **se o volume passar
   de algumas centenas de pessoas por campanha, paginação vira
   requisito** (sinal pra revisão futura, não motivo pra construir
   agora).
   Resposta: `{ pessoas: [{ public_id, nome, vinculos: [{ id, papel,
   responsavel: { public_id, nome } | null }] }] }` — `vinculos` é lista
   (não singular) porque uma Pessoa pode ter mais de um Vínculo (ADR
   0003, apoiador compartilhado entre 2 ramos) e isso **precisa** ficar
   visível, não escondido atrás do primeiro vínculo encontrado.
4. **O autocomplete de "Responsável" (decisão 9) reutiliza este mesmo
   endpoint**, consumindo só um subconjunto dos campos da resposta
   (`public_id`, `nome`) — o endpoint existe pra listar/buscar Pessoa,
   não foi desenhado "pro autocomplete"; o autocomplete é só mais um
   consumidor dele. Nenhum endpoint separado.

### `GET /api/pessoas/[publicId]` (detalhe, nova)

5. Resposta `200`: `{ public_id, nome, telefone, email_contato, titulo:
   string | null, secao: { zona_numero, secao_numero } | null,
   base_legal, data_coleta, vinculos: [{ id, papel, responsavel: {
   public_id, nome } | null }] }`. `titulo` vem **decriptado**
   server-side (`decryptTitulo(titulo_enc)`) — só quem passa pela RLS de
   `pessoa_select` chega aqui, então exibir em texto puro pra esse
   público é o comportamento pretendido pelo ADR 0010 ("cifra pra
   exibição", não pra esconder de todo mundo). **CPF nunca aparece na
   resposta** — não existe `cpf_enc` na tabela, só hash irreversível;
   não há o que decriptar. `publicId` inexistente **ou** fora da
   sub-árvore visível do actor (RLS bloqueia a leitura, os dois casos
   ficam indistinguíveis de propósito — não vazar "existe mas você não
   pode ver" por enumeração) → `404 { erro: 'pessoa não encontrada' }`,
   mesmo padrão de erro genérico já usado em `provisionar-login`.

### `GET /api/secoes` (busca zona/seção, nova)

6. **Sem parâmetro** → lista zonas do município da campanha (via
   `campanha.municipio_id`, resolvido do token): `{ zonas: [{ id,
   numero }] }`. **Com `?zona_id=`** → lista seções daquela zona: `{
   secoes: [{ id, numero, aptos }] }`. Alimenta o seletor em cascata
   (decisão 8: zona → seção) do form de cadastro.
7. **Campanha estadual (ADR 0005) não filtra por município nesta
   fatia** — lista todas as zonas da UF sem agrupar por município.
   Funcional, mas menos curado que o caso municipal (que é o único caso
   de teste disponível hoje). Documentado como débito, não bloqueia.

### `/pessoas` (lista)

8. **A listagem é orientada por Pessoa.** Campo de busca (nome) + tabela
   + botão "+ Nova pessoa". Entretanto, pra Pessoas com mais de um
   Vínculo, cada Vínculo aparece em uma linha própria, repetindo os
   dados da Pessoa — torna explícita a existência de vínculos
   compartilhados (ADR 0003) em vez de esconder atrás do primeiro
   encontrado (mesma resposta da decisão 3, `pessoas[].vinculos[]`
   expandido em N linhas no client quando N > 1). Colunas: nome, papel,
   responsável. Usa o mesmo padrão visual da `RankingTable` (card,
   `thead` tokenizado, `border-t border-outline-variant`) — a fatia já
   nasce com o design system completo, não é restilo depois.

### `/pessoas/novo` (cadastro)

9. Campos: **Nome*** (`Input`), Título de eleitor (`Input`, valida 12
   dígitos no cliente — sem checagem de dígito verificador, não existe
   função pra isso no projeto hoje, diferente do CPF que já tem
   `cpfValido()`), CPF (`Input`, valida via `cpfValido()` já existente),
   Telefone (`Input`), E-mail de contato (`Input`), **Responsável***
   (autocomplete sobre `GET /api/pessoas?q=`, decisão 4), **Papel***
   (`<select>` tokenizado: Coordenador/Colaborador/Liderança/Apoiador —
   **sem Gestor**, que é único por campanha e não nasce por este form),
   Zona+Seção (2 `<select>` em cascata, opcional, decisão 6).
   **O autocomplete de Responsável só mostra Pessoas com vínculo de
   papel Gestor, Coordenador ou Liderança** (filtro aplicado no client
   sobre a resposta de `GET /api/pessoas`) — Apoiador não tem login nem
   comanda a árvore, Colaborador é transversal e "não comanda a árvore
   política" (ADR 0004), nenhum dos dois deveria virar responsável de
   ninguém. **Isso é só filtro de UI, não é imposto pelo backend:**
   `actor_pode_criar_vinculo_sob` (verificado no código) valida quem é
   o *ator* da ação, nunca o papel do `responsavel_id` escolhido — hoje
   nada no banco impede escolher um Apoiador como responsável. O filtro
   de UI é a única barreira contra esse erro nesta fatia. **Débito
   técnico conhecido, decisão consciente:** um cliente HTTP fora da UI
   (`curl`/Postman) ainda consegue enviar `POST /api/pessoas` com
   `responsavel_id` de um Apoiador e o backend aceita — a validação
   deveria migrar pro backend (RPC ou `actor_pode_criar_vinculo_sob`)
   numa fatia futura; não faz parte desta.
10. **Duplicata (409):** modal/mensagem no formato "Já existe uma
    pessoa cadastrada com este título/CPF. Nome encontrado:
    **{nome}**. Deseja apenas criar um novo vínculo?" + checkbox/botão
    "confirmar vínculo compartilhado" → reenvia com
    `confirmar_compartilhado: true`. A pergunta explícita ("deseja
    apenas criar um novo vínculo?") deixa claro que isso é válido (ADR
    0003: mesma pessoa sob 2 responsáveis), não um erro a evitar.

### `/pessoas/[publicId]` (detalhe)

11. Nome, telefone, e-mail, título (se existir), zona+seção (se
    existir), base legal + data de coleta (só leitura), resumo curto
    ("Possui **N** vínculo(s) ativo(s)") acima da lista de vínculos
    ativos (papel + responsável, com link pro responsável se ele também
    for uma Pessoa navegável).
12. **Remover vínculo:** botão por vínculo → `GET .../impacto` primeiro
    → modal de confirmação "**N** pessoa(s) serão realocadas para
    **{responsavel_acima.nome}**" + botão "Cancelar" (fecha o modal sem
    chamar `DELETE`) → `DELETE`. **A UI sempre envia `destino_id` no
    corpo do `DELETE`** — por padrão o `responsavel_acima.public_id`
    retornado pelo `impacto` (nunca omite o campo; o backend não escolhe
    esse default sozinho, ver "Estado atual do backend" acima). Se
    `N > 50` (limiar do ADR 0016), o modal troca o tom de aviso (mais
    enfático) e ganha um campo de busca (mesmo autocomplete do form de
    cadastro, decisão 9) pra escolher um `destino_id` diferente do
    default, em vez de só confirmar.
13. **Vínculo raiz (Gestor, `responsavel_id IS NULL`) não tem
    "responsável acima".** `actor_pode_remover_vinculo` (verificado no
    código) não impede um Gestor de remover o próprio vínculo raiz — se
    isso acontecesse, `GET .../impacto` retornaria `responsavel_acima:
    null` e a decisão 12 não teria pra onde apontar o default. Esta
    fatia **desabilita o botão "Remover vínculo"** quando
    `responsavel_acima` vem `null`, com texto explicando que remover o
    Gestor raiz é decisão de ciclo de vida da campanha, fora de escopo
    aqui (não é o mesmo tipo de operação que remover um Coordenador/
    Liderança/Apoiador comum).
14. **Remover o último vínculo de uma Pessoa a deixa órfã, não
    apagada.** ADR 0016 é explícito: remover vínculo nunca apaga a
    Pessoa (esse é o fluxo separado de exclusão LGPD, ADR 0009, fora de
    escopo). Mas como a visibilidade (RLS `pessoa_select`/
    `vinculo_select`) é sempre via vínculo, uma Pessoa com **zero**
    vínculos deixa de aparecer em qualquer listagem/busca desta fatia —
    o registro continua existindo no banco (PII incluída) mas fica
    inalcançável pelo produto, só recuperável via SQL direto. Pra não
    criar esse estado por acidente, esta fatia **desabilita "Remover
    vínculo" quando é o único vínculo da Pessoa** (`vinculos.length ===
    1`), com texto explicando que remover o último vínculo tornaria a
    pessoa inacessível pelo produto.

## Arquitetura

**Backend:**
- Migration nova: `criar_pessoa_com_vinculo` ganha `p_secao_id uuid
  DEFAULT NULL`, propagado pro `INSERT INTO pessoa`. `DEFAULT NULL`
  mantém compatibilidade retroativa — qualquer chamador existente do
  RPC que não passe `p_secao_id` continua funcionando exatamente como
  hoje, sem precisar de migração de dados nem de código adicional.
- `web/lib/pessoa/criar.ts` — `CriarPessoaDeps.criarPessoaComVinculo` e
  `CriarPessoaInput` ganham `secao_id?: string`.
- `web/lib/pessoa/build-criar-deps.ts` — propaga `secao_id` pro RPC.
- `web/app/api/pessoas/route.ts` (`POST`, existente) — aceita
  `secao_id` opcional; mesmo arquivo ganha `GET` novo (lista, decisão
  3).
- Novo `web/app/api/pessoas/[publicId]/route.ts` (`GET`, decisão 5).
- Novo `web/app/api/secoes/route.ts` (`GET`, decisão 6).

**Frontend:**
- Nova página `web/app/pessoas/page.tsx` + novo componente
  `PessoasListClient.tsx` (lista).
- Nova página `web/app/pessoas/novo/page.tsx` + novo componente
  `NovaPessoaClient.tsx` (form).
- Nova página `web/app/pessoas/[publicId]/page.tsx` + novo componente
  `PessoaDetalheClient.tsx` (detalhe + remover vínculo).
- `NavShell` ganha 1 link novo ("Pessoas") na lista `LINKS`
  (`web/app/components/NavShell.tsx`).
- Autocomplete de "Responsável" (decisão 9) é um novo componente local
  pequeno (debounce + `fetch` em `GET /api/pessoas?q=`, filtro de papel
  aplicado no client), não um componente de design system genérico —
  só 2 usos nesta fatia (form de cadastro, modal de realocação), mesma
  disciplina YAGNI de sempre.

## Testes

- Testes de unidade/integração pros 3 endpoints novos (`GET
  /api/pessoas`, `GET /api/pessoas/[publicId]`, `GET /api/secoes`),
  seguindo o padrão DI já usado em `POST /api/pessoas`
  (`build*Deps`/orquestrador puro).
- **Teste de RLS entre atores** (o mais importante desta fatia): usuário
  A não consegue listar/ver pessoa da sub-árvore do usuário B (mesma
  campanha, ramos diferentes) via `GET /api/pessoas` nem `GET
  /api/pessoas/[publicId]` — a barreira é `actor_pode_ver_pessoa` já
  existente, mas os endpoints novos são a primeira vez que ficam
  expostos a leitura direta por HTTP, então o teste precisa existir
  aqui, não só confiar que a policy "deve" funcionar.
- **Teste de vínculo compartilhado:** Pessoa com 2 Vínculos (2
  responsáveis diferentes) → `GET /api/pessoas` retorna exatamente 2
  entradas em `vinculos[]` pra ela (não 1, não deduplicado) — protege
  diretamente a regra da decisão 3/8 desta fatia (nunca esconder o
  segundo vínculo atrás do primeiro).
- Teste da migration: `criar_pessoa_com_vinculo` com `p_secao_id` null
  (comportamento antigo intacto) e não-null (nova coluna persistida).
- Testes de componente (Testing Library) pras 3 telas novas, seguindo o
  padrão já usado em `DashboardSuperadminClient.test.tsx`/
  `MapaCalorClient.test.tsx` (`@vitest-environment jsdom`, mock de
  `fetch`).
- Verificação visual real via Playwright (mesmo padrão das fatias
  anteriores): cadastrar uma pessoa de teste com seção, confirmar que
  ela aparece no mapa de calor depois; testar o fluxo de duplicata; testar
  remover vínculo com realocação.

## Não-objetivos desta fatia

- Editar pessoa depois de criada (nome, telefone, etc.) — fatia futura.
- **Excluir Pessoa** — esta fatia só remove Vínculo (ADR 0016: "remover
  o Carlos" = remover vínculo/acesso, não apagar a Pessoa). Apagar a
  Pessoa de fato é o fluxo separado de direito de exclusão do titular
  (ADR 0009), junto com o resto dos direitos LGPD já listados abaixo.
- Provisionar login de liderança pela UI — endpoint já existe, tela não
  nasce aqui.
- Direitos do titular LGPD (acesso/correção/exclusão/exportação/revogação
  de consentimento) — ADR 0009, fatia própria, maior escopo (jurídico +
  fluxo de confirmação).
- UI de log de auditoria (ADR 0014) — fatia própria.
- Visualização em árvore/hierarquia navegável (grafo visual) — esta
  fatia usa lista plana; árvore visual é enriquecimento futuro (era a
  opção "cadastrar + árvore visual completa" que o usuário não escolheu
  nesta rodada).
- Checagem de dígito verificador do título de eleitor — só valida
  formato (12 dígitos), não existe função de validação de dígito
  verificador no projeto hoje.
- Campanha estadual: seletor de zona/seção não agrupa por município
  (decisão 7) — funcional, não curado.
- Base legal/origem de coleta editáveis no form — ficam fixos
  (`legitimointeresse`/`manual`), mesmo comportamento de hoje.
