CREATE TYPE public.tipo_local_enum AS ENUM (
  'convencional', 'transito', 'preso_provisorio', 'outro'
);

CREATE TYPE public.situacao_local_enum AS ENUM (
  'ativo', 'bloqueado'
);

CREATE TYPE public.status_importacao_enum AS ENUM (
  'pendente', 'processando', 'pendente_revisao', 'publicado', 'arquivado', 'erro'
);

CREATE TYPE public.geo_status_enum AS ENUM (
  'pendente', 'sucesso', 'falhou', 'manual', 'nao_necessario'
);

CREATE TYPE public.status_bairro_local_enum AS ENUM (
  'pendente', 'confirmado', 'fundido'
);

CREATE TYPE public.status_reconciliacao_enum AS ENUM (
  'fundido', 'mantido_separado'
);