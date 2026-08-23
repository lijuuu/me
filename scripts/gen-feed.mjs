import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_URL = "https://lijuu.me";
const projectsDir = path.resolve(import.meta.dirname, "../_projects");
const outFile = path.resolve(import.meta.dirname, "../public/feed.xml");

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return meta;
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const posts = readdirSync(projectsDir)
  .filter((f) => f.endsWith(".md"))
  .map((f) => parseFrontmatter(readFileSync(path.join(projectsDir, f), "utf-8")))
  .filter((meta) => meta?.title && meta?.date && meta?.slug)
  .sort((a, b) => (new Date(a.date) > new Date(b.date) ? -1 : 1));

const lastBuildDate = new Date().toUTCString();

const items = posts
  .map((meta) => {
    const link = `${SITE_URL}/blog/${meta.slug}`;
    const pubDate = new Date(meta.date).toUTCString();
    return `    <item>
      <title>${escapeXml(meta.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description><![CDATA[${meta.description ?? ""}]]></description>
      <pubDate>${pubDate}</pubDate>
    </item>`;
  })
  .join("\n");

const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>liju thomas</title>
    <link>${SITE_URL}</link>
    <description>site reliability engineer — infra, go, distributed systems.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>${SITE_URL}/favicon.ico</url>
      <title>liju thomas</title>
      <link>${SITE_URL}</link>
    </image>
${items}
  </channel>
</rss>
`;

writeFileSync(outFile, xml);
console.log(`feed.xml generated with ${posts.length} post(s)`);
