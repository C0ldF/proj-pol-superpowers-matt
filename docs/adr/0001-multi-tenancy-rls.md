# Multi-tenancy por banco único + RLS, subdomínio como fachada

Adotamos **um único código e um único banco Postgres (Supabase)**, com isolamento
entre Campanhas feito por **Row Level Security (RLS)** sobre uma coluna de
`campanha_id` em cada tabela operacional. O subdomínio (`cliente.dominio.com.br`,
via wildcard DNS) é resolvido por middleware do Next.js e serve de fachada/branding
e para selecionar a Campanha — mas a barreira real de isolamento é o RLS no banco,
não a aplicação.

## Considered Options

- **Banco único + RLS (escolhido).** Atende "subdomínio por cliente" e "uma mudança
  no código afeta todos" simultaneamente, sem redeploy ao adicionar cliente
  (wildcard). Isolamento garantido pelo banco mesmo diante de bug na aplicação —
  o padrão de segurança/LGPD do Supabase.
- **Banco por cliente.** Rejeitado: pesadelo operacional (migrar N bancos) e
  contraria o requisito de "uma mudança afeta todos".
- **Sem subdomínio (tenant só no login).** Rejeitado por ora: perde o endereço
  próprio por cliente (white-label).

## Consequences

Toda tabela operacional carrega `campanha_id` e tem política RLS. Dados de
referência compartilhados (ver ADR futura sobre dados do TRE) ficam FORA desse
isolamento.
