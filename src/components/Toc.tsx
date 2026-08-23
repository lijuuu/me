import { useEffect, useState } from "react";
import { slugify } from "../utils/slugify";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

export default function Toc({ content }: { content: string }) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const headings: TocItem[] = [];
    const regex = /^(#{2,3})\s+(.+)$/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
      headings.push({
        id: slugify(match[2]),
        text: match[2],
        level: match[1].length,
      });
    }
    setItems(headings);
  }, [content]);

  useEffect(() => {
    if (items.length === 0) return;

    const headingEls = items.map((h) => document.getElementById(h.id)).filter(Boolean) as HTMLElement[];

    const findActive = () => {
      const scrollTop = window.scrollY + 120;
      const docBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.body.scrollHeight;

      // if near bottom of page, highlight last heading
      if (docBottom >= pageBottom - 10) {
        setActive(items[items.length - 1].id);
        return;
      }

      for (let i = headingEls.length - 1; i >= 0; i--) {
        if (headingEls[i].offsetTop <= scrollTop) {
          setActive(items[i].id);
          return;
        }
      }
      setActive(items[0]?.id || "");
    };

    findActive();
    window.addEventListener("scroll", findActive, { passive: true });
    return () => window.removeEventListener("scroll", findActive);
  }, [items]);

  const scrollTo = (id: string) => {
    setActive(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  if (items.length < 3) return null;

  return (
    <nav className="hidden xl:block fixed right-8 top-24 w-48 text-[12px] leading-relaxed lowercase">
      <p className="text-[#6b6b6b] mb-3">on this page</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((h) => (
          <li key={h.id} style={{ paddingLeft: h.level === 3 ? "12px" : "0" }}>
              <a
                href={`#${h.id}`}
                onClick={(e) => { e.preventDefault(); scrollTo(h.id); }}
                className={`no-underline hover:underline block truncate ${
                  active === h.id
                    ? "text-[#111111]"
                    : "text-[#6b6b6b]"
                }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
