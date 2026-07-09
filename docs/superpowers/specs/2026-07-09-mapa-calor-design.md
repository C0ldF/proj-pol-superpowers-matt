# Fatia C2 — `/mapa-calor`

**Status:** aprovado (design conversado e confirmado pelo usuário).

## Contexto

Quarta fatia do rollout de design system (depois da fundação, fatia B
"auth restante" e fatia C1 "NavShell + `/dashboard`"). Fecha a
decomposição da fatia C (C1+C2, mesmo motivo da decomposição A→B —
escopo grande demais pra uma fatia só). `NavShell` já foi restilizado
na C1 e não é tocado aqui além do já herdado (a página consome o
mesmo componente sem mudança).

**Estado atual (`web/app/mapa-calor/MapaCalorClient.tsx`):**
- Fetch de `/api/mapa-calor?granularidade=zona|bairro` — refaz fetch
  só quando `granularidade` muda, nunca quando `camada` muda (o
  payload já vem com `forca`/`potencial`/`penetracao` de cada área
  numa única chamada). Este contrato não muda nesta fatia.
- Cor do marcador: 1 cor **fixa hardcoded** por camada
  (`CORES = { forca: '#2563eb', potencial: '#16a34a', penetracao:
  '#dc2626' }`), sem relação com a magnitude do valor. Valor `null`
  (só `penetracao` pode ser `null`, "sem dado") usa a mesma cor da
  camada com `opacity: 0.2`.
- Controles: 2 `<select>` nativos crus (`Granularidade`, `Camada`),
  sem nenhuma classe Tailwind.
- Mapa: `<div>` cru `width:100%,height:600px`, sem borda/moldura.
- Popup: `setDOMContent` com `<strong>`/texto solto sem tipografia
  tokenizada (isso já foi corrigido de XSS na fatia do S4 — a
  correção de segurança não muda aqui, só o estilo).
- Erro: `<p role="alert">{erro}</p>` cru.
- Teste (`MapaCalorClient.test.tsx`, 4 casos): fetch com
  `granularidade=zona` por padrão; troca de granularidade refaz
  fetch; troca de camada NÃO refaz fetch; erro mostra mensagem.
  Nenhum desses 4 testa cor/estilo — todos continuam válidos sem
  modificação.
- As 3 rampas sequenciais de heatmap (`--color-heatmap-forca-100..700`,
  `--color-heatmap-potencial-100..700`, `--color-heatmap-penetracao-100..700`,
  13 steps cada, `web/app/globals.css`) existem desde a fatia da
  fundação, geradas e validadas (OKLCH, monotonicidade, CVD,
  contraste) via skill `dataviz` — **nunca usadas em nenhum código até
  agora**.

## Decisões

1. **Cor do marcador passa a variar por magnitude, usando a rampa de
   13 steps da camada ativa** (era 1 cor fixa por camada). Escala
   **linear min-max dos dados carregados no momento**: pega o menor e
   maior valor não-nulo da camada ativa entre as áreas retornadas
   agora, mapeia pra 1 dos 13 steps (`100`→mais claro,
   `700`→mais escuro). Não são limiares fixos hardcoded — a escala se
   adapta a qualquer campanha/magnitude sem caso especial por camada
   (resolve o problema de Força/Potencial serem contagens sem teto
   fixo e Penetração ser uma proporção 0–1: a mesma fórmula funciona
   pras 3 sem branch por tipo). Consequência aceita: a cor de uma área
   específica pode mudar entre 2 carregamentos diferentes se o
   conjunto de dados mudar — é o comportamento correto pra uma escala
   relativa (dataviz: "sequential = magnitude, um hue, mais escuro =
   mais").
2. **Valor nulo (`penetracao: null`, "sem dado") vira cinza neutro
   (`--color-on-surface-variant`), fora da rampa colorida** — nunca
   pode ser confundido com "valor baixo" (que seria o step mais claro
   da mesma rampa). Antes usava a mesma cor da camada com opacidade
   reduzida, o que ficava ambíguo justamente por causa da mudança da
   decisão 1 (com cor fixa por camada a ambiguidade não existia do
   mesmo jeito). Popup continua dizendo "sem dado" pro valor de
   Penetração nesse caso (texto já existente, não muda).
3. **Legenda nova: barra horizontal com gradiente dos 13 steps +
   min/max real dos dados carregados**, entre os controles e o mapa
   (não flutuante sobre o mapa — não deve competir com os
   marcadores/popups por espaço). Web-safe via `linear-gradient` CSS
   inline usando os 13 tokens da camada ativa como color-stops. Rótulo
   min à esquerda, max à direita, formatado com o mesmo valor bruto
   que aparece no popup (sem unidade especial pra Penetração nesta
   fatia — já é assim no popup hoje, não é regressão introduzida
   aqui). Se todos os valores da camada ativa forem `null` (edge case:
   nenhum dado de Penetração ainda), a legenda não renderiza (não faz
   sentido mostrar gradiente sem extremos) — todos os marcadores ficam
   cinza nesse caso.
4. **Controles (`<select>` nativos) ganham classes consistentes com o
   `Input`** já existente (`web/app/components/Input.tsx`) — mesma
   borda (`border-outline hover:border-on-surface-variant`), `rounded`,
   `bg-surface-container-lowest`, foco visível idêntico
   (`focus-visible:outline focus-visible:outline-2
   focus-visible:outline-offset-2 focus-visible:outline-primary`).
   **Sem componente `Select` novo** — só 2 usos no projeto inteiro,
   abstrair agora seria prematuro (mesma disciplina de `Button`/
   `Input`/`Message`, YAGNI já estabelecido nas fatias anteriores).
5. **Mapa fica dentro de um card** (`rounded border
   border-outline-variant`, mesmo tratamento visual dos cards de
   `AlertasList`/`RankingTable` do dashboard) — mantém consistência
   entre as 2 telas autenticadas do produto. Popup ganha tipografia
   tokenizada: nome da área em `text-title-md`/`text-on-surface`
   (destaque), os 3 valores (Força/Potencial/Penetração) em
   `text-body-md`/`text-on-surface-variant`. Continua via
   `setDOMContent` (nunca `setHTML` — a correção de XSS do S4 não
   muda). Nome da área usa `font-medium text-body-lg text-on-surface`
   (não existe escala `title` nos 7 tokens de tipografia da fundação —
   `display-lg`/`headline-lg`/`headline-md`/`body-lg`/`body-md`/
   `label-md`/`data-mono` — `body-lg`+`font-medium` é o destaque
   correto pro tamanho compacto de um popup, `headline-md` ficaria
   grande demais).
6. **Erro vira `<Message variant="error">`** — mesmo componente já
   usado em `/login`, `/superadmin/login`, `/redefinir-senha`,
   `AlertasList`, `EvolucaoChart`, `RankingTable`. Produz o mesmo
   `role="alert"` do `<p role="alert">` atual — o teste existente
   (`getByRole('alert')`) continua passando sem modificação.

## Arquitetura

**Módulo novo `web/lib/mapa-calor/cor-por-valor.ts`** (lógica pura,
sem React/DOM — testável em isolamento, diferente das 4 tasks da C1
que eram só apresentação):

```ts
export const STEPS = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700] as const;

export function indiceStep(valor: number, min: number, max: number): number {
  if (min === max) return 6; // step 400 — centro exato dos 13 steps (índice 6 de 0-12)
  const proporcao = (valor - min) / (max - min);
  return Math.round(proporcao * 12);
}

export function corPorValor(
  valor: number | null,
  min: number,
  max: number,
  camada: 'forca' | 'potencial' | 'penetracao',
): string {
  if (valor === null) return 'var(--color-on-surface-variant)';
  const step = STEPS[indiceStep(valor, min, max)];
  return `var(--color-heatmap-${camada}-${step})`;
}

export function extentes(
  areas: { forca: number; potencial: number; penetracao: number | null }[],
  camada: 'forca' | 'potencial' | 'penetracao',
): { min: number; max: number } | null {
  const valores = areas.map((a) => a[camada]).filter((v): v is number => v !== null);
  if (valores.length === 0) return null;
  return { min: Math.min(...valores), max: Math.max(...valores) };
}
```

`indiceStep`/`corPorValor`/`extentes` são as 3 unidades testáveis
desta fatia — cobertura via TDD antes de integrar no componente.

**`MapaCalorClient.tsx`:**
- Importa `corPorValor`/`extentes` do módulo novo.
- `useEffect` que desenha os markers (já existe) passa a calcular
  `extentes(areas, camada)` 1x por render do efeito (não por marker) e
  usar `corPorValor(valor, min, max, camada)` no lugar de
  `CORES[camada]` — se `extentes` retornar `null` (todos nulos),
  todo marcador usa `var(--color-on-surface-variant)` direto.
  `el.style.opacity` deixa de existir (a distinção sem-dado agora é só
  de cor, não opacidade — a decisão 2 tornou a opacidade redundante).
- Legenda: novo bloco local (função não-exportada dentro do arquivo,
  mesmo padrão dos ícones `IconArea`/`IconLideranca` da C1) que
  recebe `{ min, max, camada }` e renderiza o gradiente CSS + os 2
  rótulos. Só renderiza se `extentes(...)` não for `null`.
- Estrutura de layout: `<NavShell>` → `<div className="flex flex-col
  gap-6">` (mesmo gap-6 introduzido no fix final da C1 pro
  `DashboardClient`) contendo: controles (`flex gap-4`, os 2
  `<label>`+`<select>`), legenda condicional, card do mapa
  (`rounded border border-outline-variant overflow-hidden` — o
  `overflow-hidden` garante que o `maplibregl` não vaze quina
  quadrada pra fora do `rounded` do card pai).
- Popup: a construção via `document.createElement` continua igual
  estruturalmente, só ganha `className` nos elementos (`nome.className
  = 'font-medium text-body-lg text-on-surface'`, valores em
  `text-body-md text-on-surface-variant`).

## Testes

- `web/lib/mapa-calor/cor-por-valor.test.ts` (novo, TDD): `indiceStep`
  — valor no mínimo → índice 0, valor no máximo → índice 12, valor no
  meio → índice ~6, `min === max` → índice 6. `corPorValor` — valor
  `null` → `var(--color-on-surface-variant)` sempre, independente da
  camada; valor no mínimo/máximo de cada camada → o token do step 100/
  700 daquela camada especificamente (não confundir rampas entre
  camadas). `extentes` — lista vazia ou todos `null` → `null`; mistura
  de `null` e números → ignora os `null` no cálculo de min/max.
- `web/app/mapa-calor/MapaCalorClient.test.tsx` (4 casos existentes) —
  não modificados, continuam passando sem alteração (nenhum testa cor
  ou estilo, só fetch/estado).
- Nenhum teste novo em `MapaCalorClient.test.tsx` — a integração da
  cor no componente é coberta indiretamente pelos testes unitários do
  módulo puro + verificação visual real (abaixo). Testar cor de
  marker via jsdom seria testar detalhe de implementação do MapLibre
  (mock), não comportamento real.
- Verificação visual real via Playwright (mesmo padrão das fatias
  anteriores) contra o servidor de dev, com dado real ou fixture:
  marcadores variam de cor conforme o valor dentro da mesma camada,
  marcador sem dado aparece cinza distinto da rampa, legenda mostra
  gradiente + min/max corretos e muda ao trocar de camada, popup com
  tipografia tokenizada, controles com o mesmo tratamento visual do
  `Input`, mapa dentro do card com borda — desktop **e** mobile (sem
  scroll horizontal).

## Não-objetivos desta fatia

- Mudar o contrato de fetch (`granularidade` refaz fetch, `camada`
  não) — comportamento existente intocado.
- Adicionar unidade/formatação especial ao valor de Penetração (ex.:
  `%`) no popup ou na legenda — já não tinha antes, não é regressão
  introduzida aqui, fica como débito conhecido igual ao débito já
  registrado da C1 (tabela/resumo acessível do gráfico).
- Componente `Select` reutilizável — só 2 usos, mesma disciplina
  YAGNI de `Button`/`Input`/`Message`.
- Legenda genérica/reutilizável fora deste arquivo — só 1 uso real até
  agora.
- Mudar a correção de segurança XSS do S4 (`setDOMContent` em vez de
  `setHTML`) — só estilo é adicionado, a construção via
  `document.createElement` continua.
- Zoom/clustering de marcadores, ou qualquer mudança de comportamento
  do MapLibre além de cor — fora de escopo, isso é restilo + 1 feature
  pontual (cor por magnitude), não uma revisão de UX do mapa.
