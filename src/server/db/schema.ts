import { sql } from "drizzle-orm";
import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * 시각은 모두 epoch 밀리초(integer)로 저장한다.
 * 검색 색인(FTS5 가상 테이블)은 drizzle-kit이 다루지 못하므로 drizzle/0001_fts.sql 에서 직접 만든다.
 */

export type SourceKind = "external" | "icloud" | "obsidian" | "local" | "gdrive" | "notion" | "github" | "figma" | "ai";
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
    /** 클라우드 소스의 원본 ID (Google Drive 폴더 ID 등). 이동·이름 변경 추적용 */
    externalId: text("external_id"),
    /** inode + 장치 번호. 폴더 이동·이름 변경 추적용 */
    fileId: integer("file_id"),
    dev: integer("dev"),
    state: text("state").$type<"ok" | "deleted">().notNull().default("ok"),
    seenScanId: integer("seen_scan_id"),
    modifiedAt: integer("modified_at"),
    deletedDetectedAt: integer("deleted_detected_at"),
  },
  (t) => [uniqueIndex("folders_path").on(t.path), index("folders_inode").on(t.dev, t.fileId), index("folders_external").on(t.sourceId, t.externalId)],
);

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    folderId: integer("folder_id"),
    /** 디스크상의 실제 경로 (readdir가 준 그대로. 한글이 NFD일 수 있음). 클라우드 소스는 "gdrive:/<루트ID>/폴더#ID/파일#ID" 형식 */
    path: text("path").notNull(),
    /** 클라우드 소스의 원본 ID (Google Drive 파일 ID 등) */
    externalId: text("external_id"),
    /** 원본을 여는 웹 주소 (Google Drive 등) */
    url: text("url"),
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
    index("items_external").on(t.sourceId, t.externalId),
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

// ---------- Phase 2: 프로젝트 ----------

export type ProjectStatus = "active" | "on_hold" | "done";
/** PARA: 프로젝트(끝이 있는 일) · 영역(끝이 없는 책임) · 자료(관심 주제). 보관은 상태(완료·보류)로 나타낸다 */
export type ProjectKind = "project" | "area" | "resource";
export type AddedBy = "user" | "import" | "suggestion";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").$type<ProjectStatus>().notNull().default("active"),
  kind: text("kind").$type<ProjectKind>().notNull().default("project"),
  memo: text("memo").notNull().default(""),
  /** 외부 AI 전송 정책 (Phase 5에서 사용) */
  externalPolicy: text("external_policy").$type<"allow" | "deny">().notNull().default("allow"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** 폴더 단위 연결 (기본 방식). folder_id 는 inode로 추적되므로 이동·이름 변경에도 유지된다. */
export const projectFolders = sqliteTable(
  "project_folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    folderId: integer("folder_id").notNull().references(() => folders.id),
    includeSubfolders: integer("include_subfolders", { mode: "boolean" }).notNull().default(true),
    addedBy: text("added_by").$type<AddedBy>().notNull().default("user"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("project_folders_uniq").on(t.projectId, t.folderId), index("project_folders_folder").on(t.folderId)],
);

/** 폴더 밖 개별 항목 추가(include) / 연결된 폴더 안의 항목 제외(exclude) */
export const projectItems = sqliteTable(
  "project_items",
  {
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    itemId: integer("item_id").notNull(),
    mode: text("mode").$type<"include" | "exclude">().notNull(),
    addedBy: text("added_by").$type<AddedBy>().notNull().default("user"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.itemId] }), index("project_items_item").on(t.itemId)],
);

/** 폴더 이름 기반 연결 제안. key(정렬된 폴더 ID 목록)가 같으면 같은 제안으로 보고, 거절한 제안은 다시 띄우지 않는다. */
export const projectSuggestions = sqliteTable("project_suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  projectId: integer("project_id"),
  folderIds: text("folder_ids", { mode: "json" }).$type<number[]>().notNull(),
  suggestedName: text("suggested_name").notNull(),
  reason: text("reason").notNull(),
  score: integer("score").notNull(),
  status: text("status").$type<"pending" | "accepted" | "rejected">().notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at"),
});

// ---------- 홈 화면 (북마크 바, 즐겨찾기 타일) ----------

/** 북마크 바의 폴더(그룹) */
export const bookmarkGroups = sqliteTable("bookmark_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  order: integer("order").notNull().default(0),
});

/** 북마크. group_id 가 없으면 북마크 바에 바로 표시 */
export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").references(() => bookmarkGroups.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    order: integer("order").notNull().default(0),
  },
  (t) => [index("bookmarks_group").on(t.groupId, t.order)],
);

/** 홈 가운데 즐겨찾기 타일: 폴더 / 프로젝트 / 웹 주소 */
export const shortcuts = sqliteTable("shortcuts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").$type<"folder" | "project" | "url">().notNull(),
  /** folder: folders.id, project: projects.id, url: 주소 */
  target: text("target").notNull(),
  title: text("title").notNull(),
  order: integer("order").notNull().default(0),
});

/** 메인 태그(최상위 태그)의 이모지 */
export const tagStyles = sqliteTable("tag_styles", {
  name: text("name").primaryKey(),
  emoji: text("emoji").notNull(),
});

// ---------- 로컬 AI (Ollama) ----------

/** 문서 임베딩 (bge-m3). 제목·폴더 경로·본문 앞부분으로 만든다 */
export const itemEmbeddings = sqliteTable("item_embeddings", {
  itemId: integer("item_id").primaryKey(),
  model: text("model").notNull(),
  /** Float32 벡터 */
  vector: blob("vector", { mode: "buffer" }).notNull(),
  /** 임베딩에 쓴 글의 해시. 바뀌면 다시 만든다 */
  textHash: text("text_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** AI 제안. 수락해야만 적용한다. 같은 내용(text_hash)에 대해 거절한 제안은 다시 만들지 않는다 */
export const aiSuggestions = sqliteTable(
  "ai_suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id").notNull(),
    kind: text("kind").$type<"tags" | "project">().notNull(),
    payload: text("payload", { mode: "json" })
      .$type<{ tags?: string[]; summary?: string; para?: string; projectId?: number; score?: number; neighbors?: number }>()
      .notNull(),
    model: text("model").notNull(),
    textHash: text("text_hash").notNull(),
    status: text("status").$type<"pending" | "accepted" | "rejected">().notNull().default("pending"),
    createdAt: integer("created_at").notNull(),
    decidedAt: integer("decided_at"),
  },
  (t) => [uniqueIndex("ai_suggestions_item_kind").on(t.itemId, t.kind), index("ai_suggestions_status").on(t.status, t.kind)],
);

/** 사용자가 붙인(또는 AI 제안을 수락한) 태그. 본문에서 읽은 태그와 달리 다시 색인해도 지워지지 않는다 */
export const itemTagsManual = sqliteTable(
  "item_tags_manual",
  {
    itemId: integer("item_id").notNull(),
    tagId: integer("tag_id").notNull(),
    origin: text("origin").$type<"ai" | "user">().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] }), index("item_tags_manual_tag").on(t.tagId)],
);

// ---------- Phase 4: 의미 검색 ----------

/** 긴 문서를 나눈 조각. 벡터는 sqlite-vec 가상 테이블 vec_chunks(chunk_id, embedding float[1024]) 에 있다 */
export const itemChunks = sqliteTable(
  "item_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id").notNull(),
    idx: integer("idx").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("item_chunks_item").on(t.itemId, t.idx)],
);

/** 문서별 조각 상태: 어떤 본문(해시)으로 어떤 모델이 만들었는지 */
export const itemChunkState = sqliteTable("item_chunk_state", {
  itemId: integer("item_id").primaryKey(),
  model: text("model").notNull(),
  textHash: text("text_hash").notNull(),
  chunks: integer("chunks").notNull(),
  createdAt: integer("created_at").notNull(),
});

// ---------- Phase 5: AI 채팅 (6장 정책) ----------

/** 외부 AI(Claude·OpenAI) 전송 금지 지정. 폴더는 하위 전체에 적용. 소스는 sources.config.externalAi, 프로젝트는 projects.external_policy */
export const externalDeny = sqliteTable(
  "external_deny",
  {
    targetKind: text("target_kind").$type<"folder" | "item">().notNull(),
    targetId: integer("target_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.targetKind, t.targetId] })],
);

export type ChatProvider = "local" | "claude" | "openai";
export type ChatScope = { kind: "all" } | { kind: "project"; projectId: number } | { kind: "items"; itemIds: number[] };

export const chatThreads = sqliteTable("chat_threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  scope: text("scope", { mode: "json" }).$type<ChatScope>().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: integer("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    provider: text("provider").$type<ChatProvider>(),
    model: text("model"),
    /** 외부 전송 금지 자료에서 나온 답 (파생 데이터 정책 상속): 이후 외부 AI 요청의 대화 이력에서 뺀다 */
    localOnly: integer("local_only", { mode: "boolean" }).notNull().default(false),
    /** 근거가 부족해 AI 를 부르지 않고 답한 경우 */
    insufficient: integer("insufficient", { mode: "boolean" }).notNull().default(false),
    /** 외부 금지라 뺀 자료 수 */
    excludedCount: integer("excluded_count").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("chat_messages_thread").on(t.threadId, t.id)],
);

/** 답변 당시 AI 에게 준 자료(원문 조각 사본). 원본이 바뀌어도 그대로 남는다 */
export const chatCitations = sqliteTable(
  "chat_citations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    itemId: integer("item_id").notNull(),
    chunkId: integer("chunk_id"),
    title: text("title").notNull(),
    path: text("path").notNull(),
    quote: text("quote").notNull(),
    /** 답변 본문에 [n] 으로 실제 인용됐는지 */
    cited: integer("cited", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("chat_citations_message").on(t.messageId), index("chat_citations_item").on(t.itemId)],
);

/** 외부 AI 전송 기록: 요청마다 어떤 항목·조각을 보냈는지 */
export const externalLog = sqliteTable(
  "external_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: integer("created_at").notNull(),
    provider: text("provider").$type<"claude" | "openai">().notNull(),
    model: text("model").notNull(),
    threadId: integer("thread_id"),
    messageId: integer("message_id"),
    question: text("question").notNull(),
    itemIds: text("item_ids", { mode: "json" }).$type<number[]>().notNull(),
    chunkIds: text("chunk_ids", { mode: "json" }).$type<number[]>().notNull(),
    historyCount: integer("history_count").notNull().default(0),
    chars: integer("chars").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: text("status").$type<"sending" | "ok" | "error" | "blocked">().notNull(),
    error: text("error"),
  },
  (t) => [index("external_log_time").on(t.createdAt)],
);

// ---------- Phase 6: Obsidian PARA 정리 제안 ----------

/** 노트·폴더 이동 제안. 수락해야만 옮긴다. 같은 (원래 경로, 옮길 경로) 제안은 다시 만들지 않는다 */
export const paraMoves = sqliteTable(
  "para_moves",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").$type<"note" | "archive">().notNull(),
    itemId: integer("item_id"),
    folderId: integer("folder_id"),
    fromPath: text("from_path").notNull(),
    toPath: text("to_path").notNull(),
    reason: text("reason").notNull(),
    status: text("status").$type<"pending" | "accepted" | "rejected" | "failed">().notNull().default("pending"),
    message: text("message"),
    createdAt: integer("created_at").notNull(),
    decidedAt: integer("decided_at"),
  },
  (t) => [uniqueIndex("para_moves_paths").on(t.fromPath, t.toPath), index("para_moves_status").on(t.status)],
);
