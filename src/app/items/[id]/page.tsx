import { headers } from "next/headers";
import { notFound } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { codeToHtml } from "shiki";
import { SourceIcon, StateBadge } from "@/components/hub-ui";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { bytes, fullDate, shortPath } from "@/lib/format";
import { KIND_LABEL, NO_CONTENT_LABEL, SOURCE_KIND_LABEL } from "@/lib/labels";
import { PATHS } from "@/lib/config";
import { getDb } from "@/server/db";
import { isLocalRequest } from "@/server/http/local";
import { extractText, isExtractable } from "@/server/extract";
import { resolveItemFile } from "@/server/items/access";
import { materialize } from "@/lib/fs/dataless";
import { getItem } from "@/server/queries";
import { mainTagOf, tagEmojiMap } from "@/server/graph";
import { projectList, projectsForItem } from "@/server/projects";
import { ItemProjects } from "./item-projects";
import { ItemAi } from "./item-ai";
import { enqueue } from "@/server/sources/manage";
import { getSettings } from "@/server/settings";
import { LocalOpenButtons } from "./open-buttons";
import { AutoRefresh } from "@/app/status/auto-refresh";

const LANG: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby", rs: "rust", kt: "kotlin", sh: "bash", zsh: "bash", yml: "yaml", md: "markdown", h: "c", hpp: "cpp" };
const MAX_PREVIEW = 200_000;

function obsidianUrl(p: string): string | null {
  const root = PATHS.obsidianVault;
  if (!p.startsWith(root + "/")) return null;
  const rel = p.slice(root.length + 1).normalize("NFC").replace(/\.md$/i, "");
  return `obsidian://open?vault=${encodeURIComponent(path.basename(root))}&file=${encodeURIComponent(rel)}`;
}

export default async function ItemPage({ params, searchParams }: PageProps<"/items/[id]">) {
  const { id } = await params;
  const load = (await searchParams).load === "1";
  const db = getDb();
  const data = getItem(db, Number(id));
  if (!data) notFound();
  const { item, source, tags, error } = data;
  let body = data.body;
  const local = isLocalRequest(await headers());
  const fileUrl = `/api/items/${item.id}/file`;
  const available = item.state !== "deleted" && source.status !== "offline";
  const obsidian = obsidianUrl(item.path);
  const hasEditor = !!getSettings(db).editorByExt[item.ext];
  const memberOf = projectsForItem(db, item.id);
  const tagEmoji = tagEmojiMap(db);
  const allProjects = projectList(db).map((p) => ({ id: p.id, name: p.name }));

  // iCloud에만 있는 텍스트 파일: 사용자가 요청하면 직접 읽어서(=내려받아) 보여준다. 색인은 변경 감지가 이어서 한다.
  if (load && available && item.state === "cloud_only" && isExtractable(item.ext)) {
    const r = resolveItemFile(db, item.id);
    if (r.ok) {
      body = await materialize(r.path, 20_000)
        .then((ok) => (ok ? fs.promises.readFile(r.path, { signal: AbortSignal.timeout(30_000) }) : Promise.reject(new Error("아직"))))
        .then((buf) => extractText(item.ext, buf))
        .then((x) => x.body)
        .catch(() => "");
      if (body) enqueue(db, "reindex", { itemIds: [item.id] });
    }
  }

  let preview: React.ReactNode = null;
  if (available && item.state === "cloud_only" && !load) {
    // 읽으면 iCloud 다운로드가 시작되므로 사용자가 직접 누른 경우에만 불러온다
    preview = (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>이 파일은 iCloud에만 있어 내용을 색인하지 않았습니다.</p>
        <a href={`/items/${item.id}?load=1`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          iCloud에서 받아서 미리보기
        </a>
      </div>
    );
  } else if (!available) {
    preview = <p className="text-sm text-muted-foreground">{source.status === "offline" ? "소스가 오프라인이라 원본을 열 수 없습니다. 인덱스에 저장된 정보만 표시합니다." : "삭제된 항목입니다."}</p>;
  } else if (item.kind === "image" && item.ext !== "nef") {
    // eslint-disable-next-line @next/next/no-img-element
    preview = <img src={fileUrl} alt={item.title} className="max-h-[70vh] max-w-full rounded-md" />;
  } else if (item.kind === "video") {
    preview = <video src={fileUrl} controls className="max-h-[70vh] max-w-full rounded-md" />;
  } else if (item.kind === "audio") {
    preview = <audio src={fileUrl} controls />;
  } else if (item.kind === "pdf") {
    preview = <iframe src={fileUrl} title={item.title} className="h-[75vh] w-full rounded-md border" />;
  } else if (item.state === "cloud_only" && !body) {
    preview = (
      <p className="text-sm text-muted-foreground">
        iCloud에서 받아오는 중입니다. 받아오면 자동으로 표시됩니다. (파일이 크거나 iCloud가 느리면 몇 분 걸릴 수 있습니다)
        <AutoRefresh seconds={4} />
      </p>
    );
  } else if (body && (item.kind === "note" || source.kind === "notion" || source.kind === "github")) {
    preview = (
      <article className="prose-hub max-w-none break-words">
        <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{body.slice(0, MAX_PREVIEW)}</Markdown>
      </article>
    );
  } else if (body && item.kind === "code") {
    const html = await codeToHtml(body.slice(0, MAX_PREVIEW), {
      lang: LANG[item.ext] ?? item.ext,
      themes: { light: "github-light", dark: "github-dark" },
    }).catch(() => null);
    preview = html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="overflow-x-auto rounded-md bg-muted p-4 text-sm">{body.slice(0, MAX_PREVIEW)}</pre>;
  } else if (body) {
    preview = <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">{body.slice(0, MAX_PREVIEW)}</pre>;
  } else {
    preview = <p className="text-sm text-muted-foreground">{item.noContentReason ? NO_CONTENT_LABEL[item.noContentReason] : "미리보기할 내용이 없습니다."}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <SourceIcon kind={source.kind} className="size-5" />
          <h1 className="break-all text-xl font-semibold">{item.title}</h1>
          <StateBadge state={item.state} sourceStatus={source.status} noContentReason={item.noContentReason} />
        </div>
        <p className="break-all text-sm text-muted-foreground">{shortPath(item.path)}</p>
        <p className="text-xs text-muted-foreground">
          {SOURCE_KIND_LABEL[source.kind]} · {source.name} · {KIND_LABEL[item.kind] ?? item.kind} · {bytes(item.size)} · 수정 {fullDate(item.modifiedAt)}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {tags.map((t) => (
              <a key={t} href={`/search?q=${encodeURIComponent(t)}&tag=${encodeURIComponent(t)}`}>
                <Badge variant="secondary">{tagEmoji.get(mainTagOf(t)) ? `${tagEmoji.get(mainTagOf(t))} ` : ""}#{t}</Badge>
              </a>
            ))}
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive">
            오류: {error.message} (재시도 {error.retryCount}회)
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {item.url?.startsWith("https://") && (
          <a href={item.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
            {source.kind === "notion" ? "Notion에서 열기" : source.kind === "github" ? "GitHub에서 열기" : "Google에서 열기"}
          </a>
        )}
        {available && source.kind !== "notion" && source.kind !== "github" && (
          <a href={`${fileUrl}?download=1`} className={buttonVariants({ size: "sm", variant: item.url ? "outline" : "default" })}>
            {source.kind === "gdrive" && ["gdoc", "gslides", "gsheet"].includes(item.ext) ? "PDF로 다운로드" : "원본 다운로드"}
          </a>
        )}
        {available && item.kind === "pdf" && (
          <a href={fileUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
            새 탭에서 열기
          </a>
        )}
        {obsidian && (
          <a href={obsidian} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Obsidian에서 열기
          </a>
        )}
        {/* 서버에서 프로그램을 실행하는 버튼은 Mac mini 본인 접속에서만 보인다 */}
        {available && local && source.kind !== "gdrive" && source.kind !== "notion" && source.kind !== "github" && <LocalOpenButtons id={item.id} hasEditor={hasEditor} />}
      </div>

      <ItemProjects itemId={item.id} memberOf={memberOf} projects={allProjects} />

      <ItemAi itemId={item.id} emoji={Object.fromEntries(tagEmoji)} />

      <div>{preview}</div>
    </div>
  );
}
