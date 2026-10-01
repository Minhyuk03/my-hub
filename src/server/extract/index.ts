import matter from "gray-matter";
import { strFromU8, unzipSync } from "fflate";

export type ItemKind = "note" | "document" | "pdf" | "code" | "image" | "video" | "audio" | "archive" | "design" | "other";

const CODE_EXT = new Set(
  "ts tsx js jsx mjs cjs py rb go rs java kt swift c h cpp hpp cs php sh zsh bash sql json yaml yml toml xml html css scss vue svelte lua r dart ini conf".split(" "),
);
const TEXT_EXT = new Set(["txt", "text", "log", "csv", "tsv"]);
const IMAGE_EXT = new Set("jpg jpeg png gif webp heic heif tif tiff bmp svg nef cr2 arw dng raw".split(" "));
const VIDEO_EXT = new Set("mp4 mov m4v avi mkv webm".split(" "));
const AUDIO_EXT = new Set("mp3 m4a wav aac flac ogg".split(" "));
const ARCHIVE_EXT = new Set("zip tar gz tgz 7z rar dmg".split(" "));

export function kindOf(ext: string): ItemKind {
  const e = ext.toLowerCase();
  if (e === "md" || e === "markdown") return "note";
  if (e === "pdf") return "pdf";
  if (e === "docx" || e === "hwpx" || e === "pptx" || e === "xlsx" || TEXT_EXT.has(e)) return "document";
  if (e === "ipynb") return "code";
  if (CODE_EXT.has(e)) return "code";
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  if (AUDIO_EXT.has(e)) return "audio";
  if (ARCHIVE_EXT.has(e)) return "archive";
  return "other";
}

/** 본문을 추출할 수 있는 형식인지 */
export function isExtractable(ext: string): boolean {
  const k = kindOf(ext);
  return k === "note" || k === "document" || k === "pdf" || k === "code";
}

export type Extracted = { body: string; tags: string[]; links: string[] };

export class BinaryContentError extends Error {}

/** 파일 내용에서 텍스트·태그·위키링크를 뽑는다. 실패하면 예외를 던진다. */
export async function extractText(ext: string, buf: Buffer): Promise<Extracted> {
  const e = ext.toLowerCase();
  if (e === "pdf") return { body: await pdfText(buf), tags: [], links: [] };
  if (e === "docx") return { body: await docxText(buf), tags: [], links: [] };
  if (e === "hwpx") return { body: hwpxText(buf), tags: [], links: [] };
  if (e === "pptx") return { body: pptxText(buf), tags: [], links: [] };
  if (e === "xlsx") return { body: xlsxText(buf), tags: [], links: [] };
  if (e === "ipynb") return { body: ipynbText(buf), tags: [], links: [] };
  if (buf.subarray(0, 8000).includes(0)) throw new BinaryContentError("텍스트 파일이 아님");
  const text = buf.toString("utf8");
  if (e === "md" || e === "markdown") return markdown(text);
  return { body: text, tags: [], links: [] };
}

export function markdown(text: string): Extracted {
  let body = text;
  const tags = new Set<string>();
  try {
    const fm = matter(text);
    body = fm.content;
    const t = fm.data?.tags ?? fm.data?.tag;
    const list = Array.isArray(t) ? t : typeof t === "string" ? t.split(/[,\s]+/) : [];
    for (const x of list) if (x) tags.add(String(x).replace(/^#/, ""));
  } catch {
    // frontmatter 형식이 깨져 있으면 전체를 본문으로 쓴다
  }
  // 인라인 #태그 (코드 블록과 제목 #은 제외)
  const noCode = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  for (const m of noCode.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu)) {
    if (!/^\d+$/.test(m[1])) tags.add(m[1]);
  }
  const links = new Set<string>();
  for (const m of body.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) links.add(m[1].trim());
  return { body, tags: [...tags].map((t) => t.normalize("NFC")), links: [...links].map((l) => l.normalize("NFC")) };
}

async function pdfText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function docxText(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const r = await mammoth.extractRawText({ buffer: buf });
  return r.value;
}

/** HWPX: zip 안의 Contents/section*.xml 에서 <hp:t> 텍스트를 모은다 */
export function hwpxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /^Contents\/section\d+\.xml$/.test(f.name) });
  const names = Object.keys(files).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const parts: string[] = [];
  for (const n of names) {
    const xml = strFromU8(files[n]);
    for (const para of xml.split(/<\/hp:p>/)) {
      const texts = [...para.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)].map((m) => decodeXml(m[1].replace(/<[^>]+>/g, "")));
      if (texts.length) parts.push(texts.join(""));
    }
  }
  return parts.join("\n");
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

/** PPTX: 슬라이드마다 <a:t> 글자를 모은다 */
export function pptxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
  return Object.keys(files)
    .sort((a, b) => num(a) - num(b))
    .map((n) => [...strFromU8(files[n]).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(" "))
    .filter(Boolean)
    .join("\n");
}

/** XLSX: 공유 문자열(셀 글자)을 모은다. 숫자 셀은 색인하지 않는다 */
export function xlsxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) });
  const shared = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const strings = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(""));
  // 셀 안에 바로 적힌 글자(inlineStr)도 포함
  const inline = Object.keys(files)
    .filter((n) => n.startsWith("xl/worksheets/"))
    .flatMap((n) => [...strFromU8(files[n]).matchAll(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])));
  return [...strings, ...inline].filter(Boolean).join("\n");
}

/** Jupyter 노트북: 마크다운·코드 셀 내용 */
export function ipynbText(buf: Buffer): string {
  const nb = JSON.parse(buf.toString("utf8")) as { cells?: { cell_type: string; source: string | string[] }[] };
  return (nb.cells ?? [])
    .filter((c) => c.cell_type === "markdown" || c.cell_type === "code")
    .map((c) => (Array.isArray(c.source) ? c.source.join("") : c.source))
    .join("\n\n");
}
