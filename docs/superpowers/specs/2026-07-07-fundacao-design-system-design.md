# Fundação inicial do Design System + Restilização do Login

**Status:** aprovado (mockup revisado no Figma pelo usuário).

## Contexto

As telas existentes do sistema ainda não possuem uma identidade visual
consistente desde S0 — todas as 6 telas existentes (`/login`,
`/redefinir-senha`, `/dashboard`, `/mapa-calor`, `/superadmin/login`,
`/superadmin/dashboard`) possuem apenas marcação JSX sem estilização
(`className` praticamente inexistente). O projeto `web/` ainda preserva
boa parte do scaffold original do `create-next-app` (título ainda
"Create Next App", fontes Geist default) — embora já existam páginas,
testes e autenticação implementados por cima dele.

Esta é a primeira fatia de uma série de rollout visual. Ela entrega uma
**fundação inicial** (tokens + 2 componentes reutilizáveis — `Button` e
`Input`, nada além disso) e aplica numa **tela real** (`/login`) como
prova da arquitetura proposta, evitando introduzir infraestrutura
desacoplada de um caso real de uso. As próximas 3 fatias (auth restante,
dashboard+mapa de calor, painel superadmin) ficam fora de escopo, cada
uma com seu próprio spec/plano quando chegar a vez.

## Origem da paleta

Paleta gerada no Google Stitch (fornecida pelo usuário), revisada e
ajustada nesta sessão:
- Tokens M3 (Material) completos — cores, tipografia (Inter), radius,
  spacing — aprovados como estão, com a ressalva de que a prosa da
  entrega do Stitch continha hexadecimais inconsistentes com o YAML de
  tokens (ex.: `#F8FAFC`/`#0D9488` do Tailwind Slate/Teal genérico em vez
  dos valores reais `#fbf8fa`/`#006a61`) — **o YAML de tokens é a fonte
  da verdade, a prosa foi descartada**.
- As 3 rampas sequenciais do mapa de calor (Força/Potencial/Penetração)
  não vieram do Stitch (só os nomes das famílias de cor) — foram geradas
  durante o processo de design utilizando a skill `dataviz` (OKLCH,
  gamut-clamped, mesma curva de L/C da rampa de referência da skill) e
  validadas por script (`validate_palette.js`, parte da skill `dataviz`
  — não é um arquivo deste repositório): monotonicidade de luminosidade
  confirmada nas 3;
  as 3 âncoras (step 450) juntas passam CVD target (ΔE 15.7, acima do
  alvo 12) e contraste ≥3:1 quando aparecem lado a lado (ex.: seletor de
  camada do mapa de calor); legendas discretas de 4 ticks validadas
  (Força/Potencial iniciam no step 250, Penetração no step 300 — verde
  lê mais claro que violeta/âmbar no mesmo L perceptual contra fundo
  claro, efeito conhecido da fórmula de luminância WCAG).
- Não modo escuro — decisão explícita do usuário, fora de escopo.

## Decisões desta fatia

1. **Stack CSS: Tailwind v4** (config CSS-first, via `@tailwindcss/postcss`
   — integração oficial do Tailwind v4 com Next.js, estável independente
   da versão do Next; o plugin Vite não se aplica aqui, é pra projetos
   Vite). Projeto hoje não tem nenhuma lib de CSS instalada, só CSS
   Modules default do `create-next-app`. Os tokens do Stitch já vêm no
   formato Tailwind (`rounded: sm/DEFAULT/md/lg/xl/full`,
   `spacing.unit: 4px`) — o formato é compatível diretamente com o
   modelo CSS-first do Tailwind v4.
2. **Mockup no Figma antes do código** — decisão do usuário (tem conta
   Pro). Arquivo criado: "Sistema Campanha — Design System"
   (`fileKey=nrru1S5LuYK0kBxKB0vsAp`,
   https://www.figma.com/design/nrru1S5LuYK0kBxKB0vsAp). Contém:
   - **Coleção de variáveis "Color"**: 86 variáveis — 45 tokens M3 do
     Stitch (semânticos: `primary`, `on-primary`, `surface-container-*`,
     etc.) + 3 rampas de heatmap × 13 steps (`heatmap-forca/100..700`,
     `heatmap-potencial/100..700`, `heatmap-penetracao/100..700`).
   - **7 text styles**: `display-lg`, `headline-lg`, `headline-md`,
     `body-lg`, `body-md`, `label-md`, `data-mono` (Inter, pesos/tamanhos
     do Stitch).
   - **2 componentes**: `Button/Primary` (fill `primary`, texto
     `on-primary`, radius 4, padding 12/24), `Input/Text` (label acima do
     campo, campo com stroke `outline`, fill `surface-container-lowest`,
     radius 4) — ambos com fills bound a variáveis, não hex solto.
   - **Frame "Login Screen"** (1440×900, node `2:8`): split-screen —
     painel esquerdo 605px fill `primary` (navy) com o wordmark "Sistema
     Campanha" centralizado (`headline-md`, cor `on-primary`) — **sem
     ícone de logo**, ainda não existe arquivo de logomarca, fica só
     texto por enquanto (a logomarca será incorporada em uma fatia
     futura, quando o arquivo oficial existir); painel direito 835px
     fill `surface`, conteúdo centralizado
     verticalmente: heading "Entrar" (`headline-lg`), 2 instâncias de
     `Input/Text` (CPF/e-mail, Senha), 1 instância de `Button/Primary`
     ("Entrar").
   - Radius/spacing (4px, 8px, etc.) foram aplicados como números diretos
     nos componentes — **não** modelados como variáveis Figma nesta
     fatia (só cor e tipografia viraram tokens formais). Documentado aqui
     como corte de escopo deliberado, não esquecido.
3. **Elemento de assinatura descartado**: a primeira versão do painel
   esquerdo tinha uma textura abstrata de pontos nas 3 cores do heatmap
   (90 elipses, sem geografia real). O usuário não gostou — versão final
   é só fundo navy sólido + wordmark centralizado, mais austero.

## Arquitetura da implementação (código)

**Tailwind v4** — verificar a documentação da versão do Next.js
utilizada pelo projeto antes da instalação (`web/node_modules/next/dist/docs/`),
conforme orientação do `web/AGENTS.md`, para confirmar que
`@tailwindcss/postcss` continua sendo a integração recomendada no
momento da implementação. Tokens do Figma viram:
- `web/app/globals.css`: `@theme` block (Tailwind v4 CSS-first) com as
  45 cores M3 + as 3 rampas (13 steps cada) como custom properties
  `--color-*`, mapeadas 1:1 pros nomes das variáveis do Figma
  (`--color-primary`, `--color-heatmap-forca-450`, etc.) — nomenclatura
  kebab-case idêntica ao Figma pra rastreabilidade.
- Fonte: `Inter` via `next/font/google` (troca o `Geist`/`Geist_Mono`
  atual do `layout.tsx`), pesos 400/500/600/700 (os usados nos 7 text
  styles).

**Componentes** (`web/app/components/` — convenção já existente no
projeto, é onde `NavShell.tsx` mora hoje). Não há intenção de
transformar estes componentes em biblioteca genérica nesta fatia — só
o que `/login` usa hoje:
- `Button.tsx` — variante única `primary` por enquanto (é só o que o
  login usa); `type`, `disabled`, `children` via props, sem
  `class-variance-authority` ou lib de variantes — YAGNI, só 1 variante
  não justifica a dependência. Estados: `default`, `hover`, `focus`
  (visível, via `:focus-visible`), `disabled` (usado no `enviando` do
  login).
- `Input.tsx` — `label`, `type`, resto via `ComponentProps<'input'>`
  (spread); mesmo raciocínio, sem abstração além do que o login usa
  hoje (texto e senha). Estados: `default`, `hover`, `focus`,
  `disabled`. Estado `error` (borda `error`) faz parte da API do
  componente por completude, mas `/login` não o exercita hoje — o erro
  de login é uma mensagem genérica abaixo do form (`role="alert"`), não
  validação por campo.

**Tela `/login`** (`web/app/login/page.tsx` — substitui apenas a camada
de apresentação; lógica de `entrar()`/estado **não muda**): estrutura
split-screen igual ao Figma, usa `Button`/`Input`, erro (`role="alert"`)
estilizado com `error`/`on-error-container` tokens.

**Acessibilidade:** foco sempre visível (`:focus-visible`, nunca
removido via `outline: none` sem substituto), ordem de tabulação segue
a ordem visual (identificador → senha → botão), contraste mínimo WCAG
AA em todo texto — já verificado nos tokens usados (ver seção "Origem
da paleta" e os cálculos de contraste feitos durante a revisão da
paleta nesta sessão).

## Testes

- `web/app/login/page.test.tsx` já tem 7 casos (fluxo de submit, erro,
  desabilitar botão). Os testes existentes devem continuar válidos, já
  que a lógica permanece inalterada. Caso algum dependa da estrutura DOM
  anterior, os seletores deverão ser ajustados mantendo o comportamento
  validado (ex.: `getByRole('button')` deve continuar funcionando,
  `Button` renderiza `<button>` de verdade).
- Sem teste novo de snapshot visual — verificação visual real via
  Playwright (servidor de dev), mesmo padrão já usado no S4/S5 do
  projeto: abrir `/login` no browser, screenshot, comparar com o mockup
  aprovado no Figma.
- **Responsividade** (decisão desta fatia, não faz parte do mockup
  aprovado no Figma — o mockup é desktop-only, 1440px): em telas
  menores que `md`, o layout passa para `flex-col` — o painel
  institucional (esquerda no desktop) torna-se uma faixa horizontal
  superior, e o formulário ocupa o restante da tela abaixo dela.

## Não-objetivos desta fatia

- Restilizar `/redefinir-senha`, `/dashboard`, `/mapa-calor`,
  `/superadmin/*` — fatias futuras (B/C/D).
- Modo escuro — fora de escopo por decisão do usuário.
- Logomarca/ícone — não existe arquivo ainda; painel esquerdo fica só
  texto. A logomarca será incorporada em uma fatia futura, quando o
  arquivo oficial existir.
- Variáveis Figma de radius/spacing — só cor e tipografia formalizadas
  como tokens nesta fatia.
- `NavShell` (usado por `/dashboard` e `/mapa-calor`) — não é tocado
  aqui, `/login` não tem navegação.
