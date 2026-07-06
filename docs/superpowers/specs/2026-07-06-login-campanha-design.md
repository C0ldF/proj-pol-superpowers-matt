# Login de campanha (página)

Data: 2026-07-06
Depende de S1 (`POST /api/auth/login`, `loginCampanha`, `web/lib/auth/login.ts`).
Não está no roadmap original — motivada por um gap real: o S1 (2026-06-29)
construiu o endpoint de login de campanha mas nenhuma página o consome. O
único front-end de auth existente hoje é `/redefinir-senha` e o painel
Superadmin (S7, `/superadmin/login`) — que é uma identidade separada, fora de
qualquer campanha.

## Objetivo

Uma página `/login` que consome `POST /api/auth/login` (já existente, S1) e
permite que um usuário de campanha (gestor/líder/apoiador — `papel_login`)
efetue login de verdade pela primeira vez via UI, não só via `curl`/teste.

## Decisões desta fatia

1. **Fatia mínima: só a página, nada ao redor dela.** Sem logout (não existe
   `POST /api/auth/logout` pra usuário de campanha — débito separado, fora
   de escopo aqui), sem mudar o comportamento sem-redirect de `/dashboard`
   e `/mapa-calor` (que hoje mostram texto inline "não autenticado" — decisão
   explícita do S4, mantida). Decisão do usuário: fechar só o buraco mais
   gritante (não dá pra logar de jeito nenhum pela UI hoje) sem inflar o
   escopo com peças que ainda não têm um consumidor real.
2. **Mesmo padrão estrutural da página `/superadmin/login`** (S7, Task 6):
   client component, form simples, `fetch` POST, erro mostrado via
   `role="alert"`, redirect via `window.location.href` em caso de sucesso.
   Sem inventar um padrão novo pra uma página de login quando já existe um
   testado e aprovado no próprio repo.
3. **Um campo só pro identificador — "CPF ou e-mail".** O backend
   (`loginCampanha`, `web/lib/auth/login.ts:19`) já aceita os dois formatos
   (`ehEmail(s) = s.includes('@')`) e já valida/normaliza CPF
   server-side. A página não replica essa lógica no cliente — sem máscara de
   CPF, sem validação client-side de formato. Um único input de texto livre.
4. **Mensagem de erro: repassa o texto do servidor, sem lógica própria.** O
   backend já unifica toda falha (CPF inválido, CPF não encontrado, senha
   errada, sessão teria conflito de subdomínio) na mesma mensagem genérica
   `"CPF/e-mail ou senha inválidos"` (`route.ts:5`) — a página só exibe
   `body.erro` como veio, sem tentar diferenciar motivos.
5. **Subdomínio: nada a fazer na página.** `web/middleware.ts` já injeta o
   header `x-campanha-subdominio` a partir do `Host` da requisição antes de
   qualquer rota rodar — a página não precisa saber em qual campanha está,
   só faz o `POST` normal e o middleware resolve o resto.
6. **Redirect de sucesso: `/dashboard`.** Entre as duas telas autenticadas
   existentes (`/dashboard`, `/mapa-calor`), o dashboard é o ponto de entrada
   mais informativo (ranking + evolução + alertas de uma vez). `/mapa-calor`
   continua acessível dali via `NavShell`.
7. **Sem estilo — mesmo nível de acabamento do resto do app hoje.**
   `/mapa-calor`, `/dashboard`, `/superadmin/*` são todos HTML puro sem CSS;
   estilizar só esta página destoaria do restante até uma fatia de design
   visual futura decidir isso pro app inteiro.

## Não-objetivos

- `POST /api/auth/logout` pro usuário de campanha (não existe hoje) — débito
  separado.
- Redirect automático em `/dashboard`/`/mapa-calor` quando não autenticado —
  continuam com o texto inline "não autenticado" (decisão já tomada no S4).
- Máscara/validação de CPF no cliente — já é feita no servidor.
- Qualquer estilo/CSS — decisão 7 acima.
- "Lembrar de mim" / sessão persistente diferenciada — fora de escopo, não
  pedido.

## Camada Next.js

`web/app/login/page.tsx` — client component:

```
POST /api/auth/login  body: {identificador, senha}
  200 {ok:true}  → window.location.href = '/dashboard'
  != 200 {erro}  → mostra body.erro em <p role="alert">
```

Estrutura idêntica à de `web/app/superadmin/login/page.tsx` (S7): dois
inputs controlados (`identificador`, `senha`), um `<form onSubmit>`, estado
`erro` resetado a cada tentativa.

## Testes (critério de pronto)

1. Preencher `identificador`+`senha` e submeter dispara
   `fetch('/api/auth/login', {method:'POST', headers:{'content-type':
   'application/json'}, body: JSON.stringify({identificador, senha})})`.
2. Resposta de erro (`!res.ok`) mostra `body.erro` num elemento
   `role="alert"`.
3. Resposta de sucesso (`200 {ok:true}`) — redirect não é asserido no teste
   (mesma limitação de `jsdom` já aceita no teste da página Superadmin,
   S7 Task 6) — a asserção do `fetch` com o corpo certo já cobre a lógica
   desta página.
