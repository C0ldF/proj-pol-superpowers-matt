-- papel_vinculo: inclui apoiador (sem login); distinto de papel_login do S1
CREATE TYPE public.papel_vinculo AS ENUM (
  'gestor', 'coordenador', 'colaborador', 'lideranca', 'apoiador'
);

CREATE TYPE public.base_legal_enum AS ENUM (
  'consentimento', 'legitimointeresse', 'obrigacao_legal', 'outro'
);

CREATE TYPE public.origem_coleta_enum AS ENUM (
  'manual', 'importacao', 'api'
);
