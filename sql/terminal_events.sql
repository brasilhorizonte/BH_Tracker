-- Terminal Events Tracking Table
-- Armazena eventos de uso do horizon-terminal-access

CREATE TABLE terminal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_ts timestamptz NOT NULL DEFAULT now(),
  event_name text NOT NULL,
  feature text,
  action text,
  success boolean,
  user_id uuid,
  session_id text,
  ticker text,
  response_mode text,
  duration_ms integer,
  token_count integer,
  phase text,
  error_message text,
  properties jsonb,
  device_type text,
  browser text,
  os text,
  created_at timestamptz DEFAULT now()
);

-- Indices para queries comuns
CREATE INDEX idx_terminal_events_ts ON terminal_events(event_ts);
CREATE INDEX idx_terminal_events_user ON terminal_events(user_id);
CREATE INDEX idx_terminal_events_ticker ON terminal_events(ticker);
CREATE INDEX idx_terminal_events_name ON terminal_events(event_name);
CREATE INDEX idx_terminal_events_session ON terminal_events(session_id);

-- Row Level Security
ALTER TABLE terminal_events ENABLE ROW LEVEL SECURITY;

-- Policy: Apenas admins podem ler os eventos
CREATE POLICY "Admin read only" ON terminal_events
  FOR SELECT
  USING (public.is_admin(auth.uid()));

-- Policy: Qualquer usuário autenticado pode inserir eventos
CREATE POLICY "Authenticated users can insert" ON terminal_events
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Comentários da tabela
COMMENT ON TABLE terminal_events IS 'Eventos de tracking do horizon-terminal-access';
COMMENT ON COLUMN terminal_events.event_name IS 'Nome do evento (terminal_session_start, terminal_message_send, etc.)';
COMMENT ON COLUMN terminal_events.feature IS 'Feature relacionada ao evento';
COMMENT ON COLUMN terminal_events.ticker IS 'Ticker do ativo sendo analisado';
COMMENT ON COLUMN terminal_events.response_mode IS 'Modo de resposta (fast, deep, pro)';
COMMENT ON COLUMN terminal_events.duration_ms IS 'Duração da operação em milissegundos';
COMMENT ON COLUMN terminal_events.token_count IS 'Contagem de tokens consumidos';
COMMENT ON COLUMN terminal_events.phase IS 'Fase do agente (planning, executing, answering, etc.)';
COMMENT ON COLUMN terminal_events.properties IS 'Propriedades adicionais em JSON';
