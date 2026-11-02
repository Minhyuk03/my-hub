import { connection } from "next/server";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { normalizeProfile } from "@/server/profile";
import { getSettings } from "@/server/settings";
import { ProfileEditor } from "./profile-editor";

export default async function ProfileEditPage() {
  await connection();
  const db = getDb();
  const hubProjects = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .all()
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">자기소개 편집</h1>
        <p className="text-sm text-muted-foreground">
          비어 있는 칸은 첫 화면에 나오지 않습니다. &ldquo;공개 페이지에 넣기&rdquo;는 나중에 공개 페이지를 만들 때 쓰고, 지금은 허브 안에서만 보입니다.
        </p>
      </div>
      <ProfileEditor initial={normalizeProfile(getSettings(db).profile)} hubProjects={hubProjects} />
    </div>
  );
}
