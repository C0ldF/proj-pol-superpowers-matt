# Login de campanha (página)

Data: 2026-07-06
Depende de S1 (`POST /api/auth/login`, `loginCampanha`, `web/lib/auth/login.ts`).
Não está no roadmap original — motivada por um gap real: o S1 (2026-06-29)
construiu o endpoint de login de campanha mas nenhuma página o consome. O
único front-end de auth existente hoje é `/redefinir-senha` e o painel
Superadmin (S7, `/superadmin/login`) — que é uma identidade separada, fora de
qualquer campanha.

## Objetivo

Uma página `/login` que autentica usuários de campanha (gestor/líder/
apoiador — `papel_login`) utilizando o endpoint já existente
`POST /api/auth/login` (S1).

## Decisões desta fatia

1. **Fatia mínima: só a página, nada ao redor dela.** Sem logout (não existe
   `POST /api/auth/logout` pra usuário de campanha — débito separado, fora
   de escopo aqui). A existência da página de login não altera o fluxo
   atual das páginas protegidas: `/dashboard` e `/mapa-calor` continuam
   exibindo o estado "não autenticado" inline em vez de redirecionar — isso
   é proposital, decisão já tomada no S4, não revisitada aqui. Decisão do
   usuário: fechar só o buraco mais gritante (não dá pra logar de jeito
   nenhum pela UI hoje) sem inflar o escopo com peças que ainda não têm um
   consumidor real.
2. **Mesmo padrão estrutural da página `/superadmin/login`** (S7, Task 6):
   client component, form simples, `fetch` POST, erro mostrado via
   `role="alert"`, redirect via `window.location.href` em caso de sucesso —
   mantém o mesmo mecanismo de navegação já usado no login Superadmin, sem
   introduzir um padrão novo (ex.: `router.push`) só nesta tela.
3. **Um campo só pro identificador — "CPF ou e-mail".** O backend
   (`loginCampanha`, `web/lib/auth/login.ts:19`) já aceita os dois formatos
   (`ehEmail(s) = s.includes('@')`) e já valida/normaliza CPF
   server-side. A página não replica essa lógica no cliente — sem máscara de
   CPF, sem validação client-side de formato. Um único input de texto livre.
4. **Mensagem de erro.** Quando a resposta possuir `body.erro`, a página
   exibe exatamente esse texto, sem diferenciação própria — o backend já
   unifica toda falha esperada (CPF inválido, CPF não encontrado, senha
   errada, sessão com conflito de subdomínio) na mesma mensagem genérica
   `"CPF/e-mail ou senha inválidos"` (`route.ts:5`). Para respostas sem
   `body.erro`, usa o mesmo fallback do login Superadmin
   (`web/app/superadmin/login/page.tsx:19`, `'Não foi possível entrar.'`).
5. **Erros de rede e parse.** Diferentemente do login Superadmin (que
   deixaria uma exceção subir sem UI de erro), esta página envolve o
   `fetch` em `try/catch`, reutilizando o mesmo fallback genérico caso a
   requisição falhe antes de produzir uma resposta HTTP.
6. **Subdomínio: nada a fazer na página.** `web/middleware.ts` já injeta o
   header `x-campanha-subdominio` a partir do `Host` da requisição antes de
   qualquer rota rodar — portanto a página nunca recebe nem envia
   explicitamente o subdomínio; só faz o `POST` normal e o middleware
   resolve o resto.
7. **Redirect de sucesso: `/dashboard`.** Entre as duas telas autenticadas
   existentes (`/dashboard`, `/mapa-calor`), o dashboard é o ponto de entrada
   mais informativo (ranking + evolução + alertas de uma vez). `/mapa-calor`
   continua acessível dali via `NavShell`.
8. **Sem estilo — mesmo nível de acabamento do resto do app hoje.**
   `/mapa-calor`, `/dashboard`, `/superadmin/*` são todos HTML puro sem CSS;
   estilizar só esta página destoaria do restante até uma fatia de design
   visual futura decidir isso pro app inteiro.
9. **Botão desabilitado durante a requisição.** Melhoria mínima de UX, sem
   custo de escopo: entre o submit e a resposta, o botão de entrar fica
   desabilitado (evita duplo-submit por clique repetido), mesmo sem
   nenhum outro elemento de estilo na página.

## Não-objetivos

- `POST /api/auth/logout` pro usuário de campanha (não existe hoje) — débito
  separado.
- Redirect automático em `/dashboard`/`/mapa-calor` quando não autenticado —
  continuam com o texto inline "não autenticado" (decisão já tomada no S4).
- Máscara/validação de CPF no cliente — já é feita no servidor.
- Qualquer estilo/CSS — decisão 8 acima.
- "Lembrar de mim" / sessão persistente diferenciada — fora de escopo, não
  pedido.

## Dependências

- `POST /api/auth/login` (`web/app/api/auth/login/route.ts`, S1)
- `loginCampanha()` (`web/lib/auth/login.ts`, S1)
- O endpoint já estabelece a sessão (cookie HTTP) via Supabase Auth; a
  página apenas dispara a requisição e não manipula cookies diretamente.
- `web/middleware.ts` (injeta `x-campanha-subdominio` a partir do `Host`).

## Camada Next.js

`web/app/login/page.tsx` — client component:

```
submit
 ↓
desabilita botão
 ↓
POST /api/auth/login  body: {identificador, senha}
 ├─ sucesso → navega para /dashboard
 └─ erro     → mostra mensagem (role="alert") e reabilita botão
```

Estrutura idêntica à de `web/app/superadmin/login/page.tsx` (S7): dois
inputs controlados (`identificador`, `senha`), um `<form onSubmit>`, estado
`erro` resetado no início de cada nova tentativa (antes do `fetch`, não
depois — assim uma mensagem de erro anterior nunca fica visível durante uma
nova tentativa em andamento).

## Testes (critério de pronto)

1. Preencher `identificador`+`senha` e submeter dispara
   `fetch('/api/auth/login', {method:'POST', headers:{'content-type':
   'application/json'}, body: JSON.stringify({identificador, senha})})`.
2. Resposta de erro (`!res.ok`) mostra `body.erro` num elemento
   `role="alert"`.
3. Resposta de sucesso (`200 {ok:true}`): o teste valida apenas que a
   página executa o fluxo de sucesso (mesmo critério já usado no teste da
   página Superadmin, S7 Task 6) — o redirecionamento em si não é
   verificável em `jsdom`, então a asserção do `fetch` com o corpo certo já
   cobre a lógica desta página.
4. Uma nova submissão limpa a mensagem de erro de uma tentativa anterior
   antes da conclusão da nova requisição (não só depois dela).
5. Botão fica desabilitado entre o submit e a resposta (erro ou sucesso) e
   reabilita no caminho de erro.
