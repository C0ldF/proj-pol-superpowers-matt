# Fatia C1 — NavShell + `/dashboard`

**Status:** aprovado (design conversado e confirmado pelo usuário).

## Contexto

Terceira fatia do rollout de design system (depois da fundação e da
fatia B "auth restante"). Fatia C foi decomposta em 2 sub-fatias — esta
(C1: `NavShell` + `/dashboard`) e uma futura (C2: `/mapa-calor`), pelo
mesmo motivo da decomposição A→B: escopo grande demais pra uma fatia
só. `/mapa-calor` fica de fora desta fatia inteiramente (nem o
`NavShell` usado lá é tocado além do componente compartilhado em si —
`MapaCalorClient` continua sem nenhuma classe Tailwind até a C2).

**Estado atual:**
- `web/app/components/NavShell.tsx` — nav horizontal solta sem
  estilo, 2 links (`Mapa de Calor`, `Dashboard`) + botão "Sair". Tem
  teste (`NavShell.test.tsx`, 3 casos) que trava `getByText('Mapa de
  Calor')`/`getByText('Dashboard')`/`getByText('Sair')` (texto exato) e
  o comportamento de logout (`POST /api/auth/logout` + redirect,
  inclusive com falha de rede). Usado por `/dashboard` e `/mapa-calor`.
- `web/app/dashboard/DashboardClient.tsx` — monta `NavShell` +
  `AlertasList` + `EvolucaoChart` + `RankingTable`, sem nenhuma
  marcação própria.
- `web/app/dashboard/AlertasList.tsx` — busca `/api/dashboard/alertas`,
  renderiza `<ul><li>` cru com 2 tipos de alerta (`area`,
  `lideranca_estagnada`), erro cru (`<p role="alert">`). Teste trava 3
  casos: renderiza os 2 tipos, estado vazio, erro.
- `web/app/dashboard/EvolucaoChart.tsx` — busca
  `/api/dashboard/evolucao`, `recharts` `LineChart` com `stroke="#2563eb"`
  hardcoded (não é token do design system), erro cru. Teste trava 3
  casos: busca+título, estado vazio (série toda zero), erro.
- `web/app/dashboard/RankingTable.tsx` — busca `/api/dashboard/ranking`,
  `<table>` cru, erro cru. Teste trava 4 casos: busca+linhas, nota de
  soma dos ramos, estado vazio, erro.
- Nenhum destes arquivos usa `Button`/`Input`/`Message` (fatias A/B)
  hoje.

## Decisões

1. **`NavShell` vira sidebar esquerda fixa, 240px** — bate com o
   brief original do Stitch ("Sidebars: persistent left-hand
   navigation... provides constant access to core modules"), não uma
   barra horizontal. Fundo neutro (`bg-surface-container-low` +
   `border-r border-outline-variant`) — **não** `bg-primary` (navy):
   o navy já é o "momento de assinatura" das telas de auth (painel
   institucional do split-screen); repetir esse acento numa nav
   persistente de uso prolongado disputaria atenção com o conteúdo
   denso do dashboard/mapa de calor, e dilui o que torna o momento das
   telas de auth distintivo. Wordmark "Sistema Campanha" no topo
   (mesmo texto do `/login` — contexto de campanha, não superadmin).
   Link ativo (rota atual, via `usePathname()`) ganha
   `bg-primary text-on-primary` (mesmo tratamento visual do `Button`
   primário — reforça que é a seleção atual); inativo:
   `text-on-surface-variant hover:bg-surface-container`.
2. **Botão "Sair" fica como link de texto simples, não usa `Button`** —
   `Button` continua com 1 variante só (decisão já estabelecida nas
   fatias A/B, YAGNI). Criar uma 2ª variante ("ghost"/texto) só pra
   este único caso abriria a API do componente antes de precisar de
   verdade em outro lugar. "Sair" fica um `<button>` nativo estilizado
   inline no rodapé da sidebar, discreto (`text-on-surface-variant
   hover:text-on-surface`), sem competir visualmente com nenhuma ação
   primária da tela.
3. **Erro dos 3 componentes do dashboard vira `Message` (fatia B)** —
   mesmo componente já usado nas 3 telas de auth. `AlertasList`,
   `EvolucaoChart`, `RankingTable` trocam `<p role="alert">{erro}</p>`
   por `<Message variant="error">{erro}</Message>` — produz o mesmo
   `role="alert"`, os 3 testes existentes (`getByRole('alert')`)
   continuam passando sem modificação.
4. **`AlertasList` vira cards com ícone de severidade** — cada alerta
   é um card (`bg-surface-container`, `rounded`, padding, borda) com
   um ícone SVG (não emoji — regra de estilo já seguida no projeto)
   distinguindo os 2 tipos, não só cor (acessibilidade — "color not
   only" já é regra seguida desde a fundação). Sem lib de ícones nova:
   só 2 ícones precisam existir no projeto inteiro até agora, então
   são 2 SVG inline hand-authored, não uma dependência (`lucide-react`
   etc.) — YAGNI, mesma disciplina do resto do design system. Ícone de
   `area`: pin de localização. Ícone de `lideranca_estagnada`: pessoa/
   usuário. Ambos stroke-based, mesma largura de traço.
5. **`EvolucaoChart` usa a skill `dataviz`** — é série única
   (cadastro total por dia, 90 dias), job = magnitude/mudança ao
   longo do tempo, não identidade — não precisa de paleta categórica
   nem legenda (o título "Evolução (90 dias)" já nomeia a série,
   regra da skill: "a single series needs no legend box"). Cor:
   `secondary` (teal, `#006a61`) no lugar do azul hardcoded
   `#2563eb` — `secondary` já é definido desde a paleta original do
   Stitch como "positive progression", encaixe semântico direto pra
   crescimento de cadastro (não é a mesma cor de nenhuma das 3 rampas
   de heatmap Força/Potencial/Penetração, que são de outro domínio de
   dado e ficam reservadas pro mapa de calor). Linha fina
   (`strokeWidth={2}`, já sem `dot`), sem grid novo (minimalismo,
   nenhum grid existia antes). O `<Tooltip />` do recharts já
   satisfaz o requisito de hover da skill — não precisa de
   implementação nova.
6. **`RankingTable` não vira componente `Table` novo** — só existe 1
   tabela no projeto inteiro até agora; extrair um componente
   reutilizável antes de um 2º uso real seria abstração prematura
   (mesma disciplina de `Button`/`Input`/`Message`, todos só
   nasceram quando 2+ telas precisaram). `<table>` ganha classes
   Tailwind diretamente. A coluna numérica (`subarvore_count`) usa
   `text-data-mono` (token criado na fundação, nunca consumido até
   agora) + a utility `tabular-nums` do Tailwind, exatamente como o
   comentário deixado na fundação já previa ("combine com a utility
   `tabular-nums`... pra alinhamento numérico em tabelas").

## Arquitetura

**`NavShell.tsx`** (`web/app/components/NavShell.tsx`, já é
`'use client'`): adiciona `usePathname` (`next/navigation`) pra
destacar o link ativo. Estrutura vira `<div className="flex min-h-screen">`
com `<aside>` sidebar (240px fixo) + `<main>` ocupando o resto
(`flex-1`). Wordmark, 2 links de nav, botão "Sair" ficam dentro do
`<aside>`. `sair()` (a função que já existe, chama
`POST /api/auth/logout` e redireciona) não muda — só a marcação do
botão que a dispara.

**`AlertasList.tsx`**: estado/fetch/lógica de decisão de texto por
tipo não mudam — só a renderização. Cada item do array vira um card
com o ícone do tipo + o texto (mesmo texto já gerado hoje pela lógica
existente). Estado vazio (`"Nenhum alerta no momento."`) mantém texto
idêntico (trava do teste), só ganha estilo. Erro vira `Message`.

**`EvolucaoChart.tsx`**: só a prop `stroke` da `<Line>` muda de
`"#2563eb"` pra `var(--color-secondary)` (ou o hex `#006a61`
diretamente, já que `recharts` não lê classes Tailwind — só aceita
cor via prop `stroke`, então usa o valor CSS var ou hex, não uma
`className`) + `strokeWidth={2}` explícito. Título/seção ganham
classes de tipografia (`text-headline-md`, etc.). Erro vira `Message`.
Estado vazio mantém texto idêntico.

**`RankingTable.tsx`**: `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<td>`
ganham classes de token (bordas, padding, `bg-surface-container-low`
no header). `<td>` da coluna `subarvore_count` ganha
`className="text-data-mono tabular-nums"`. Nota de soma dos ramos
mantém texto idêntico (trava do teste). Erro vira `Message`. Estado
vazio mantém texto idêntico.

**Ícones** (`area`/`lideranca_estagnada`): SVGs inline definidos
diretamente dentro de `AlertasList.tsx`, como componentes de função
locais no mesmo arquivo (não exportados, não viram arquivo próprio) —
só 2 usos, ambos no único lugar que os consome.

**Responsividade da sidebar:** mesmo princípio já usado no split-screen
das telas de auth — abaixo do breakpoint `md`, o container raiz vira
`flex-col` (sidebar deixa de ser 240px fixo lateral e vira uma faixa
horizontal no topo, largura total); em `md` e acima, `flex-row` com a
sidebar fixa em 240px lateral.

## Testes

- `web/app/components/NavShell.test.tsx` (3 casos existentes) — não
  modificado, continua passando sem alteração (texto dos links/botão
  idêntico, comportamento de logout idêntico).
- `web/app/dashboard/AlertasList.test.tsx` (3 casos existentes) — não
  modificado.
- `web/app/dashboard/EvolucaoChart.test.tsx` (3 casos existentes) —
  não modificado.
- `web/app/dashboard/RankingTable.test.tsx` (4 casos existentes) — não
  modificado.
- Nenhum teste novo previsto nesta fatia — é restilização de
  componentes já cobertos, mesma disciplina da fatia B quando um
  componente já tinha teste (ex.: `/superadmin/login`) vs. quando não
  tinha (`/redefinir-senha`, que ganhou teste novo). Todos os 4
  arquivos aqui já têm cobertura.
- Verificação visual real via Playwright (mesmo padrão das fatias
  anteriores) contra o servidor de dev, com dado real ou fixture:
  sidebar ativa destaca a rota certa, cards de alerta com ícone
  visível, gráfico renderiza com a cor `secondary`, tabela com coluna
  numérica alinhada (`tabular-nums`).

## Não-objetivos desta fatia

- `/mapa-calor` — fatia C2, futura, spec própria.
- Nova variante no `Button` — "Sair" fica fora do componente.
- Componente `Table` reutilizável — só 1 uso real até agora.
- Lib de ícones (`lucide-react` etc.) — 2 ícones inline bastam.
- Mudar qualquer lógica de fetch/estado/decisão de texto nos 3
  componentes do dashboard ou no `NavShell` — só apresentação.
- Menu hambúrguer ou qualquer colapso interativo da sidebar em mobile
  — o comportamento responsivo desta fatia é só `flex-col`/`flex-row`
  via breakpoint (ver "Responsividade da sidebar" acima), sem estado
  de aberto/fechado nem JS de toggle.
