import fs from "node:fs";
import path from "node:path";

export interface ProjectMeta {
  title: string;
  description: string;
  slug: string;
  date: string;
  photo?: string;
}

export interface Project {
  meta: ProjectMeta;
  content: string;
}

const projectsDir = path.join(process.cwd(), "_projects");

// Simple frontmatter parser (avoids gray-matter bundling)
function parseFrontmatter(raw: string): { meta: Record<string, any>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta: Record<string, any> = {};
  match[1].split("\n").forEach((line) => {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 1).trim();
      meta[key] = val;
    }
  });
  return { meta, content: match[2].trim() };
}

export function getProjects(): Project[] {
  const projects: Project[] = [];
  const files = fs.readdirSync(projectsDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(projectsDir, file), "utf-8");
    const { meta, content } = parseFrontmatter(raw);
    if (!meta.title || !meta.date || !meta.slug) continue;
    projects.push({ meta: meta as unknown as ProjectMeta, content });
  }
  projects.sort((a, b) => (new Date(a.meta.date) > new Date(b.meta.date) ? -1 : 1));
  return projects;
}

export function getProject(slug: string): Project | undefined {
  return getProjects().find((p) => p.meta.slug === slug);
}
