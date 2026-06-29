# Login por CPF traduzido para e-mail sobre o Supabase Auth

O Supabase Auth autentica por **e-mail/telefone**, não por CPF. Para atender ao
requisito de login por CPF:

- O formulário aceita **CPF ou e-mail** + senha. Quando vem CPF, uma função no
  **servidor** traduz CPF → e-mail e chama `signInWithPassword(email, senha)`.
- **E-mail é obrigatório** para todo papel com login (Gestor, Coordenador,
  Liderança) — é a identidade real no Supabase e o canal de recuperação
  (`resetPasswordForEmail`).
- **Papel e campanha** são injetados no JWT via *Custom Access Token Hook*, para
  o RLS confiar no token sem consulta extra. Liga o login (ADR 0008) ao
  isolamento (ADR 0001).

## Blindagem

Rate limiting por IP e por CPF/e-mail; CAPTCHA após N falhas; bloqueio temporário.
A tradução CPF→e-mail roda só no servidor com **erro genérico** ("CPF/e-mail ou
senha inválidos") para não virar oráculo de enumeração de CPFs. SQL injection
eliminado por construção (queries parametrizadas + RLS).

## Decisões

- **Sem 2FA** por ora (decisão do produto), apesar do volume de PII sob LGPD.
- Validação de CPF e de título de eleitor (dígitos verificadores) no cliente e no
  servidor.

## Alcance do login (decisão A)

Um login pertence a **uma única Campanha**; só o Superadmin é global. O login é
**preso ao subdomínio**: o middleware recusa o acesso se o subdomínio não bater
com a `campanha_id` do token. O mesmo humano operando duas campanhas tem dois
acessos distintos, cada um no seu subdomínio — desejável por sigilo entre
candidatos rivais.

## Consequences

- Todo usuário com login tem e-mail único no Supabase (`auth.users`).
- O mapa CPF→e-mail precisa de índice/coluna protegida e acesso só por função
  server-side.
