import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { marked } from "marked";
import { getProject, type Project } from "../data/projects";
import { slugify } from "../utils/slugify";
import Toc from "../components/Toc";

marked.use({
  renderer: {
    heading(text: string, level: number) {
      const id = slugify(text);
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
        <p className="text-sm lowercase text-white/60">not found.</p>
        <Link to="/" className="text-xs underline">home</Link>
      </main>
    );
  }

  return (
    <>
      <Toc content={project.content} />
      <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16 flex flex-col gap-6 lowercase">
        <h2 className="text-lg font-semibold text-white">{project.meta.title}</h2>
        <time className="text-[12px] text-white/35">{project.meta.date}</time>
        <h3 className="text-sm text-white/60">{project.meta.description}</h3>
        <div
          data-prose
          className="flex flex-col gap-4 text-sm leading-relaxed font-normal
            text-white/55
            [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-0 [&_h2]:text-white
            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-0 [&_h3]:text-white/80
            [&_h3+_p]:mt-0.5
            [&_p]:leading-[1.4]
            [&_a]:underline
            [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:leading-[1.4]
            [&_code]:text-[12px] [&_code]:bg-[#6B9FFF]/[0.10] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[#6B9FFF]
            [&_pre]:overflow-x-auto [&_pre]:border-l-[3px] [&_pre]:border-[#6B9FFF]/20 [&_pre]:bg-white/[0.03] [&_pre]:p-3 [&_pre]:text-[12px] [&_pre]:leading-relaxed [&_pre]:text-white/50
            [&_pre_code]:!text-inherit [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none
            [&_blockquote]:border-l-2 [&_blockquote]:border-white/[0.08] [&_blockquote]:pl-3 [&_blockquote]:text-white/40
            [&_table]:text-[12px] [&_table]:w-full [&_th]:text-left [&_th]:font-semibold [&_th]:pb-1 [&_td]:pb-1 [&_td]:text-white/50
            [&_hr]:border-white/[0.08] [&_hr]:my-4
          "
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <Link to="/" className="fixed top-4 left-4 z-50 text-xs text-[#6B9FFF]/60 hover:text-[#6B9FFF] lowercase no-underline">← home</Link>
        <p className="text-[11px] text-white/35 lowercase pt-4">build, scale, observe. repeat.</p>
      </main>
    </>
  );
}
