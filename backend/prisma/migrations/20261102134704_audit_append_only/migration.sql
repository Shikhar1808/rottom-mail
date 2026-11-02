-- The audit trail is append-only: even our own code can't rewrite or delete history.
CREATE FUNCTION audit_event_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_change
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_readonly();
