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
    <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[20vh] bg-black/[0.03]" onClick={() => { setOpen(false); setQuery(""); }}>
      <div className="bg-white border border-black/[0.08] rounded w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="search blogs..."
          className="w-full bg-transparent text-sm lowercase outline-none text-[#111] placeholder:text-[#888]"
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
                    ? "bg-[#2563eb]/10 text-[#2563eb]"
                    : "text-[#555] hover:bg-black/[0.04]"
                }`}
              >
                {p.meta.title}
                <span className="text-[#888] ml-2">{p.meta.date.split(",")[0]}</span>
              </button>
            ))}
          </div>
        )}
        {debounced && results.length === 0 && (
          <p className="text-xs text-[#888] lowercase px-2 pt-2">no results</p>
        )}
      </div>
    </div>
  );
}
