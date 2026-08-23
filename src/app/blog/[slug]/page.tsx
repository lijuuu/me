import Link from "next/link";
import { getProject, getProjects } from "../../../data/projects";
import { renderMarkdown } from "../../../lib/markdown";
import Toc from "../../../components/Toc";
import Prose from "../../../components/Prose";

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

  const html = renderMarkdown(project.content);

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
        <Prose html={html} />
        <Link href="/" className="fixed top-4 left-4 z-40 text-xs text-[#6b6b6b] lowercase hover:text-[#111111]">← home</Link>
      </main>
    </>
  );
}
