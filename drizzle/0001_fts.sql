-- 한국어 검색 B2 방식 (docs/phase0-korean-search.md)
-- 1) 3글자 이상 검색어: trigram 색인. item_text를 외부 콘텐츠로 참조하고 트리거로 동기화한다.
CREATE VIRTUAL TABLE items_fts USING fts5(title, path, body, content='item_text', content_rowid='item_id', tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER item_text_ai AFTER INSERT ON item_text BEGIN
  INSERT INTO items_fts(rowid, title, path, body) VALUES (new.item_id, new.title, new.path, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER item_text_ad AFTER DELETE ON item_text BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, path, body) VALUES ('delete', old.item_id, old.title, old.path, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER item_text_au AFTER UPDATE ON item_text BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, path, body) VALUES ('delete', old.item_id, old.title, old.path, old.body);
  INSERT INTO items_fts(rowid, title, path, body) VALUES (new.item_id, new.title, new.path, new.body);
END;
--> statement-breakpoint
-- 2) 2글자 검색어: bigram 보조 색인. 원문은 저장하지 않는다(contentless). 앱 코드에서 갱신한다.
CREATE VIRTUAL TABLE items_bigram USING fts5(grams, content='', contentless_delete=1);
