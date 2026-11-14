-- The dictionary file format: one SQLite file per language pair
-- (data/<pair>.sqlite). Kept by hand instead of migrations, because the files
-- are write-once build artifacts and the tables are WITHOUT ROWID: the
-- composite primary key *is* the table, so `forms` needs no second index.
-- Files are rebuilt, not migrated; `PRAGMA user_version` holds the schema
-- version (format.json). See README.md.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE entries (
  id         INTEGER PRIMARY KEY,
  lemma      TEXT NOT NULL,
  pos        TEXT NOT NULL,
  source_pos TEXT NOT NULL,
  etymology  INTEGER NOT NULL,
  case_class INTEGER NOT NULL,
  features   TEXT
);

CREATE TABLE senses (
  entry_id INTEGER NOT NULL,
  idx      INTEGER NOT NULL,
  glosses  TEXT NOT NULL,
  see      TEXT,
  PRIMARY KEY (entry_id, idx)
) WITHOUT ROWID;

CREATE TABLE pronunciations (
  entry_id INTEGER NOT NULL,
  idx      INTEGER NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('ipa', 'audio', 'reading')),
  value    TEXT NOT NULL,
  PRIMARY KEY (entry_id, idx)
) WITHOUT ROWID;

CREATE TABLE forms (
  form     TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  source   INTEGER NOT NULL,
  PRIMARY KEY (form, entry_id)
) WITHOUT ROWID;
