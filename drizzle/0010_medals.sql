CREATE TABLE medals (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE medal_awards (id TEXT PRIMARY KEY, medal_id TEXT NOT NULL REFERENCES medals(id), user_id TEXT NOT NULL REFERENCES personnel(id) ON DELETE CASCADE, operation_id INTEGER NOT NULL REFERENCES operation_audits(id) ON DELETE CASCADE, created TEXT NOT NULL);
CREATE INDEX medal_awards_user ON medal_awards(user_id);
CREATE INDEX medal_awards_operation ON medal_awards(operation_id);
