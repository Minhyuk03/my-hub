"use server";

import { redirect } from "next/navigation";
import { deleteThread } from "@/server/chat/queries";
import { getDb } from "@/server/db";

export async function deleteThreadAction(id: number) {
  deleteThread(getDb(), id);
  redirect("/chat");
}
