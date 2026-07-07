# Throttle/lockout de login de campanha

Data: 2026-07-07
Depende de S1 (`loginCampanha`, `web/lib/auth/login.ts`;
`registrar_evento_auth`, migration `0009`; `audit_log`, migration `0004`).
Não está no roadmap original — primeiro item do débito de "hardening de
login" acumulado desde o S1 (captcha/throttle/2FA nunca implementados).

## Objetivo

Bloquear tentativas repetidas de login de campanha (mesmo identificador,
mesma campanha) depois de várias falhas seguidas numa janela de tempo —
mitiga brute-force sem exigir serviço externo (captcha) nem fluxo de
enrollment (2FA), que ficam para fatias futuras.

## Escopo desta fatia

Só login de **campanha** (`loginCampanha`). Login do **Superadmin** fica de
fora — `audit_log` (migration `0004`) tem `campanha_id uuid NOT NULL`, e o
login do Superadmin é deliberadamente "fora de qualquer campanha" (ADR
0004) — hoje ele não grava nenhum evento de auditoria (não usa
`registrar_evento_auth` nem nada equivalente). Adicionar throttle lá exige
uma tabela de auditoria nova (sem a constraint de campanha), que é uma
melhoria maior, fora desta fatia — ver Não-objetivos.

## Decisões desta fatia

1. **Reaproveita o `audit_log` existente — nenhuma tabela nova.**
   `registrar_evento_auth` (migration `0009`) já grava toda tentativa de
   login de campanha (sucesso e falha) desde o S1. A contagem de falhas
   recentes é uma consulta contra esse mesmo log, não um contador
   mantido à parte — evita duas fontes de verdade (log de auditoria vs.
   contador de rate-limit) e elimina a necessidade de "resetar" o contador
   no sucesso: falhas antigas simplesmente saem da janela de tempo sozinhas.
2. **Chave do bloqueio: identificador normalizado + `campanha_id`, nunca
   IP.** Mesmo CPF/e-mail em campanhas diferentes são contas diferentes —
   a chave inclui `campanha_id`. Bloquear por IP puniria todo mundo atrás
   do mesmo IP (ex.: sede da campanha, rede corporativa) por um usuário
   que errou a senha. Para CPF, a chave é o mesmo índice cego HMAC já usado
   por `resolverEmailPorCpf` (`web/lib/cpf-hmac.ts`, ADR 0010) — nunca CPF
   cru gravado no `audit_log`. Para e-mail, a chave é o e-mail já
   normalizado (`trim().toLowerCase()`, mesma normalização que
   `loginCampanha` já faz hoje pro caminho de e-mail direto).
3. **Limiar: 5 falhas em 15 minutos.** Padrão comum de mercado — poucas
   falhas legítimas (usuário errou a senha 2-3 vezes) nunca disparam;
   automação de brute-force esbarra rápido. Como é janela deslizante
   (decisão 1), "bloqueia por 15 minutos" não é matematicamente exato — o
   comportamento real é: a conta permanece bloqueada **enquanto existirem
   pelo menos `LIMITE_FALHAS` registros de `login.falha` dentro da janela
   deslizante** pra aquela chave/campanha. Se as 5 falhas aconteceram
   espaçadas (ex.: `12:00`, `12:01`, `12:02`, `12:03`, `12:14`), o
   desbloqueio não acontece exatamente 15 minutos depois da 5ª falha — vai
   depender de quando cada falha individual sai da janela. Na prática,
   pra falhas concentradas num curto intervalo (o caso comum de
   brute-force automatizado), a diferença é irrelevante.
4. **Checagem acontece antes de qualquer resolução de CPF ou chamada ao
   Supabase Auth.** A chave do identificador é calculada logo no início de
   `loginCampanha`, e a contagem de falhas é a primeira coisa checada —
   antes de `resolverEmailPorCpf`/`signIn`. Minimiza o custo de uma
   tentativa já sabidamente bloqueada (nenhuma chamada extra ao banco além
   da própria contagem, nenhuma chamada ao Supabase Auth).
5. **Mensagem de erro: igual à de sempre, nunca revela que foi
   bloqueio.** Mesma mensagem genérica `"CPF/e-mail ou senha inválidos"` —
   consistente com o padrão já estabelecido desde o S1 (nunca diferenciar
   motivo de falha na resposta). Um usuário legítimo bloqueado só vê "senha
   errada" — ligeiramente confuso, mas consistente com a política de nunca
   dar pista sobre o motivo real pro cliente.
6. **Tentativa rejeitada por bloqueio ativo é logada sob uma `acao`
   distinta (`'login.bloqueado'`), nunca `'login.falha'` — e nunca conta
   pra métrica de falhas.** Esse é o detalhe mais importante da fatia: se
   uma tentativa bloqueada contasse como mais uma falha, um atacante
   conseguiria manter uma conta legítima bloqueada indefinidamente só
   continuando a tentar durante a janela de bloqueio dela mesma — um
   vetor de negação de serviço contra o próprio usuário que o throttle
   deveria proteger. A consulta de contagem (decisão 7) olha só
   `acao = 'login.falha'`; `'login.bloqueado'` fica de fora por
   construção, sem precisar filtrar por `motivo`. `'login.bloqueado'`
   ainda é gravado (visibilidade/monitoramento de quem está sob
   brute-force ativo), só não afeta a contagem.
7. **Nova função Postgres `contar_falhas_login_recentes`, `SECURITY
   DEFINER`, só `service_role`.** Mesma razão do `registrar_evento_auth`
   (S1): a checagem acontece ANTES de existir qualquer sessão/JWT (é
   literalmente o que decide se o login pode prosseguir), então não há
   `auth.uid()`/claim de `authenticated` pra uma policy de RLS usar — teria
   que ser `SECURITY DEFINER` de qualquer forma. Mesmo padrão de
   grants (`REVOKE ALL FROM authenticated, anon, public` +
   `GRANT EXECUTE TO service_role`).
8. **`LIMITE_FALHAS`/`JANELA_MINUTOS` como constantes exportadas em
   `web/lib/auth/login.ts`**, não hardcoded inline — mesmo padrão de
   `MODULOS`/`CARGOS` (constantes nomeadas, não números soltos), e permite
   um teste futuro ajustar/inspecionar o valor sem duplicar o literal.
9. **Corrida entre contagem e registro é aceita, não corrigida.** O fluxo é
   `contar → decidir → (tentar login) → registrar falha`, sem transação
   nem lock cobrindo as duas pontas — duas requisições concorrentes podem
   ambas ler a contagem `4` (abaixo do limiar) e ambas prosseguir,
   resultando em mais de `LIMITE_FALHAS` falhas registradas antes de
   qualquer uma delas ver o bloqueio. Isso é aceito deliberadamente: o
   objetivo é mitigar brute-force (reduzir a taxa de tentativas possíveis
   a um patamar impraticável), não contabilidade exata. Login de campanha
   não é um fluxo de alta concorrência por identificador (é uma pessoa
   tentando entrar, não um sistema disparando requisições paralelas
   legítimas) — uma pequena ultrapassagem ocasional sob concorrência não
   compromete o objetivo. Não introduzir lock/`SERIALIZABLE` pra fechar
   essa corrida — custo de complexidade desproporcional ao ganho.
10. **Índice composto na migration, não deixado pra depois.** A consulta de
    `contar_falhas_login_recentes` filtra por `campanha_id` + `acao` +
    `identificador_chave` (dentro do jsonb) + intervalo de `criado_em` — sem
    índice, vira scan sequencial do `audit_log` inteiro a cada tentativa de
    login, e esse log só cresce (é append-only, todo evento de toda
    campanha desde o S1). O índice entra na mesma migration desta fatia,
    não como um "otimizar depois" — ver Schema/Funções.

## Não-objetivos

- Throttle no login do Superadmin — precisa de infraestrutura de
  auditoria própria (sem `campanha_id`), fatia separada.
- Captcha — serviço externo (hCaptcha/Turnstile), fatia separada.
- 2FA (TOTP) — fluxo de enrollment/recuperação, fatia separada, maior
  escopo dos três.
- Desbloqueio manual pelo Superadmin antes da janela expirar — não
  pedido; a janela deslizante de 15 minutos já resolve o caso comum.
- Notificação ao usuário/Superadmin quando uma conta é bloqueada — só
  registro no `audit_log`, sem alerta ativo.
- Ajustar o limiar por campanha (hoje é global, `LIMITE_FALHAS`/
  `JANELA_MINUTOS` são os mesmos pra todas) — YAGNI, ninguém pediu
  configuração por tenant.

## Schema / Funções

Uma migration nova.

```sql
-- Índice composto: cobre exatamente o WHERE de contar_falhas_login_recentes
-- (igualdade em campanha_id/acao/identificador_chave, intervalo em criado_em).
-- Entra desde já, não como otimização futura — audit_log é append-only e só
-- cresce (todo evento de toda campanha desde o S1).
CREATE INDEX audit_log_login_falha_idx ON public.audit_log (
  campanha_id,
  acao,
  (depois->>'identificador_chave'),
  criado_em DESC
);

-- contar_falhas_login_recentes
CREATE OR REPLACE FUNCTION public.contar_falhas_login_recentes(
  p_campanha_id uuid,
  p_identificador_chave text,
  p_janela_minutos int
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.audit_log
  WHERE campanha_id = p_campanha_id
    AND acao = 'login.falha'
    AND depois->>'identificador_chave' = p_identificador_chave
    AND criado_em > now() - (p_janela_minutos || ' minutes')::interval;
$$;

REVOKE ALL ON FUNCTION public.contar_falhas_login_recentes(uuid, text, int)
  FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.contar_falhas_login_recentes(uuid, text, int)
  TO service_role;
```

`registrar_evento_auth` (S1) não muda de assinatura — só o `p_meta` (jsonb)
passado por `loginCampanha` ganha a chave nova `identificador_chave` nos
casos de falha, e as chamadas de bloqueio usam `p_acao = 'login.bloqueado'`
em vez de `'login.falha'`.

**Nota de escala:** `identificador_chave` fica dentro do jsonb `depois`
(não uma coluna própria) porque o volume esperado é baixo (auditoria de
login, não um evento de alta frequência) e isso evita alterar o schema
principal do `audit_log` só pra esta fatia — decisão consciente, não
descuido. Se o volume crescer a ponto do jsonb deixar de ser adequado
(cenário não esperado no horizonte atual do produto), promover a chave
pra coluna própria é uma migration separada, sem quebrar nada desta fatia.

## Camada Next.js

`web/lib/auth/login.ts` — `LoginDeps` ganha um método novo:

```
LoginDeps.contarFalhasRecentes(campanhaId: string, identificadorChave: string): Promise<number>
```

`loginCampanha` ganha um passo novo no início, e uma pequena adição em
todo ponto de saída por falha que já existia. Fluxo completo, na ordem
exata em que acontece:

```
1. campanhaId = await deps.campanhaIdPorSubdominio(subdominio)
   se null: retorna {ok:false}                          [já existia]

2. identificadorChave = ehEmail(identificador)
     ? identificador.trim().toLowerCase()
     : deps.cpfHmac(normalizarCpf(identificador))         [NOVO]

3. falhasRecentes = await deps.contarFalhasRecentes(
     campanhaId, identificadorChave)                      [NOVO]

4. se falhasRecentes >= LIMITE_FALHAS:                     [NOVO]
     await deps.registrarEvento('login.bloqueado', campanhaId,
       { ip, identificador_chave: identificadorChave })
     retorna {ok:false}
     -- pára aqui: NÃO chama resolverEmailPorCpf nem signIn

5. (a partir daqui, fluxo já existente sem mudança de comportamento —
   só passa a levar identificadorChave já calculado, sem recalcular)
   - resolve e-mail (via CPF ou direto)
   - chama deps.signIn(email, senha)
   - se qualquer passo falhar (cpf_invalido | cpf_nao_encontrado |
     credenciais | subdominio): chama falha(motivo), que agora
     registra {ip, motivo, identificador_chave: identificadorChave}
     em vez de só {ip, motivo}
   - se signIn suceder: registra 'login.sucesso' (sem identificador_chave,
     sem mudança aqui — sucesso não participa da contagem de falhas)
```

`web/lib/auth/build-login-deps.ts` ganha a wiring real:

```
contarFalhasRecentes: async (campanhaId, identificadorChave) => {
  const { data } = await admin.rpc('contar_falhas_login_recentes', {
    p_campanha_id: campanhaId,
    p_identificador_chave: identificadorChave,
    p_janela_minutos: JANELA_MINUTOS,
  });
  return (data as number | null) ?? 0;
},
```

`POST /api/auth/login` (rota HTTP) **não muda** — já repassa `{ok:false}`
pra `401` com a mesma mensagem genérica de sempre, independente do motivo
interno.

## Testes (critério de pronto)

### `loginCampanha` (unitário, `LoginDeps` mockado)

1. Com `contarFalhasRecentes` retornando `>= LIMITE_FALHAS`: `{ok:false}`,
   sem chamar `resolverEmailPorCpf` nem `signIn`; `registrarEvento` chamado
   com `'login.bloqueado'` (não `'login.falha'`).
2. Com `contarFalhasRecentes` retornando `< LIMITE_FALHAS`: fluxo segue
   normalmente (todos os testes já existentes de `loginCampanha`
   continuam passando sem alteração de comportamento).
3. Toda chamada de falha existente (`cpf_invalido`, `cpf_nao_encontrado`,
   `credenciais`, `subdominio`) inclui `identificador_chave` no `meta`
   passado a `registrarEvento`, com o valor correto (HMAC pro caminho CPF,
   e-mail normalizado pro caminho e-mail).
4. A chave do identificador é a mesma independente de qual falha
   específica ocorre (ex.: duas tentativas com o mesmo CPF errado geram a
   mesma `identificador_chave`, mesmo com motivos de falha diferentes).

### `contar_falhas_login_recentes` (via `execute_sql`, padrão S1-S7)

5. Zero linhas de `login.falha` pra uma chave → retorna `0`.
6. N linhas de `login.falha` dentro da janela pra uma chave → retorna `N`.
7. Linhas de `login.falha` fora da janela (mais antigas que
   `p_janela_minutos`) não contam.
8. Linhas de `login.bloqueado` pra a mesma chave/campanha NUNCA contam,
   mesmo dentro da janela — prova direta da decisão 6 (o vetor de DoS
   contra o próprio usuário).
9. Linhas de `login.falha` pra a MESMA chave em OUTRA `campanha_id` não
   contam — prova a decisão 2 (chave é identificador + campanha, não só
   identificador).
10. `get_advisors(type=security)`: zero alertas novos além do padrão já
    aceito (`SECURITY DEFINER` executável por `service_role`, mesma
    categoria das outras funções desta família).
11. `EXPLAIN ANALYZE` da consulta interna de `contar_falhas_login_recentes`
    (rodar o `SELECT` do corpo da função diretamente, com valores reais)
    mostra uso de `audit_log_login_falha_idx` (`Index Scan` ou
    `Index Only Scan`, não `Seq Scan`) — confirma que o índice da decisão
    10 está de fato sendo usado, não só criado.

### End-to-end (via fixture real, execução manual contra o projeto)

12. 5 tentativas com senha errada pro mesmo identificador/campanha,
    seguidas de uma 6ª tentativa com a senha CORRETA: a 6ª ainda falha
    (bloqueado), mesma mensagem genérica.
13. Esperar a janela expirar (ou ajustar `JANELA_MINUTOS` pra um valor
    pequeno só no teste manual) e tentar de novo com a senha correta:
    sucesso.
