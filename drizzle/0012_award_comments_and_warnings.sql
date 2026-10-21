ALTER TABLE medal_awards ADD COLUMN comment TEXT NOT NULL DEFAULT '';
ALTER TABLE medal_awards ADD COLUMN revoked_at TEXT;
CREATE TABLE personnel_warnings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES personnel(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('warning','strike')), reason TEXT NOT NULL, created TEXT NOT NULL);
DROP INDEX medal_once_per_operation;
CREATE UNIQUE INDEX medal_once_per_operation ON medal_awards(medal_id,user_id,operation_id) WHERE operation_id IS NOT NULL AND revoked_at IS NULL;
