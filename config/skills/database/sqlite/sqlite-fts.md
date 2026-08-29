---
name: sqlite-fts
description: SQLite full-text search with FTS5
trigger_patterns:
  - "sqlite fts"
  - "full text search"
  - "fts5"
  - "sqlite search"
capabilities:
  - database
version: "1.0.0"
---
# SQLite Full-Text Search (FTS5)

## Creating an FTS5 Table
```sql
CREATE VIRTUAL TABLE documents_fts USING fts5(
  title,
  content,
  tokenize='porter unicode61'
);
```

## Indexing Content
```sql
-- Insert documents
INSERT INTO documents_fts (rowid, title, content)
VALUES (1, 'Getting Started', 'This guide covers installation and setup.');

-- Keep in sync with main table using triggers
CREATE TRIGGER docs_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts (rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;
```

## Searching
```sql
-- Simple term search
SELECT * FROM documents_fts WHERE documents_fts MATCH 'installation';

-- Phrase search
SELECT * FROM documents_fts WHERE documents_fts MATCH '"getting started"';

-- Boolean operators
SELECT * FROM documents_fts WHERE documents_fts MATCH 'install OR setup';
SELECT * FROM documents_fts WHERE documents_fts MATCH 'install NOT windows';

-- Column-specific search
SELECT * FROM documents_fts WHERE documents_fts MATCH 'title:guide';

-- Prefix search
SELECT * FROM documents_fts WHERE documents_fts MATCH 'instal*';
```

## Ranking Results
```sql
SELECT rowid, title, rank
FROM documents_fts
WHERE documents_fts MATCH 'setup'
ORDER BY rank;  -- lower rank = better match (BM25)

-- Custom BM25 weights per column
SELECT rowid, title, bm25(documents_fts, 10.0, 1.0) AS score
FROM documents_fts
WHERE documents_fts MATCH 'setup'
ORDER BY score;
```

## Snippet and Highlight
```sql
SELECT highlight(documents_fts, 1, '<b>', '</b>') AS highlighted_content
FROM documents_fts WHERE documents_fts MATCH 'setup';

SELECT snippet(documents_fts, 1, '<b>', '</b>', '...', 20) AS snippet
FROM documents_fts WHERE documents_fts MATCH 'setup';
```

## Tokenizers
- `unicode61`: Unicode-aware, case-insensitive (default)
- `porter unicode61`: adds Porter stemming (search → searching/searched)
- `trigram`: character trigram index for substring matching

## Best Practices
- Use external content tables to avoid data duplication
- Keep FTS in sync with triggers or application-level updates
- Use `porter` tokenizer for natural language content
- Combine FTS with regular WHERE clauses by joining on rowid
- Rebuild FTS index periodically: `INSERT INTO fts(fts) VALUES('rebuild')`
