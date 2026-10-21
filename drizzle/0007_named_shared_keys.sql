CREATE TABLE shared_keys (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    updated TEXT NOT NULL
);
INSERT INTO shared_keys VALUES ('ic','Section leaders',CURRENT_TIMESTAMP),('shield','Pilots',CURRENT_TIMESTAMP);
