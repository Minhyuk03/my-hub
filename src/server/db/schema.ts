import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * 시각은 모두 epoch 밀리초(integer)로 저장한다.
 * 검색 색인(FTS5 가상 테이블)은 drizzle-kit이 다루지 못하므로 drizzle/0001_fts.sql 에서 직접 만든다.
 */

export type SourceKind = "external" | "icloud" | "obsidian" | "local";
export type SourceStatus = "ok" | "syncing" | "offline" | "error";

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").$type<SourceKind>().notNull(),
  name: text("name").notNull(),
  /** 실제 경로(realpath). 파일 조작에 그대로 쓴다. */
  rootPath: text("root_path").notNull().unique(),
  /** 외장 디스크 소스의 볼륨 루트(/Volumes/Disk)와 UUID. 분리·다른 디스크 오인 방지용 */
  volumeRoot: text("volume_root"),
  volumeUuid: text("volume_uuid"),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  status: text("status").$type<SourceStatus>().notNull().default("ok"),
  lastFullScanAt: integer("last_full_scan_at"),
  lastFullScanOk: integer("last_full_scan_ok", { mode: "boolean" }),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
});

export type ItemState = "ok" | "deleted" | "no_permission" | "cloud_only" | "extract_failed";

export const folders = sqliteTable(
  "folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    name: text("name").notNull(),
    /** inode + 장치 번호. 폴더 이동·이름 변경 추적용 */
    fileId: integer("file_id"),
    dev: integer("dev"),
    state: text("state").$type<"ok" | "deleted">().notNull().default("ok"),
    seenScanId: integer("seen_scan_id"),
    modifiedAt: integer("modified_at"),
    deletedDetectedAt: integer("deleted_detected_at"),
  },
  (t) => [uniqueIndex("folders_path").on(t.path), index("folders_inode").on(t.dev, t.fileId)],
);

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    folderId: integer("folder_id"),
    /** 디스크상의 실제 경로 (readdir가 준 그대로. 한글이 NFD일 수 있음) */
    path: text("path").notNull(),
    title: text("title").notNull(),
    ext: text("ext").notNull().default(""),
    kind: text("kind").notNull().default("other"),
    size: integer("size").notNull().default(0),
    contentHash: text("content_hash"),
    fileId: integer("file_id"),
    dev: integer("dev"),
    state: text("state").$type<ItemState>().notNull().default("ok"),
    /** 본문을 추출하지 않은 이유: too_large | binary | unsupported | null */
    noContentReason: text("no_content_reason"),
    createdAt: integer("created_at"),
    modifiedAt: integer("modified_at"),
    indexedAt: integer("indexed_at"),
    deletedDetectedAt: integer("deleted_detected_at"),
    seenScanId: integer("seen_scan_id"),
    previewText: text("preview_text"),
  },
  (t) => [
    uniqueIndex("items_path").on(t.path),
    index("items_inode").on(t.dev, t.fileId),
    index("items_hash").on(t.contentHash),
    index("items_modified").on(t.state, t.modifiedAt),
    index("items_mtime").on(t.modifiedAt),
    index("items_source").on(t.sourceId, t.state),
    index("items_folder").on(t.folderId),
  ],
);

/** 검색 색인의 원본 텍스트 (NFC 정규화). FTS 테이블은 이 테이블을 외부 콘텐츠로 참조한다. */
export const itemText = sqliteTable("item_text", {
  itemId: integer("item_id").primaryKey(),
  title: text("title").notNull(),
  path: text("path").notNull(),
  body: text("body").notNull().default(""),
});

export const itemErrors = sqliteTable("item_errors", {
  itemId: integer("item_id").primaryKey(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: integer("next_retry_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const scanJobs = sqliteTable(
  "scan_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"full" | "subtree">().notNull(),
    /** 이 스캔이 확인하는 범위 (전체 스캔이면 소스 루트) */
    scopePath: text("scope_path").notNull(),
    /** 중단 후 재개용: 아직 방문하지 않은 폴더 목록(JSON) */
    cursor: text("cursor"),
    processed: integer("processed").notNull().default(0),
    totalEstimate: integer("total_estimate"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    result: text("result").$type<"running" | "ok" | "aborted" | "offline" | "error">().notNull().default("running"),
    message: text("message"),
  },
  (t) => [index("scan_jobs_source").on(t.sourceId, t.result)],
);

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const itemTags = sqliteTable(
  "item_tags",
  {
    itemId: integer("item_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] }), index("item_tags_tag").on(t.tagId)],
);

/** Obsidian [[위키링크]] */
export const itemLinks = sqliteTable(
  "item_links",
  {
    itemId: integer("item_id").notNull(),
    target: text("target").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.target] })],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

/** 웹 → 워커 요청 (다시 스캔, 재시도, 백업 등) */
export const commands = sqliteTable("commands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  takenAt: integer("taken_at"),
  doneAt: integer("done_at"),
  result: text("result"),
});

export const backups = sqliteTable("backups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull(),
  createdAt: integer("created_at").notNull(),
  size: integer("size").notNull(),
  verifiedAt: integer("verified_at"),
  /** pending: 외장 디스크가 없어 내장 디스크에 임시 보관 중 */
  location: text("location").$type<"disk" | "pending">().notNull(),
  removedAt: integer("removed_at"),
});

/** 워커 상태 (하트비트, 현재 작업) */
export const runtime = sqliteTable("runtime", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});
