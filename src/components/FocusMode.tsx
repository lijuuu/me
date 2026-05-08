import { useEffect, useState } from "react";

export default function FocusMode() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!on) {
      const el = document.querySelector(".focus-active");
      el?.classList.remove("focus-active");
      document.querySelector("[data-prose]")?.classList.remove("focus-mode");
      return;
    }

    const handle = (e: MouseEvent) => {
      const prose = document.querySelector("[data-prose]");
      if (!prose) return;
      const clicked = (e.target as HTMLElement).closest("p, h2, h3, li, blockquote, pre");
      if (!clicked) return;
      const current = prose.querySelector(".focus-active");
      if (current === clicked) {
        clicked.classList.remove("focus-active");
        prose.classList.remove("focus-mode");
        return;
      }
      current?.classList.remove("focus-active");
      clicked.classList.add("focus-active");
      prose.classList.add("focus-mode");
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOn(false); return; }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const prose = document.querySelector("[data-prose]");
        if (!prose || !prose.classList.contains("focus-mode")) return;
        e.preventDefault();
        const items = Array.from(prose.querySelectorAll("p, h2, h3, li, blockquote, pre")) as HTMLElement[];
        const current = prose.querySelector(".focus-active") as HTMLElement | null;
        const idx = current ? items.indexOf(current) : -1;
        let next: number;
        if (e.key === "ArrowDown") next = idx < items.length - 1 ? idx + 1 : 0;
        else next = idx > 0 ? idx - 1 : items.length - 1;
        current?.classList.remove("focus-active");
        items[next]?.classList.add("focus-active");
        items[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };

    document.addEventListener("click", handle);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", handle);
      document.removeEventListener("keydown", onKey);
    };
  }, [on]);

  return (
    <button
      onClick={() => setOn(!on)}
      className={`text-[11px] lowercase bg-transparent border-0 cursor-pointer transition-colors ${on ? "text-[#e06b20] dark:text-[#f0853f]" : "text-black/20 dark:text-white/15 hover:text-[#e06b20] dark:hover:text-[#f0853f]"}`}
    >
      focus
    </button>
  );
}
