CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash TEXT NOT NULL,
  phone_masked TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_phone_hash_idx ON conversations(phone_hash);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  segments INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_idx
  ON messages(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS research_runs (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  search_query TEXT NOT NULL DEFAULT '',
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'running',
  timings JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_runs_conversation_created_idx
  ON research_runs(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL UNIQUE,
  token_hash TEXT UNIQUE,
  last_seen TIMESTAMPTZ,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION consume_pairing_code(input_code TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  consumed_code TEXT;
BEGIN
  DELETE FROM pairing_codes
    WHERE code = input_code AND expires_at > now()
    RETURNING code INTO consumed_code;
  RETURN consumed_code IS NOT NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS inbound_dedupe (
  dedupe_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS inbound_dedupe_expiry_idx ON inbound_dedupe(expires_at);

CREATE TABLE IF NOT EXISTS sms_outbox (
  id UUID PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  body TEXT NOT NULL,
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sms_outbox_device_status_expiry_idx
  ON sms_outbox(device_id, status, expires_at);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_dedupe ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_outbox ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION cleanup_expired_data(retention_days INTEGER DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  removed_messages INTEGER;
  removed_conversations INTEGER;
  removed_runs INTEGER;
BEGIN
  DELETE FROM messages WHERE created_at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS removed_messages = ROW_COUNT;
  DELETE FROM research_runs WHERE created_at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS removed_runs = ROW_COUNT;
  DELETE FROM conversations c
    WHERE c.created_at < now() - make_interval(days => retention_days)
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id);
  GET DIAGNOSTICS removed_conversations = ROW_COUNT;
  UPDATE messages m SET status = 'expired'
    WHERE m.status = 'queued'
      AND EXISTS (
        SELECT 1 FROM sms_outbox o
        WHERE o.id::text = m.provider_message_id
          AND o.expires_at <= now()
      );
  DELETE FROM sms_outbox WHERE expires_at <= now();
  DELETE FROM pairing_codes WHERE expires_at <= now();
  DELETE FROM inbound_dedupe WHERE expires_at <= now();
  RETURN jsonb_build_object(
    'deletedMessages', removed_messages,
    'deletedRuns', removed_runs,
    'deletedConversations', removed_conversations
  );
END;
$$;

GRANT USAGE ON SCHEMA public TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;

REVOKE ALL ON FUNCTION consume_pairing_code(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_pairing_code(TEXT) TO service_role;
REVOKE ALL ON FUNCTION cleanup_expired_data(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_data(INTEGER) TO service_role;
