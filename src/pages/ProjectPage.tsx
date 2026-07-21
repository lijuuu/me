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
        <p className="text-xs lowercase text-[#8892b0]">not found.</p>
        <Link to="/" className="text-xs text-[#64b5f6]">home</Link>
      </main>
    );
  }

  return (
    <>
      <Toc content={project.content} />
      <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16 flex flex-col gap-4 lowercase">
        <h2 className="text-lg font-semibold text-[#e4e8f0]">{project.meta.title}</h2>
        <time className="text-[12px] text-[#4a5578]">{project.meta.date}</time>
        <h3 className="text-[13px] text-[#8892b0]">{project.meta.description}</h3>
        <div
          data-prose
          className="flex flex-col gap-3 text-[13px] leading-[1.55] font-normal
            text-[#8892b0]
            [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-0 [&_h2]:text-[#e4e8f0]
            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-0 [&_h3]:text-[#c8d6e5]
            [&_h3+_p]:mt-0.5
            [&_p]:leading-[1.55]
            [&_a]:underline [&_a]:text-[#64b5f6]
            [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:leading-[1.55] [&_li]:mt-0.5
            [&_code]:text-[11px] [&_code]:bg-[#64b5f6]/[0.08] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[#64b5f6]
            [&_pre]:overflow-x-auto [&_pre]:border-l-[2px] [&_pre]:border-[#64b5f6]/20 [&_pre]:bg-white/[0.015] [&_pre]:p-3 [&_pre]:text-[11px] [&_pre]:leading-[1.45] [&_pre]:text-[#8892b0]
            [&_pre_code]:!text-inherit [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none
            [&_blockquote]:border-l-2 [&_blockquote]:border-[#64b5f6]/15 [&_blockquote]:pl-3 [&_blockquote]:text-[#8892b0]
            [&_hr]:border-[#64b5f6]/[0.08] [&_hr]:my-4
          "
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <Link to="/" className="fixed top-4 left-4 text-xs text-[#4a5578] lowercase hover:text-[#64b5f6]">← home</Link>
      </main>
    </>
  );
}
