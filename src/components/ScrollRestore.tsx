import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SCROLL_KEY = "scroll-pos";

export default function ScrollRestore() {
  const { pathname } = useLocation();

  // restore scroll on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY + pathname);
    if (saved) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, [pathname]);

  // save scroll before navigating away
  useEffect(() => {
    const save = () => {
      sessionStorage.setItem(SCROLL_KEY + pathname, String(window.scrollY));
    };
    window.addEventListener("beforeunload", save);
    window.addEventListener("scroll", () => {
      // debounced save on scroll
      clearTimeout((window as any).__scrollTimer);
      (window as any).__scrollTimer = setTimeout(() => {
        sessionStorage.setItem(SCROLL_KEY + pathname, String(window.scrollY));
      }, 200);
    });
    return () => {
      window.removeEventListener("beforeunload", save);
      clearTimeout((window as any).__scrollTimer);
    };
  }, [pathname]);

  return null;
}
