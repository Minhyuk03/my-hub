-- 의미 검색 벡터 (sqlite-vec). 연결을 열 때 확장을 먼저 불러와야 한다 (src/server/db/index.ts)
CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[1024] distance_metric=cosine);
