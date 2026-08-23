"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MyPasteEntry } from "./TrackPaste";

export default function MyPastes() {
  const [pastes, setPastes] = useState<MyPasteEntry[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("myPastes");
      setPastes(raw ? JSON.parse(raw) : []);
    } catch {
      setPastes([]);
    }
  }, []);

  if (!pastes || pastes.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] text-[#111111]/60 lowercase font-medium tracking-wider">your pastes</p>
      <ul className="flex flex-col gap-0.5">
        {pastes.map((p) => (
          <li key={p.id} className="text-xs text-[#444444]">
            <Link href={`/paste/${p.id}`} className="inline-block py-1 -my-1 normal-case hover:text-[#111111]">
              {p.id}
            </Link>
            <span className="text-[#6b6b6b]"> · {p.type} · {new Date(p.createdAt).toISOString().slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
