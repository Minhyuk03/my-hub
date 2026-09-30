/** DB 스키마를 최신으로 맞춘다 (허브 시작 전에 실행) */
import { DB_FILE, openDb } from "@/server/db";

const db = openDb(DB_FILE);
db.$client.close();
console.log("DB 준비 완료:", DB_FILE);
