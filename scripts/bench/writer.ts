/** 성능 측정 중 "인덱싱 중" 상태를 만들기 위해 같은 DB에 계속 항목을 쓰는 프로세스 */
import { eq } from "drizzle-orm";
import { openDb } from "@/server/db";
import { items, sources } from "@/server/db/schema";
import { writeItemText } from "@/server/search/index-writer";
import { rand, syntheticDoc } from "./synthetic";

const db = openDb(process.argv[2], { migrate: false });
const src = db.select().from(sources).where(eq(sources.name, "합성")).get()!;
const r = rand(7);
let i = 0;
let stop = false;
process.on("SIGTERM", () => (stop = true));

async function loop() {
  while (!stop) {
    // 실제 워커처럼 작은 묶음으로 쓰고 잠깐 쉰다
    db.transaction(() => {
      for (let k = 0; k < 20; k++) {
        const d = syntheticDoc(r, 1_000_000 + i++);
        const it = db.insert(items).values({ sourceId: src.id, path: `/bench/${i}.md`, title: d.title, ext: "md", kind: "note", modifiedAt: Date.now() }).returning({ id: items.id }).get();
        writeItemText(db, it.id, { title: d.title, path: `${d.folder}/${d.title}.md`, body: d.body });
      }
    });
    await new Promise((res) => setTimeout(res, 5));
  }
  db.$client.close();
  process.exit(0);
}
loop();
