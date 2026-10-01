-- 본문에서 읽은 태그 + 사용자·AI 태그를 함께 보는 뷰
CREATE VIEW v_item_tags AS
  SELECT item_id, tag_id FROM item_tags
  UNION
  SELECT item_id, tag_id FROM item_tags_manual;
