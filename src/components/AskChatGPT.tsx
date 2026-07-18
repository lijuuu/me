import { useEffect, useState, useRef } from "react";
import { useLocation } from "react-router-dom";

export default function AskChatGPT() {
  const [pos, setPos] = useState({ x: 0, y: 0, visible: false });
  const textRef = useRef("");
  const { pathname } = useLocation();

  const isBlog = pathname.startsWith("/blog/");

  useEffect(() => {
    if (!isBlog) return;
    const handle = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        const t = sel?.toString().trim();
        if (!t || t.length < 3) {
          setPos((p) => ({ ...p, visible: false }));
          return;
        }
        const range = sel!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        textRef.current = t.slice(0, 500);
        const btnW = 80;
        const x = Math.min(rect.right + 8, window.innerWidth - btnW - 8);
        setPos({ x, y: rect.top + rect.height / 2, visible: true });
      }, 0);
    };

    document.addEventListener("mouseup", handle);
    document.addEventListener("touchend", handle);
    return () => {
      document.removeEventListener("mouseup", handle);
      document.removeEventListener("touchend", handle);
    };
  }, [isBlog]);

  if (!isBlog || !pos.visible) return null;

  return (
    <button
      onClick={() => {
        window.open(`https://chatgpt.com/?q=${encodeURIComponent(textRef.current)}`, "_blank");
        setPos((p) => ({ ...p, visible: false }));
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[9998] text-[11px] lowercase text-[#2563eb] bg-white border border-[#2563eb]/20 rounded px-2 py-0.5 hover:bg-[#2563eb] hover:text-white cursor-pointer"
      style={{ left: pos.x, top: pos.y, transform: "translateY(-50%)" }}
    >
      ask chatgpt
    </button>
  );
}
