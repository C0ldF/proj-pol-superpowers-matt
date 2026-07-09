# Fatia D — `/superadmin/dashboard`

**Status:** aprovado (design conversado e confirmado pelo usuário).

## Contexto

Última tela autenticada do produto sem design system — fecha o rollout
visual (fundação → fatia B → fatia C1 `/dashboard` → fatia C2
`/mapa-calor` → esta fatia). `/superadmin/login` já foi restilizado no
S7/fatia B (split-screen `bg-primary` + wordmark "Painel Superadmin",
`Input`/`Button`/`Message`) e não é tocado aqui além do padrão que
estabelece.

**Estado atual (`web/app/superadmin/dashboard/DashboardSuperadminClient.tsx`):**
- Botão "Sair" `<button>` cru solto no topo, sem estrutura de layout.
- Form "Nova campanha": 6 campos (`subdominio`, `nome`, `cargo` select,
  `abrangencia` select, `municipioId`/`uf` condicional, `dataEleicao`),
  todos `<input>`/`<select>` crus empilhados, sem `<label>` (só
  `placeholder`/`aria-label`), sem moldura.
- Tabela: `<table>` crua, 1 coluna por módulo (`MODULOS` =
  `['comunicacao', 'ia']`) com `<input type="checkbox" aria-label={m}>`,
  coluna de status com texto solto + botões de transição
  (`PROXIMOS_STATUS`).
- 2 estados de erro independentes: `erro` (falha ao carregar lista,
  falha de status, falha de módulo) e `erroCriar` (falha ao criar
  campanha) — ambos `<p role="alert">` cru.
- `web/app/superadmin/dashboard/page.tsx`: sem `redirect()` — mostra
  texto inline `"não autenticado"`/`"acesso restrito ao superadmin"`.
  Mesmo padrão deliberado do S4/S5/S7 (nunca alterado nas fatias de
  redirect anteriores, que tocaram só `/dashboard` e `/mapa-calor` da
  campanha — `/superadmin/*` é identidade separada). Não muda nesta
  fatia.
- Teste (`DashboardSuperadminClient.test.tsx`, 11 casos): usa
  `getByPlaceholderText(...)` pros campos do form,
  `getByRole('checkbox', {name: modulo})` pros checkboxes,
  `getByText(rótulo)` pros botões de status/"Sair"/"Nova campanha",
  `getByRole('alert')` pros 2 erros. Nenhum desses 11 testa cor/estilo —
  todos continuam válidos sem modificação.

## Decisões

### Estrutural

1. **Sem `NavShell`** — a sidebar de campanha (links Mapa de Calor/
   Dashboard) não faz sentido pro superadmin, que é uma identidade
   separada (mesma decisão já tomada no S7 pro resto do namespace
   `/superadmin/*`). Estrutura vira local nesta página:
   `<div className="flex min-h-screen flex-col">` → barra de topo →
   `<main className="flex flex-col gap-6 p-6">` com as 2 seções
   (form + tabela).
2. **Barra de topo local** (função não-exportada no mesmo arquivo, igual
   ao padrão `Legenda`/`IconArea` das fatias C2/C1):
   `bg-surface-container-low border-b border-outline-variant px-6 py-4`,
   `flex items-center justify-between`. Wordmark "Painel Superadmin"
   (`text-headline-md text-on-surface`, mesmo tratamento do wordmark
   "Sistema Campanha" do `NavShell`) à esquerda. Botão "Sair" à
   direita — **não** usa o componente `Button` (que é estilizado pra
   CTA, `bg-primary`, deslocado numa barra de topo); usa o mesmo botão
   texto puro já existente no `NavShell` (`rounded px-4 py-2 text-body-md
   text-on-surface-variant hover:text-on-surface` + cadeia
   `focus-visible`), copiado inline (não extraído pro `NavShell` — são
   2 sistemas de navegação intencionalmente desacoplados, extrair agora
   seria abstração prematura pra 1 uso a mais).

### Form "Nova campanha"

3. **Card com grid responsivo**: `rounded border border-outline-variant
   bg-surface-container-lowest p-6`, `<h2 className="text-headline-md
   text-on-surface">Nova campanha</h2>` + `<form className="grid
   grid-cols-1 gap-4 md:grid-cols-2">`. Campos de texto (`Subdomínio`,
   `Nome`, `Código IBGE do município`/`UF`, `Data da eleição`) viram
   `Input` — mantém o `placeholder` exato de cada um (testes usam
   `getByPlaceholderText`), `label` novo (texto igual ao placeholder,
   já que não existia rótulo nenhum antes). `cargo`/`abrangencia`
   viram `<select>` com as mesmas classes tokenizadas da fatia C2
   (`rounded border border-outline bg-surface-container-lowest px-4
   py-3 text-body-lg text-on-surface hover:border-on-surface-variant`
   + cadeia `focus-visible`), envoltos num `<label>` com `<span
   className="text-label-md text-on-surface-variant">` (mesmo padrão
   C2), preservando `aria-label` como estava (redundante com o label
   visual novo, mas inofensivo e nenhum teste depende dele sumir).
   Botão "Nova campanha" vira `Button type="submit"` ocupando as 2
   colunas (`className="md:col-span-2"`). Erro de criação vira
   `<Message variant="error">{erroCriar}</Message>`.

### Tabela de campanhas

4. **Mesmo padrão visual da `RankingTable`** (fatia C1): card
   (`rounded border border-outline-variant overflow-hidden`) com
   `<h2 className="text-headline-md text-on-surface">Campanhas</h2>`
   fora do card (mesmo posicionamento da `RankingTable`),
   `overflow-x-auto` dentro, `<thead className="bg-surface-container-low">`,
   `th` com `px-4 py-2 font-medium` (colunas de checkbox centralizadas
   via `text-center`), `tr` com `border-t border-outline-variant`,
   `td` com `px-4 py-2`. Checkbox de módulo ganha `accent-primary`
   (token de cor nativo do navegador via `accent-color`, sem
   reinventar componente de checkbox — YAGNI, 1 único lugar no
   projeto que usa checkbox).
5. **Botões de status** (`Suspender`/`Reativar`/`Encerrar`) usam
   `Button` com `className` reduzindo padding/tamanho (`px-3 py-1.5`
   em vez do `px-6 py-3` padrão) pra caber numa célula de tabela —
   mesma família visual/foco/disabled do `Button`, só mais compacto.
   **Risco técnico conhecido e aceito:** classes conflitantes do
   Tailwind (`px-6`/`px-3` no mesmo elemento) não necessariamente
   resolvem pela ordem em que aparecem no `className` — a fatia inclui
   verificação visual real pra confirmar que o override de fato
   aplica; se não aplicar, o fallback é mover o botão de status pra um
   `<button>` nativo com classes escritas do zero (sem herdar de
   `Button`), decisão a tomar na hora se a verificação falhar.
6. **Erro de lista/status/módulo** (`erro`) vira `<Message
   variant="error">{erro}</Message>` no mesmo lugar em que já aparece
   hoje (`if (erro) return ...` antes da tabela).

## Arquitetura

Toda a mudança é dentro de `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx`
— nenhum componente novo compartilhado, nenhuma mudança de contrato de
API/fetch/estado. `web/app/superadmin/dashboard/page.tsx` não muda.

- Barra de topo: bloco de JSX local no início do `return`, sem função
  separada (é pequena o bastante — diferente da `Legenda` do C2, que
  tinha lógica própria de gradiente, aqui é só marcação).
- Ordem de leitura do arquivo: imports (`Input`/`Button`/`Message`
  novos) → tipos/constantes (intocados) → componente → barra de topo →
  card do form → card da tabela.

## Testes

- `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`
  (11 casos existentes) — não modificados, continuam passando sem
  alteração (nenhum testa cor/estilo, só fetch/estado/texto visível).
- Nenhum teste novo — esta fatia é puramente de apresentação (mesmo
  padrão das fatias C1/C2: JSX/CSS não ganha teste dedicado, cobertura
  via os testes de comportamento já existentes + verificação visual).
- Verificação visual real via Playwright (mesmo padrão das fatias
  anteriores) contra o servidor de dev, com sessão de superadmin real:
  barra de topo com wordmark + Sair, form em card com grid 2 colunas
  no desktop / 1 no mobile, tabela com checkbox tokenizado e botões de
  status **realmente menores** que o `Button` padrão (o risco do item
  5 acima), os 2 banners de erro via `Message`, sem scroll horizontal
  de página em mobile (só a tabela deve scrollar horizontalmente via
  seu próprio `overflow-x-auto`, nunca a página).

## Não-objetivos desta fatia

- Redirect (`redirect('/login')`-like) em `web/app/superadmin/dashboard/page.tsx`
  pro não-autenticado/não-superadmin — o padrão inline atual
  (`"não autenticado"`/`"acesso restrito ao superadmin"`) é decisão
  deliberada e recorrente desde o S4/S5/S7, específica do namespace
  `/superadmin/*` (separado da campanha); as fatias de redirect
  anteriores tocaram só `/dashboard` e `/mapa-calor` da campanha, de
  propósito.
- Componente `Select` reutilizável — mesma disciplina YAGNI já
  estabelecida (`Button`/`Input`/`Message`/decisão equivalente na C2).
- Extrair a barra de topo pra um componente compartilhado tipo
  `NavShell` — só 1 uso, e os 2 sistemas de navegação (campanha vs.
  superadmin) são intencionalmente desacoplados.
- Mudar qualquer lógica de fetch/estado/validação do form ou da
  tabela — só estilo.
- Mudar `/superadmin/login` — já restilizado, intocado.
- Paginação/busca/filtro na tabela de campanhas — fora de escopo,
  nunca foi pedido, número de campanhas ainda é pequeno.
