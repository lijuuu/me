import Link from "next/link";
import { pastesCollection } from "../../../lib/mongodb";
import { renderMarkdown } from "../../../lib/markdown";
import { highlightCode } from "../../../lib/highlight";
import Prose from "../../../components/Prose";
import CopyButton from "../../../components/CopyButton";

export const dynamic = "force-dynamic";

export default async function PasteViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pastes = await pastesCollection();
  const paste = await pastes.findOne({ _id: id });

  if (!paste || paste.expiresAt < new Date()) {
    return (
      <main className="relative z-10 max-w-screen-md px-6 sm:px-8 pt-16 pb-16 lowercase">
        <p className="text-xs text-[#444444]">not found, or this paste has expired.</p>
        <Link href="/paste" className="text-xs text-[#111111]">new paste</Link>
      </main>
    );
  }

  return (
    <main className="relative z-10 max-w-screen-md px-6 sm:px-8 pt-16 pb-16 flex flex-col gap-4 lowercase">
      <Link href="/" className="fixed top-4 left-4 z-40 text-xs text-[#6b6b6b] lowercase hover:text-[#111111]">← home</Link>
      <div className="fixed top-4 right-4 z-40">
        <CopyButton content={paste.content} />
      </div>
      <p className="text-xs text-[#6b6b6b]">
        {paste.type}
        {paste.language ? ` · ${paste.language}` : ""} · expires {paste.expiresAt.toISOString().slice(0, 10)}
      </p>

      {paste.type === "markdown" ? (
        <Prose html={renderMarkdown(paste.content)} />
      ) : (
        <div
          className="text-[13px] leading-[1.55] [&_pre]:overflow-x-auto [&_pre]:border-l-[2px] [&_pre]:border-[#111111]/20 [&_pre]:rounded-sm [&_pre]:p-3"
          dangerouslySetInnerHTML={{ __html: await highlightCode(paste.content, paste.language ?? "text") }}
        />
      )}
    </main>
  );
}
