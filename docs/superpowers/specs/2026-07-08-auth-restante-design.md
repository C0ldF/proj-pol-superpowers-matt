# Fatia B — Auth Restante: `/redefinir-senha` + `/superadmin/login`

**Status:** aprovado (design conversado e confirmado pelo usuário).

## Contexto

Fatia anterior (fundação do design system) restilizou `/login` e deixou
`/superadmin/login` e `/redefinir-senha` como débito conhecido — a
revisão final daquela fatia confirmou visualmente (screenshot
Playwright) que o Preflight do Tailwind quebrou a aparência nativa de
`<input>`/`<button>` nessas duas telas (sem borda/fundo, quase
invisíveis), já que elas usam elementos HTML crus sem nenhuma classe
Tailwind. Esta fatia fecha esse débito.

Ambas as telas são forms pequenos (1-2 campos) e reutilizam o mesmo
layout visual introduzido em `/login` (split-screen, tokens,
componentes `Input` e `Button`), preservando apenas a lógica
específica de cada fluxo. Ver seção "Padrão visual" abaixo.

**Estado atual de cada tela:**
- `/superadmin/login` (`web/app/superadmin/login/page.tsx`) — e-mail +
  senha, `POST /api/superadmin/login`, erro genérico com `role="alert"`.
  Tem teste (`page.test.tsx`, 2 casos) que usa
  `getByPlaceholderText('E-mail')`, `getByPlaceholderText('Senha')`,
  `getByText('Entrar')`, `getByRole('alert')`. **Sem estado de
  loading/disabled durante o request** (diferente do `/login`, que já
  desabilita o botão via `enviando`).
- `/redefinir-senha` (`web/app/redefinir-senha/page.tsx`) — só senha,
  chama `supabase.auth.updateUser` direto do client (não via rota
  própria). Mensagem de resultado é um `<p>{msg}</p>` genérico, sem
  `role="alert"`/`role="status"`, sem distinguir visualmente sucesso de
  erro. **Não tem nenhum teste hoje.**

## Decisões

1. **Escopo: restilizar + fechar as 3 lacunas** (decisão do usuário,
   diferente da fatia anterior que foi restilização pura):
   - `/superadmin/login` ganha estado `enviando` (desabilita o `Button`
     durante o request, reabilita depois — mesmo padrão já usado em
     `/login`).
   - `/redefinir-senha` ganha `role` correto na mensagem (`alert` pra
     erro, `status` pra sucesso) — ver componente `Message` abaixo.
   - `/redefinir-senha` ganha teste novo (`page.test.tsx`, não existe
     hoje).
   - Nenhuma outra lógica muda. Em particular, `/redefinir-senha`
     **não** ganha estado de loading/disabled — não é uma das 3 lacunas
     combinadas, fica fora de escopo mesmo com o "fechar lacunas" mais
     amplo desta fatia. Embora uma UX semelhante à do `/login` fosse
     desejável, essa tela recebe uma única submissão pouco frequente
     (fluxo de recuperação de senha, não login recorrente) — a
     implementação de loading foi deliberadamente adiada pra manter
     esta fatia pequena, não esquecida.

2. **Novo componente `Message`** (`web/app/components/Message.tsx`) —
   variante `'error' | 'success'`. Representa mensagens **inline**
   associadas ao formulário (aparecem dentro do próprio form, perto
   dos campos) — não substitui nem antecipa um eventual sistema de
   notificações do produto (toast/snackbar), que teria requisitos
   diferentes (posicionamento fixo, timeout, empilhamento). Se o
   produto ganhar toasts no futuro, é um componente novo, não uma
   extensão deste.
   - `error`: `role="alert"` (anúncio assertivo — correto pra erro),
     `bg-error-container`/`text-on-error-container` (mesmo par de
     token já usado no banner de erro do `/login`).
   - `success`: `role="status"` (anúncio "polite", não "assertivo" —
     tecnicamente correto pra confirmação não-urgente, `alert` seria
     over-claim de urgência). Reutiliza os tokens
     `secondary-container`/`on-secondary-container` como representação
     visual de sucesso, já que ainda não existe um token semântico
     dedicado de "success" nesta paleta.
   - **Retrofit do `/login`:** o banner de erro inline que já existe lá
     (`<p role="alert" className="rounded bg-error-container px-4 py-3
     text-body-md text-on-error-container">`) passa a usar
     `<Message variant="error">`. Marcação resultante é idêntica —
     mesmo `role`, mesmas classes — os 7 testes já travados de
     `page.test.tsx` continuam passando sem modificação (é troca de
     JSX por JSX que produz o mesmo DOM).

3. **Wordmark do painel institucional diferenciado por identidade:**
   `/redefinir-senha` mostra "Sistema Campanha" (mesma identidade do
   `/login`, é fluxo de campanha); `/superadmin/login` mostra "Painel
   Superadmin" (identidade separada, sem vínculo a nenhuma campanha
   específica — mesma separação de identidade já estabelecida desde o
   S7).

4. **Headings são escolhidos de forma a não duplicar o texto de labels
   ou botões**, preservando consultas inequívocas nos testes (`getByText`
   busca por conteúdo textual, não por tipo de elemento) e melhorando a
   semântica da própria página (um heading que repete o texto de um
   controle interativo não acrescenta informação):
   - `/superadmin/login`: heading "Acesso restrito" (distinto do botão
     "Entrar" e dos labels "E-mail"/"Senha").
   - `/redefinir-senha`: heading "Redefinir senha" — **não** "Nova
     senha": o campo (`Input`) usa exatamente esse texto como `label`
     (herdado do `placeholder` original), então um heading com o mesmo
     texto duplicaria o label. Botão continua "Salvar", distinto de
     ambos.

## Padrão visual

As duas páginas seguem exatamente o padrão visual estabelecido em
`/login`:
- layout split-screen (painel institucional + painel de formulário);
- componentes `Input` e `Button`;
- wordmark institucional no painel esquerdo;
- spacing, tipografia e tokens de cor idênticos.

As únicas diferenças são a identidade textual do wordmark (decisão 3
acima) e o comportamento específico de cada fluxo (decisão 1 acima).
O restante desta spec assume esse padrão como referência canônica e
só descreve os desvios.

## Arquitetura

**`Message.tsx`:**
```tsx
interface MessageProps {
  variant: 'error' | 'success';
  children: React.ReactNode;
}
```
Componente puro, sem estado. A única responsabilidade do componente é
mapear `variant` pra semântica (`role`) e tokens visuais — nada mais.
Sem prop de `role` separada — só 2 variantes existem no produto hoje,
expor `role` como prop independente seria abstração sem uso real
(YAGNI).

**`/superadmin/login`:** adiciona `const [enviando, setEnviando] =
useState(false)`; `entrar()` chama `setEnviando(true)` antes do
`fetch`, `setEnviando(false)` nos caminhos de erro (replica
exatamente o padrão já usado em `/login`, incluindo o comentário sobre
o caminho de sucesso ficar desabilitado porque a página já está
navegando). `Button` recebe `disabled={enviando}` mas **mantém o texto
"Entrar"** durante o envio (não vira "Entrando..." nem qualquer outra
variação) — mesmo padrão exato do `/login`, cujo texto de botão também
não muda durante `enviando`. Erro vira `<Message variant="error">`.

**`/redefinir-senha`:** troca o `<p>{msg}</p>` genérico por um
discriminador de resultado — em vez de um `msg: string` solto, o
estado passa a guardar `{ tipo: 'sucesso' | 'erro'; texto: string } |
null`, e a renderização escolhe `<Message variant={resultado.tipo ===
'sucesso' ? 'success' : 'error'}>`. Antes de iniciar um novo submit,
`resultado` é resetado pra `null` (mesmo primeiro passo de `entrar()`
no `/login` e no `/superadmin/login` desta fatia) — evita que a
mensagem de uma tentativa anterior (sucesso ou erro) continue visível
durante uma nova tentativa em andamento. Campo de senha vira `Input`
(`label="Nova senha"`, `type="password"`, `autoComplete="new-password"`
— habilita o gerenciador de senhas do navegador a sugerir/preencher
corretamente; **não** ganha `required`, que mudaria o comportamento de
submissão do form — o campo vazio hoje é validado apenas no backend,
manter assim). Botão vira `Button` (`type="submit"`, sem `disabled` —
não ganha loading state nesta fatia, ver decisão 1).

## Testes

- `web/app/superadmin/login/page.test.tsx` (2 casos existentes) — não
  modificado, continua passando sem alteração (heading novo não
  colide, `Message` produz o mesmo `role="alert"` que o `<p>` inline
  anterior). Teste novo (3º caso): botão fica `disabled` durante o
  request e reabilita após erro — mesmo formato do teste equivalente
  já existente em `web/app/login/page.test.tsx`.
- `web/app/redefinir-senha/page.test.tsx` (novo arquivo, não existe
  hoje): cobre (1) submit chama `supabase.auth.updateUser` com a senha
  digitada, (2) sucesso mostra `role="status"` com o texto certo, (3)
  erro mostra `role="alert"` com o texto certo. Mocka
  `createBrowserClient`/`updateUser` (mesmo tipo de mock usado nos
  testes de auth existentes do projeto).
- `web/app/components/Message.test.tsx` (novo): variante `error` tem
  `role="alert"` e aplica `bg-error-container`/`text-on-error-container`;
  variante `success` tem `role="status"` e aplica
  `bg-secondary-container`/`text-on-secondary-container`; children
  renderiza o conteúdo passado. Os testes de classe existem porque
  mapear `variant` pro par certo de token é a única responsabilidade
  do componente — sem esse teste, um retrofit futuro poderia trocar os
  tokens sem que nada acuse.
- `web/app/login/page.test.tsx` (7 casos existentes) — não modificado,
  continua passando sem alteração após o retrofit pra `Message`.

## Não-objetivos desta fatia

- Loading/disabled state em `/redefinir-senha` — não é uma das 3
  lacunas combinadas.
- Restilizar `/dashboard`, `/mapa-calor`, `/superadmin/dashboard` —
  fatias futuras (C, D).
- Mudar a lógica de autenticação/API de qualquer uma das duas rotas
  (`/api/superadmin/login` continua igual; `redefinir-senha` continua
  chamando `supabase.auth.updateUser` direto do client, sem rota
  própria — não é objetivo desta fatia questionar essa escolha).
- Token semântico dedicado de "success" na paleta — reaproveita
  `secondary`/`secondary-container` como está, sem pedir ajuste de
  paleta ao Figma.
- Validação de força de senha ou campo de confirmação de senha em
  `/redefinir-senha` — expectativa comum nesse tipo de tela, mas não
  faz parte do escopo combinado (só restilizar + as 3 lacunas
  específicas listadas na decisão 1); mudaria a lógica de validação,
  não só a apresentação.
