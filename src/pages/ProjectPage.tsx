import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { marked } from "marked";
import { getProject, type Project } from "../data/projects";
import Toc from "../components/Toc";

marked.use({
  renderer: {
    heading(text: string, level: number) {
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      return `<h${level} id="${id}">${text}</h${level}>`;
    },
    link(href: string, _title: string | null | undefined, text: string) {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

export default function ProjectPage() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (slug) {
      const p = getProject(slug);
      setProject(p || null);
    }
  }, [slug]);

  const html = useMemo(() => (project ? (marked.parse(project.content) as string) : ""), [project]);

  if (!project) {
    return (
      <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16">
        <p className="text-sm lowercase text-black/55 dark:text-white/45">not found.</p>
        <Link to="/" className="text-xs underline">home</Link>
      </main>
    );
  }

  return (
    <>
      <Toc content={project.content} />
      <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16 flex flex-col gap-6 lowercase">
        <h2 className="text-lg font-semibold text-[#222] dark:text-[#d4d4d4]">{project.meta.title}</h2>
        <time className="text-[12px] text-black/25 dark:text-white/20">{project.meta.date}</time>
        <h3 className="text-sm text-black/45 dark:text-white/30">{project.meta.description}</h3>
        <div
          data-prose
          className="flex flex-col gap-4 text-sm leading-relaxed font-normal
            text-black/70 dark:text-white/55
            [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-1 [&_h2]:text-[#222] dark:[&_h2]:text-[#d4d4d4]
            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-black/80 dark:[&_h3]:text-white/65
            [&_p]:leading-[1.4]
            [&_a]:underline
            [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:leading-[1.4]
            [&_code]:text-[12px] [&_code]:bg-[#e06b20]/[0.06] dark:[&_code]:bg-[#f0853f]/[0.08] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[#e06b20] dark:[&_code]:text-[#f0853f]
            [&_pre]:overflow-x-auto [&_pre]:border-l-[3px] [&_pre]:border-[#e06b20]/20 dark:[&_pre]:border-[#f0853f]/20 [&_pre]:bg-black/[0.02] dark:[&_pre]:bg-white/[0.02] [&_pre]:p-3 [&_pre]:text-[12px] [&_pre]:leading-relaxed [&_pre]:text-black/55 dark:[&_pre]:text-white/40
            [&_pre_code]:!text-inherit [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none
            [&_blockquote]:border-l-2 [&_blockquote]:border-black/[0.08] dark:[&_blockquote]:border-white/[0.08] [&_blockquote]:pl-3 [&_blockquote]:text-black/40 dark:[&_blockquote]:text-white/25
            [&_table]:text-[12px] [&_table]:w-full [&_th]:text-left [&_th]:font-semibold [&_th]:pb-1 [&_td]:pb-1 [&_td]:text-black/45 dark:[&_td]:text-white/30
            [&_hr]:border-black/[0.06] dark:[&_hr]:border-white/[0.06] [&_hr]:my-4
          "
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <Link to="/" className="fixed top-4 left-4 z-50 text-xs text-[#e06b20]/30 dark:text-[#f0853f]/30 hover:text-[#e06b20] dark:hover:text-[#f0853f] lowercase no-underline">← home</Link>
        <p className="text-[11px] text-black/15 dark:text-white/12 lowercase pt-4">ai-generated content, curated by intent.</p>
      </main>
    </>
  );
}
