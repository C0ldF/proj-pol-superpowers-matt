# Logout de campanha + redirect pro /login

Data: 2026-07-06
Depende de S1 (`ssrClient`, sessão de login), da página `/login` (2026-07-06,
merjada em `a18bdc0`) e do `NavShell`/`/dashboard`/`/mapa-calor` (S4/S5).
Não está no roadmap original — fecha um gap que a própria página `/login`
abriu: hoje o usuário de campanha consegue entrar mas não tem como sair pela
UI, e `/dashboard`/`/mapa-calor` ainda mostram um texto morto ("não
autenticado") em vez de mandar pro login agora que ele existe.

## Objetivo

Duas peças pequenas e independentes:
1. Logout de campanha: `POST /api/auth/logout` + botão "Sair" no `NavShell`.
2. Redirect: `/dashboard` e `/mapa-calor` mandam pro `/login` quando não
   autenticado, em vez de mostrar texto inline.

## Decisões desta fatia

1. **Duas peças, duas tasks, sem arquivo em comum.** Logout mexe em
   `web/app/api/auth/logout/route.ts` (novo) e `web/app/components/NavShell.tsx`
   (existente). Redirect mexe em `web/app/dashboard/page.tsx` e
   `web/app/mapa-calor/page.tsx` (existentes) + seus testes. Zero overlap —
   dá pra construir e revisar cada uma isoladamente.
2. **Rota de logout nova, não reaproveita `/api/superadmin/logout`.** As
   duas fariam a mesma coisa tecnicamente (`ssrClient(cookies()).auth.
   signOut()`), mas o projeto já mantém `/api/auth/*` (identidade de
   campanha, desde S1) e `/api/superadmin/*` (identidade separada, S7) como
   namespaces distintos — misturar os dois criaria acoplamento conceitual
   entre identidades que o resto do projeto trata como não relacionadas
   (ADR 0004, escada de papéis). `web/app/api/superadmin/logout/route.ts`
   (S7) é a referência estrutural exata, só troca de path.
3. **Sem checagem de autorização na rota de logout.** Igual à decisão já
   tomada pro logout do Superadmin: sair deve funcionar mesmo com sessão
   estranha/expirada/já inválida — a pessoa ainda quer conseguir sair.
   `POST /api/auth/logout` sempre chama `signOut()` e sempre retorna
   `200 {ok:true}`, sem gate nenhum antes.
4. **Botão "Sair" dentro do `NavShell`.** Único component compartilhado por
   `/dashboard` e `/mapa-calor` — um botão só cobre as duas telas. `NavShell`
   não precisa da diretiva `'use client'` própria: ele já é consumido
   exclusivamente por `DashboardClient`/`MapaCalorClient`, que são `'use
   client'` — qualquer código importado por um client component já roda no
   bundle do cliente, então o `onClick` funciona sem marcar o arquivo.
5. **Logout: `fetch` direto, sem `try/catch`.** Diferente da página `/login`
   (que tratou erro de rede como melhoria deliberada sobre o precedente),
   aqui não há formulário nem estado de erro pro usuário ver — clicar em
   "Sair" e a requisição falhar silenciosamente (ex.: offline) não é pior do
   que continuar em uma tela que já vai redirecionar de qualquer forma no
   próximo request sem sessão válida. Mesmo nível de tratamento do botão
   "Sair" do Superadmin (S7): sem tratamento de erro de rede.
6. **Redirect via `redirect()` de `next/navigation`, não texto inline.**
   `web/app/dashboard/page.tsx` e `web/app/mapa-calor/page.tsx` trocam
   `if (!user) return <p>não autenticado</p>;` por
   `if (!user) redirect('/login');`. Mecanismo padrão do Next pra esse caso
   (server component decidindo navegação antes de renderizar).
7. **Sem preservar destino (`?next=...`).** Login sempre redireciona pro
   `/dashboard` de qualquer forma (decisão já tomada na fatia do `/login`) —
   guardar de onde o usuário veio não muda o destino final, então não serve
   pra nada ainda. Se um dia o login passar a respeitar destino, essa
   decisão é revisitada junto.
8. **Gotcha de teste documentado explicitamente.** `redirect()` funciona
   lançando uma exceção internamente (é assim que o Next interrompe a
   renderização do componente). Um mock ingênuo de `next/navigation` que só
   registra a chamada sem lançar deixaria o código cair pro `return
   <DashboardClient />` de qualquer forma, e o teste passaria mesmo com a
   `DashboardClient`/`MapaCalorClient` renderizando por baixo do radar. O
   mock precisa lançar de propósito; o teste afirma que a chamada da página
   rejeita E que `redirect` foi chamado com `'/login'`.

## Não-objetivos

- Preservar página de destino (`?next=`) — decisão 7.
- Botão de logout em `/superadmin/*` — já existe (S7), não mexe.
- Qualquer redirect automático em outras páginas além de `/dashboard` e
  `/mapa-calor` (não existem outras páginas autenticadas de campanha hoje).
- Estilo/CSS no botão "Sair" — mesmo nível de acabamento do resto do
  `NavShell` e do app hoje.
- Invalidar/registrar o evento de logout em `audit_log` — fora de escopo,
  ninguém pediu.

## Camada Next.js

### Logout

`web/app/api/auth/logout/route.ts` — idêntica em estrutura a
`web/app/api/superadmin/logout/route.ts` (S7):

```
POST /api/auth/logout
  1. ssrClient(cookies()).auth.signOut()
  2. retorna 200 {ok: true}
```

`web/app/components/NavShell.tsx` ganha um botão:

```
onClick "Sair":
  1. fetch('/api/auth/logout', {method: 'POST'})
  2. window.location.href = '/login'
```

Sem aguardar o `fetch` resolver antes do redirect seria incorreto (o cookie
precisa ser limpo antes da navegação) — o `fetch` é aguardado (`await`)
dentro de uma função assíncrona antes do `window.location.href`.

### Redirect

`web/app/dashboard/page.tsx` e `web/app/mapa-calor/page.tsx`, mesma mudança
nas duas:

```
import { redirect } from 'next/navigation';
...
if (!user) {
  redirect('/login');
}
return <DashboardClient />; // ou <MapaCalorClient />
```

## Testes (critério de pronto)

### Logout

1. `POST /api/auth/logout` chama `signOut()` e retorna `200 {ok:true}`,
   mesmo sem sessão ativa (mesmo teste já existente pro logout do
   Superadmin, adaptado pro path novo).
2. Clicar em "Sair" no `NavShell` dispara `fetch('/api/auth/logout',
   {method: 'POST'})`.
3. (Redirect pós-logout não é asserido no teste — mesma limitação de
   `jsdom` já aceita nas páginas de login, S7/2026-07-06 — a asserção do
   `fetch` já cobre a lógica do botão.)

### Redirect

4. `/dashboard` sem usuário autenticado: `redirect('/login')` é chamado
   (teste mocka `next/navigation`'s `redirect` pra lançar, afirma que a
   chamada da página rejeita, e que `redirect` foi chamado com `'/login'`)
   — `DashboardClient` não deve aparecer no resultado.
5. `/dashboard` com usuário autenticado: renderiza `DashboardClient`
   normalmente, `redirect` não é chamado.
6. Os mesmos dois testes (4-5) pra `/mapa-calor`/`MapaCalorClient`.
