CREATE TABLE discord_medal_batches (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 due_at INTEGER NOT NULL,
 retry_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 token TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 delivered_at INTEGER,
 message_id TEXT
);
CREATE TABLE discord_medal_items (
 award_id TEXT PRIMARY KEY REFERENCES medal_awards(id) ON DELETE CASCADE,
 batch_id INTEGER NOT NULL REFERENCES discord_medal_batches(id)
);
CREATE INDEX discord_medal_batch_pending ON discord_medal_batches(delivered_at,due_at,retry_at);
CREATE TRIGGER queue_discord_medal AFTER INSERT ON medal_awards
WHEN NEW.revoked_at IS NULL
BEGIN
 INSERT INTO discord_medal_batches(due_at)
 SELECT unixepoch()+900
 WHERE NOT EXISTS(SELECT 1 FROM discord_medal_batches WHERE delivered_at IS NULL AND due_at>unixepoch() AND lease_until=0);
 INSERT INTO discord_medal_items(award_id,batch_id)
 SELECT NEW.id,id FROM discord_medal_batches
 WHERE delivered_at IS NULL AND due_at>unixepoch() AND lease_until=0 ORDER BY id DESC LIMIT 1;
END;
