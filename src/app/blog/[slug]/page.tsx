import { marked } from "marked";
import Link from "next/link";
import { getProject, getProjects } from "../../../data/projects";
import { slugify } from "../../../utils/slugify";
import Toc from "../../../components/Toc";

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

export function generateStaticParams() {
  return getProjects().map((p) => ({ slug: p.meta.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return {};
  return {
    title: `${project.meta.title} — liju thomas`,
    description: project.meta.description,
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = getProject(slug);

  if (!project) {
    return (
      <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16">
        <p className="text-xs lowercase text-[#444444]">not found.</p>
        <Link href="/" className="text-xs text-[#111111]">home</Link>
      </main>
    );
  }

  const html = marked.parse(project.content) as string;

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
      <Toc content={project.content} />
      <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16 flex flex-col gap-4 lowercase">
        <h2 className="text-lg font-semibold text-[#111111]">{project.meta.title}</h2>
        <time className="text-[12px] text-[#6b6b6b]">{project.meta.date}</time>
        <h3 className="text-[13px] text-[#444444]">{project.meta.description}</h3>
        <div
          data-prose
          className="flex flex-col gap-3 text-[13px] leading-[1.55] font-normal
            text-[#444444]
            [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-0 [&_h2]:text-[#111111]
            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-0 [&_h3]:text-[#1a1a1a]
            [&_h3+_p]:mt-0.5
            [&_p]:leading-[1.55]
            [&_a]:underline [&_a]:text-[#111111]
            [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:leading-[1.55] [&_li]:mt-0.5
            [&_code]:text-[11px] [&_code]:bg-[#111111]/[0.08] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[#111111]
            [&_pre]:overflow-x-auto [&_pre]:border-l-[2px] [&_pre]:border-[#111111]/20 [&_pre]:bg-white/[0.015] [&_pre]:p-3 [&_pre]:text-[11px] [&_pre]:leading-[1.45] [&_pre]:text-[#444444]
            [&_pre_code]:!text-inherit [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none
            [&_blockquote]:border-l-2 [&_blockquote]:border-[#111111]/15 [&_blockquote]:pl-3 [&_blockquote]:text-[#444444]
            [&_hr]:border-[#111111]/[0.08] [&_hr]:my-4
            [&_img]:w-full [&_img]:rounded-sm [&_img]:my-2
          "
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <Link href="/" className="fixed top-4 left-4 z-40 text-xs text-[#6b6b6b] lowercase hover:text-[#111111]">← home</Link>
      </main>
    </>
  );
}
