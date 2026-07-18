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
      className={`text-[11px] bg-transparent border-0 cursor-pointer lowercase ${
        visible
          ? "text-[#2563eb]"
          : "text-[#888] hover:text-[#2563eb]"
      }`}
    >
      cat
    </button>
  );
}
