import { marked } from "marked";
import { slugify } from "../utils/slugify";

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

export function renderMarkdown(content: string): string {
  return marked.parse(content) as string;
}
