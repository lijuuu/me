import hljs from "highlight.js";
import { codeToHtml } from "shiki";

// highlight.js is only used here for its language guess — proven, widely
// used detector. the actual rendering is shiki's, not hljs's own html output.
export function detectLanguage(content: string): string {
  const result = hljs.highlightAuto(content, [
    "javascript", "typescript", "python", "go", "rust", "java", "c", "cpp",
    "csharp", "ruby", "php", "bash", "shell", "sql", "yaml", "json", "html",
    "css", "markdown", "dockerfile", "plaintext",
  ]);
  return result.language ?? "plaintext";
}

export async function highlightCode(content: string, lang: string): Promise<string> {
  try {
    return await codeToHtml(content, { lang, theme: "github-light" });
  } catch {
    return await codeToHtml(content, { lang: "text", theme: "github-light" });
  }
}
