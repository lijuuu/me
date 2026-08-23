"use server";

import { nanoid } from "nanoid";
import { redirect } from "next/navigation";
import { pastesCollection } from "../../lib/mongodb";
import { detectLanguage } from "../../lib/highlight";

const MAX_BYTES = 200_000;
const EXPIRY_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export async function createPaste(formData: FormData) {
  const type = formData.get("type") === "code" ? "code" : "markdown";
  const content = String(formData.get("content") ?? "").trim();
  const expiry = String(formData.get("expiry") ?? "7d");

  if (!content) throw new Error("paste is empty");
  if (Buffer.byteLength(content, "utf-8") > MAX_BYTES) throw new Error("paste too large");

  const ms = EXPIRY_MS[expiry] ?? EXPIRY_MS["7d"];
  const id = nanoid(8);
  const now = new Date();

  const pastes = await pastesCollection();
  await pastes.insertOne({
    _id: id,
    type,
    content,
    language: type === "code" ? detectLanguage(content) : null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ms),
  });

  redirect(`/paste/${id}?new=1`);
}
