import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getProjects, type Project } from "../data/projects";

export default function BlogSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const allProjects = useMemo(() => {
    try { return getProjects(); }
    catch { return []; }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 100);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(() => {
    if (!debounced.trim()) return [];
    const q = debounced.toLowerCase();
    return allProjects
      .filter((p) => p && p.meta && p.meta.title)
      .filter((p) =>
        p.meta.title.toLowerCase().includes(q) ||
        (p.meta.description || "").toLowerCase().includes(q)
      ).slice(0, 8);
  }, [debounced, allProjects]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === " " && !open && document.activeElement === document.body) {
        e.preventDefault();
        setOpen(true);
        setQuery("");
        setTimeout(() => inputRef.current?.focus(), 10);
      }
      if (e.key === "Escape") { setOpen(false); setQuery(""); }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open]);

  const select = (slug: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/blog/${slug}`);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[activeIndex]) { select(results[activeIndex].meta.slug); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[20vh] bg-black/[0.03] dark:bg-black/20 backdrop-blur-[0.5px]" onClick={() => { setOpen(false); setQuery(""); }}>
      <div className="bg-[#f8f8f5] dark:bg-[#1e1e20] border border-black/[0.06] dark:border-white/[0.06] rounded-lg w-full max-w-md shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="search blogs..."
          className="w-full bg-transparent text-sm lowercase outline-none text-[#222] dark:text-[#d4d4d4] placeholder:text-black/15 dark:placeholder:text-white/10"
          autoFocus
        />
        {results.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-2">
            {results.map((p, i) => (
              <button
                key={p.meta.slug}
                onClick={() => select(p.meta.slug)}
                className={`text-left text-xs lowercase px-2 py-1.5 rounded truncate cursor-pointer ${
                  i === activeIndex
                    ? "bg-[#e06b20]/10 dark:bg-[#f0853f]/15 text-[#e06b20] dark:text-[#f0853f]"
                    : "text-black/45 dark:text-white/30 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                }`}
              >
                {p.meta.title}
                <span className="text-black/15 dark:text-white/08 ml-2">{p.meta.date.split(",")[0]}</span>
              </button>
            ))}
          </div>
        )}
        {debounced && results.length === 0 && (
          <p className="text-xs text-black/20 dark:text-white/10 lowercase px-2 pt-2">no results</p>
        )}
      </div>
    </div>
  );
}
