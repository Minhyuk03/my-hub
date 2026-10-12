/**
 * 보기용 분류: 문서 · 노트 · 코드 · 데이터 · 사진·영상·소리 · 기타
 * - 확장자로 먼저 정하고(baseCategory), 사진·소리·영상은 "데이터"인지 한 번 더 본다.
 *   ① 이름이 data·dataset·train·test 같은 폴더 안에 있거나
 *   ② 한 폴더에 같은 종류가 DENSE_MIN 개 이상 몰려 있으면 (학습용 이미지, 녹음 샘플 등) → 데이터
 * - 폴더 밀집도는 파일이 늘고 줄 때 바뀌므로 워커가 스캔 뒤·주기적으로 recomputeCategories 로 다시 계산한다.
 */
import type { Db } from "./db";

export { CATEGORIES, CATEGORY_LABEL, isCategory, type Category } from "./category-labels";
import { CATEGORIES, type Category } from "./category-labels";

/** 한 폴더에 같은 종류의 사진·소리·영상이 이만큼 이상이면 데이터로 본다 */
export const DENSE_MIN = 50;

const DOC = new Set("pdf doc docx hwp hwpx ppt pptx key pages odt odp rtf notion gdoc gslides goodnotes".split(" "));
const NOTE = new Set("md markdown txt text qmd".split(" "));
const DATA = new Set(
  "csv tsv xls xlsx numbers gsheet ods db sqlite sqlite3 sqbpro hdf5 h5 npy npz pkl pickle parquet feather mat pcap pcapng gpkg geojson kml shp shx dbf prj cpg".split(" "),
);
/** 코드 프로젝트 설정·구성 파일 (확장자만으로는 "기타" 가 되는 것들) */
const PROJECT = new Set(
  "plist pbxproj xcworkspacedata xcconfig xcscheme xcsettings xcprivacy storyboard xib entitlements kts gradle properties lock cmake in m mm cc rc manifest iml service asm".split(" "),
);
const DATA_DIR = /^(data|datas|dataset|datasets|train|training|test|tests_data|val|valid|validation|samples?|audio_store|raw_data)$/i;

const segments = (p: string) => p.normalize("NFC").replace(/#[A-Za-z0-9_-]+/g, "").split("/");

/** 확장자·종류·경로만으로 정하는 분류 (폴더 밀집도는 recomputeCategories 에서) */
export function baseCategory(ext: string, kind: string, path: string): Category {
  const e = ext.toLowerCase();
  const segs = segments(path).slice(0, -1);
  if (kind === "chat") return "note";
  if (e === "ipynb") return "code"; // Jupyter 노트북 (내용 없이 저장된 클라우드 파일도)
  if (DATA.has(e)) return "data";
  if (DOC.has(e) || kind === "pdf" || kind === "design") return "doc";
  if (NOTE.has(e) || kind === "note") return "note";
  const media = kind === "image" || kind === "audio" || kind === "video";
  // 앱 아이콘 등 Xcode 에셋은 코드 프로젝트의 일부
  if (media && segs.some((s) => s.endsWith(".xcassets"))) return "code";
  if (media) return segs.some((s) => DATA_DIR.test(s)) ? "data" : "media";
  if (kind === "code" || PROJECT.has(e)) return e === "json" && segs.some((s) => DATA_DIR.test(s)) ? "data" : "code";
  if (kind === "document") return "doc";
  return "other";
}

/** 모든 항목의 분류를 다시 계산해 바뀐 것만 저장한다. 바뀐 개수를 돌려준다 */
export function recomputeCategories(db: Db): number {
  const c = db.$client;
  const rows = c
    .prepare(`SELECT id, ext, kind, path, folder_id AS folderId, category FROM items WHERE state != 'deleted'`)
    .all() as { id: number; ext: string; kind: string; path: string; folderId: number | null; category: string | null }[];
  const dense = new Set(
    (
      c
        .prepare(
          `SELECT folder_id || ':' || kind AS k FROM items WHERE state != 'deleted' AND folder_id IS NOT NULL AND kind IN ('image','audio','video')
           GROUP BY folder_id, kind HAVING count(*) >= ?`,
        )
        .all(DENSE_MIN) as { k: string }[]
    ).map((r) => r.k),
  );
  const up = c.prepare(`UPDATE items SET category = ? WHERE id = ?`);
  let changed = 0;
  db.transaction(() => {
    for (const r of rows) {
      let cat = baseCategory(r.ext, r.kind, r.path);
      if (cat === "media" && r.folderId != null && dense.has(`${r.folderId}:${r.kind}`)) cat = "data";
      if (cat !== r.category) {
        up.run(cat, r.id);
        changed++;
      }
    }
  });
  return changed;
}

/** 선택한 분류만 (전부 고르면 필터 없음) */
export function categoryFilter(cats: Category[] | undefined): Category[] | undefined {
  if (!cats?.length || cats.length >= CATEGORIES.length) return undefined;
  return cats;
}
