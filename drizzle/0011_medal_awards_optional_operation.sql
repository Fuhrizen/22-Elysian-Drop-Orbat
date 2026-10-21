CREATE TABLE medal_awards_next (id TEXT PRIMARY KEY, medal_id TEXT NOT NULL REFERENCES medals(id), user_id TEXT NOT NULL REFERENCES personnel(id) ON DELETE CASCADE, operation_id INTEGER REFERENCES operation_audits(id) ON DELETE CASCADE, created TEXT NOT NULL);
INSERT INTO medal_awards_next SELECT id,medal_id,user_id,operation_id,created FROM medal_awards WHERE id IN (SELECT min(id) FROM medal_awards GROUP BY medal_id,user_id,operation_id);
DROP TABLE medal_awards;
ALTER TABLE medal_awards_next RENAME TO medal_awards;
CREATE INDEX medal_awards_user ON medal_awards(user_id);
CREATE INDEX medal_awards_operation ON medal_awards(operation_id);
CREATE UNIQUE INDEX medal_once_per_operation ON medal_awards(medal_id,user_id,operation_id) WHERE operation_id IS NOT NULL;
