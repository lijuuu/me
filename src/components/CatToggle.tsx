import { useEffect, useRef, useState } from "react";

export default function CatToggle() {
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (localStorage.getItem("cat") === "hidden") {
      setVisible(false);
      document.documentElement.setAttribute("data-cat-hidden", "");
    }
  }, []);

  const toggle = () => {
    const next = !visible;
    setVisible(next);
    localStorage.setItem("cat", next ? "" : "hidden");
    if (next) {
      document.documentElement.removeAttribute("data-cat-hidden");
    } else {
      document.documentElement.setAttribute("data-cat-hidden", "");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLElement && e.target.isContentEditable) return;
      if (e.key === "c") {
        const next = !visibleRef.current;
        setVisible(next);
        localStorage.setItem("cat", next ? "" : "hidden");
        if (next) {
          document.documentElement.removeAttribute("data-cat-hidden");
        } else {
          document.documentElement.setAttribute("data-cat-hidden", "");
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      onClick={toggle}
      className={`text-[11px] transition-colors bg-transparent border-0 cursor-pointer lowercase ${
        visible
          ? "text-[#e06b20] dark:text-[#f0853f]"
          : "text-black/20 dark:text-white/15 hover:text-[#e06b20] dark:hover:text-[#f0853f]"
      }`}
    >
      cat
    </button>
  );
}
