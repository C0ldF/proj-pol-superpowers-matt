# Logout de campanha + redirect pro /login

Data: 2026-07-06
Depende de S1 (`ssrClient`, sessão de login), da página `/login` (2026-07-06,
integrada em `a18bdc0`) e do `NavShell`/`/dashboard`/`/mapa-calor` (S4/S5).
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
   signOut()`), mas o projeto já mantém `/api/auth/*` (usuário de campanha,
   desde S1) e `/api/superadmin/*` (identidade separada, S7) como
   namespaces distintos — misturar os dois criaria acoplamento conceitual
   entre identidades que o resto do projeto trata como não relacionadas
   (ADR 0004, escada de papéis). `web/app/api/superadmin/logout/route.ts`
   (S7) é a referência estrutural exata, só troca de path.
3. **Sem checagem de autorização na rota de logout.** Igual à decisão já
   tomada pro logout do Superadmin (S7): sair deve funcionar mesmo com
   sessão de campanha estranha/expirada/já inválida — a pessoa ainda quer
   conseguir sair. `POST /api/auth/logout` sempre chama `signOut()` e
   sempre retorna `200 {ok:true}`, sem gate nenhum antes.
4. **Botão "Sair" dentro do `NavShell`.** Único component compartilhado por
   `/dashboard` e `/mapa-calor` — um botão só cobre as duas telas. Verificado
   contra `web/node_modules/next/dist/docs/01-app/01-getting-started/
   05-server-and-client-components.md:176` ("Once a file is marked with
   'use client', all of its imports and the components it directly renders
   are included in the client bundle... you don't need to add the
   directive to every component") e contra o código atual —
   `web/app/components/NavShell.tsx` hoje não tem `'use client'`, e é
   importado e renderizado diretamente só por `DashboardClient`/
   `MapaCalorClient` (ambos `'use client'`). Não há necessidade de criar um
   wrapper novo nem de marcar `NavShell` com `'use client'` própria, só pra
   este botão — mas isso é uma propriedade do código atual, não uma decisão
   arquitetural; se algum dia `NavShell` passar a ser importado também por
   um Server Component direto (fora da árvore client), essa premissa cai e
   precisa ser reavaliada.
5. **Logout: redireciona sempre, mesmo se o `fetch` falhar.** Diferente da
   página `/login` (que trata erro de rede como melhoria deliberada sobre o
   precedente, mostrando mensagem pro usuário), aqui não há formulário nem
   estado de erro — clicar em "Sair" deve levar pro `/login` de qualquer
   jeito (offline, timeout, o que for), porque ficar preso na tela
   autenticada é pior do que a incerteza sobre se a sessão foi de fato
   limpa no servidor. Se a sessão foi removida, o próximo request cai no
   redirect da decisão 6 normalmente; se não foi (o `fetch` falhou antes de
   chegar no servidor), o usuário simplesmente vê a tela de login e pode
   tentar sair de novo mais tarde — não há garantia de que o logout
   realmente aconteceu, só de que a navegação não fica travada esperando
   por ele. Implementação:
   `await fetch(...).catch(() => {})` antes do `window.location.href` —
   o `.catch` vazio garante que uma rejeição da Promise não impede a
   navegação. O botão "Sair" do Superadmin (S7) tem exatamente essa mesma
   lacuna (`await fetch(...)` seguido de `window.location.href` sem
   `.catch`) — não é corrigido aqui (fora de escopo desta fatia, que só
   toca `NavShell`/`/dashboard`/`/mapa-calor`), mas o `.catch()` desta
   fatia evita repetir o mesmo defeito no código novo.
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
   mock precisa lançar de propósito, reproduzindo o comportamento real do
   `redirect()` no Next.js; o teste afirma que a chamada da página rejeita
   E que `redirect` foi chamado com `'/login'`.

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
  1. await fetch('/api/auth/logout', {method: 'POST'}).catch(() => {})
  2. window.location.href = '/login'
```

`window.location.href`, não `router.push('/login')`: depois do logout
precisamos de uma navegação completa (novo request ao servidor), não uma
troca client-side de rota — o objetivo é que o próximo carregamento de
página já veja a sessão removida.

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
3. O teste cobre apenas o disparo do `fetch()`. A navegação via
   `window.location.href` não é asserida — limitação conhecida do ambiente
   de testes (`jsdom` não navega de verdade), mesmo precedente já aceito
   nas páginas de login (`/superadmin/login`, S7, e `/login` de campanha,
   fatia própria).

### Redirect

4. `/dashboard` sem usuário autenticado: `redirect('/login')` é chamado
   (teste mocka `next/navigation`'s `redirect` pra lançar, afirma que a
   chamada da página rejeita, e que `redirect` foi chamado com `'/login'`)
   — `DashboardClient` não deve aparecer no resultado.
5. `/dashboard` com usuário autenticado: renderiza `DashboardClient`
   normalmente, `redirect` não é chamado.
6. Os mesmos dois testes (4-5) pra `/mapa-calor`/`MapaCalorClient`.
