"use client";

import { useEffect } from "react";

const KEY = "myPastes";
const MAX_ENTRIES = 50;

export interface MyPasteEntry {
  id: string;
  type: "markdown" | "code";
  createdAt: string;
}

export default function TrackPaste({ id, type, createdAt }: MyPasteEntry) {
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const list: MyPasteEntry[] = raw ? JSON.parse(raw) : [];
      if (list.some((p) => p.id === id)) return;
      const next = [{ id, type, createdAt }, ...list].slice(0, MAX_ENTRIES);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode etc.) — skip silently
    }
  }, [id, type, createdAt]);

  return null;
}
