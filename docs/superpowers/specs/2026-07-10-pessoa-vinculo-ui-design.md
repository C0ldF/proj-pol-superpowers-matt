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
`execute_sql` manual. Esta fatia fecha esse buraco: cadastrar apoiador,
montar hierarquia, listar/ver/remover.

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
- `DELETE /api/vinculos/[id]` — remove vínculo, realoca sub-árvore pro
  responsável acima (ou pro `destino_id` do body, se enviado).
  `GET /api/vinculos/[id]/impacto` — retorna `{ count, responsavel_acima }`
  antes de confirmar a remoção.
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
(nullable — o que ancora a pessoa no mapa de calor, ADR 0006),
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

3. **Busca por nome, sem paginação.** `?q=<termo>` faz `ilike` em `nome`
   (RLS já filtra a sub-árvore antes de qualquer busca — impossível ver
   pessoa fora dela). Sem `q`, lista tudo que a RLS libera. Sem
   paginação nesta fatia — volume de uma campanha em MVP é dezenas a
   poucas centenas de pessoas, YAGNI adicionar cursor/offset agora.
   Resposta: `{ pessoas: [{ public_id, nome, vinculos: [{ id, papel,
   responsavel: { public_id, nome } | null }] }] }` — `vinculos` é lista
   (não singular) porque uma Pessoa pode ter mais de um Vínculo (ADR
   0003, apoiador compartilhado entre 2 ramos) e isso **precisa** ficar
   visível, não escondido atrás do primeiro vínculo encontrado.
4. **Mesmo endpoint alimenta o autocomplete de "Responsável"** no form de
   cadastro (decisão 8) — não cria endpoint separado pra isso.

### `GET /api/pessoas/[publicId]` (detalhe, nova)

5. Resposta: `{ public_id, nome, telefone, email_contato, titulo:
   string | null, secao: { zona_numero, secao_numero } | null,
   base_legal, data_coleta, vinculos: [{ id, papel, responsavel: {
   public_id, nome } | null }] }`. `titulo` vem **decriptado**
   server-side (`decryptTitulo(titulo_enc)`) — só quem passa pela RLS de
   `pessoa_select` chega aqui, então exibir em texto puro pra esse
   público é o comportamento pretendido pelo ADR 0010 ("cifra pra
   exibição", não pra esconder de todo mundo). **CPF nunca aparece na
   resposta** — não existe `cpf_enc` na tabela, só hash irreversível;
   não há o que decriptar.

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

8. Campo de busca (nome) + tabela (nome, papel(is)/responsável(is) —
   1 linha por vínculo se a pessoa tiver mais de um, mesma lógica da
   decisão 3) + botão "+ Nova pessoa". Usa o mesmo padrão visual da
   `RankingTable` (card, `thead` tokenizado, `border-t
   border-outline-variant`) — a fatia já nasce com o design system
   completo, não é restilo depois.

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
10. **Duplicata (409):** mostra "já existe **{nome}** com esse
    título/CPF" + checkbox "confirmar vínculo compartilhado" → reenvia
    com `confirmar_compartilhado: true`. Mensagem explicita que isso é
    válido (ADR 0003: mesma pessoa sob 2 responsáveis), não um erro a
    evitar.

### `/pessoas/[publicId]` (detalhe)

11. Nome, telefone, e-mail, título (se existir), zona+seção (se
    existir), base legal + data de coleta (só leitura), lista de
    vínculos ativos (papel + responsável, com link pro responsável se
    ele também for uma Pessoa navegável).
12. **Remover vínculo:** botão por vínculo → `GET .../impacto` primeiro
    → modal de confirmação "**N** pessoa(s) serão realocadas para
    **{responsavel_acima.nome}**" → `DELETE`. Se `N > 50` (limiar do ADR
    0016), o modal troca o tom de aviso (mais enfático) e ganha um
    campo de busca (mesmo autocomplete do form de cadastro) pra escolher
    um `destino_id` diferente do default, em vez de só confirmar.

## Arquitetura

**Backend:**
- Migration nova: `criar_pessoa_com_vinculo` ganha `p_secao_id uuid
  DEFAULT NULL`, propagado pro `INSERT INTO pessoa`.
- `web/lib/pessoa/criar.ts` — `CriarPessoaDeps.criarPessoaComVinculo` e
  `CriarPessoaInput` ganham `secao_id?: string`.
- `web/lib/pessoa/build-criar-deps.ts` — propaga `secao_id` pro RPC.
- `web/app/api/pessoas/route.ts` (`POST`) — aceita `secao_id` opcional.
- **Novo** `web/app/api/pessoas/route.ts` ganha `GET` (lista, decisão 3).
- **Novo** `web/app/api/pessoas/[publicId]/route.ts` (`GET`, decisão 5).
- **Novo** `web/app/api/secoes/route.ts` (`GET`, decisão 6).

**Frontend:**
- **Novo** `web/app/pessoas/page.tsx` + `PessoasListClient.tsx` (lista).
- **Novo** `web/app/pessoas/novo/page.tsx` + `NovaPessoaClient.tsx`
  (form).
- **Novo** `web/app/pessoas/[publicId]/page.tsx` +
  `PessoaDetalheClient.tsx` (detalhe + remover vínculo).
- `NavShell` ganha 1 link novo ("Pessoas") na lista `LINKS`
  (`web/app/components/NavShell.tsx`).
- Autocomplete de "Responsável" (decisão 9) é um componente local
  pequeno (debounce + `fetch` em `GET /api/pessoas?q=`), não um
  componente de design system genérico — só 2 usos nesta fatia (form de
  cadastro, modal de realocação), mesma disciplina YAGNI de sempre.

## Testes

- Testes de unidade/integração pros 3 endpoints novos (`GET
  /api/pessoas`, `GET /api/pessoas/[publicId]`, `GET /api/secoes`),
  seguindo o padrão DI já usado em `POST /api/pessoas`
  (`build*Deps`/orquestrador puro).
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
