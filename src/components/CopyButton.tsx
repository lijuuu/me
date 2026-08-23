"use client";

import { useState } from "react";

export default function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs text-[#6b6b6b] hover:text-[#111111] border border-black/10 rounded-sm px-3 py-1"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
