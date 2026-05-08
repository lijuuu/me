import { useEffect, useState } from "react";
import FocusMode from "./FocusMode";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [serif, setSerif] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
    const font = localStorage.getItem("font");
    if (font === "mono") {
      setSerif(false);
      document.documentElement.classList.add("mono");
    }
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  const toggleFont = () => {
    const next = !serif;
    setSerif(next);
    localStorage.setItem("font", next ? "" : "mono");
    if (next) {
      document.documentElement.classList.remove("mono");
    } else {
      document.documentElement.classList.add("mono");
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex gap-3 lowercase">
      <button
        onClick={toggleFont}
        className="text-[11px] text-black/20 dark:text-white/15 hover:text-[#e06b20] dark:hover:text-[#f0853f] transition-colors bg-transparent border-0 cursor-pointer lowercase"
      >
        {serif ? "mono" : "serif"}
      </button>
      <button
        onClick={toggleTheme}
        className="text-[11px] text-black/20 dark:text-white/15 hover:text-[#e06b20] dark:hover:text-[#f0853f] transition-colors bg-transparent border-0 cursor-pointer lowercase"
      >
        {dark ? "light" : "dark"}
      </button>
      <FocusMode />
    </div>
  );
}
