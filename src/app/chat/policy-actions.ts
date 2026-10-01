"use server";

import { refresh } from "next/cache";
import { setFolderDeny, setItemDeny, setProjectDeny, setSourceDeny } from "@/server/chat/policy";
import { getDb } from "@/server/db";

export async function setPolicyAction(kind: "source" | "folder" | "project" | "item", id: number, deny: boolean) {
  const db = getDb();
  if (kind === "source") setSourceDeny(db, id, deny);
  else if (kind === "folder") setFolderDeny(db, id, deny);
  else if (kind === "project") setProjectDeny(db, id, deny);
  else setItemDeny(db, id, deny);
  refresh();
}
