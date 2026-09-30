/** 지금 바로 백업한다: npm run backup */
import { applyRetention, createBackup, realBackupEnv } from "@/server/backup";
import { openDb } from "@/server/db";
import { getSettings } from "@/server/settings";

const db = openDb();
const s = getSettings(db);
const b = createBackup(db, s.backupDir, realBackupEnv());
if (b.location === "disk") applyRetention(db, s.backupDir, s.backupKeepDaily, s.backupKeepWeekly, Date.now());
console.log(b.location === "disk" ? "백업 완료:" : "외장 디스크가 없어 임시 보관:", b.path);
db.$client.close();
