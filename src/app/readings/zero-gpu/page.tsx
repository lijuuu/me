import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { renderMarkdown } from "../../../lib/markdown";
import Toc from "../../../components/Toc";
import Prose from "../../../components/Prose";

export const metadata = {
  title: "zero-gpu — liju thomas",
  robots: { index: false, follow: false },
};

function getContent(): { title: string; body: string } {
  const filePath = path.join(process.cwd(), "readings", "zero-gpu.md");
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  const match = raw.match(/^#\s+(.+)\n+([\s\S]*)$/);
  if (!match) return { title: "zero-gpu", body: raw };
  return { title: match[1].trim(), body: match[2].trim() };
}

export default function ZeroGpuPage() {
  const { title, body } = getContent();
  const html = renderMarkdown(body);

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 h-20 pointer-events-none z-30"
        style={{
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
        }}
      />
      <Toc content={body} />
      <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16 flex flex-col gap-4 lowercase">
        <h2 className="text-lg font-semibold text-[#111111]">{title}</h2>
        <Prose html={html} />
        <Link href="/" className="fixed top-4 left-4 z-40 text-xs text-[#6b6b6b] lowercase hover:text-[#111111]">← home</Link>
      </main>
    </>
  );
}
