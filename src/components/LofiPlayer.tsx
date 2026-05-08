import { useEffect, useRef, useState, useCallback } from "react";

const STREAMS = [
  { id: "jfKfPfyJRdk", name: "relax study beats" },
  { id: "4xDzrJKXOOY", name: "synthwave radio" },
  { id: "S_MOd40zlYU", name: "chillhop radio" },
  { id: "9kqnsoY94L8", name: "coding lofi" },
  { id: "wAPCSnAhhC8", name: "rainy beats" },
  { id: "n61ULEU7CO0", name: "tokyo nights" },
  { id: "f02mOEt11OQ", name: "jazzhop cafe" },
  { id: "qYnA9wWFHLI", name: "cyber ambient" },
  { id: "lTRiuFIWV54", name: "vapor chill" },
  { id: "HuFYqnbVbzY", name: "retro electro" },
  { id: "2OEL4P1Rz04", name: "coffee lofi" },
];

export default function LofiPlayer() {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(STREAMS[0]);
  const [menu, setMenu] = useState(false);
  const playerRef = useRef<HTMLIFrameElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // preload on mount
  useEffect(() => {
    if (!playerRef.current) return;
    playerRef.current.src = `https://www.youtube.com/embed/${STREAMS[0].id}?autoplay=0&controls=0&loop=1&mute=1`;
  }, []);

  // close menu on outside click
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const play = useCallback((stream: typeof STREAMS[0]) => {
    if (!playerRef.current) return;
    setCurrent(stream);
    playerRef.current.src = `https://www.youtube.com/embed/${stream.id}?autoplay=1&controls=0&loop=1`;
    setPlaying(true);
    setMenu(false);
  }, []);

  const toggle = () => {
    if (!playing) {
      const src = playerRef.current?.src || "";
      if (src.includes("autoplay=0") || src.includes("youtube")) {
        // already loaded, just resume
        playerRef.current!.src = src.replace("autoplay=0", "autoplay=1").replace("mute=1", "mute=0");
        setPlaying(true);
      } else {
        // no stream loaded, pick random
        play(STREAMS[Math.floor(Math.random() * STREAMS.length)]);
      }
    } else {
      // pause
      if (playerRef.current) {
        playerRef.current.src = playerRef.current.src.replace("autoplay=1", "autoplay=0");
      }
      setPlaying(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 hidden md:flex items-center gap-2 lowercase">
      <div className={`w-1.5 h-1.5 rounded-full ${playing ? "bg-[#e06b20] dark:bg-[#f0853f]" : "bg-black/10 dark:bg-white/10"}`} />
      <button onClick={toggle} className={`text-[11px] bg-transparent border-0 cursor-pointer lowercase ${playing ? "text-[#e06b20] dark:text-[#f0853f]" : "text-black/25 dark:text-white/20 hover:text-[#e06b20] dark:hover:text-[#f0853f]"}`}>
        lofi
      </button>
      {playing && (
        <button onClick={() => play(STREAMS[Math.floor(Math.random() * STREAMS.length)])} className="text-[11px] text-black/20 dark:text-white/15 hover:text-[#e06b20] dark:hover:text-[#f0853f] bg-transparent border-0 cursor-pointer lowercase">
          shuffle
        </button>
      )}
      <button onClick={() => setMenu(!menu)} className="text-[11px] text-black/20 dark:text-white/15 hover:text-[#e06b20] dark:hover:text-[#f0853f] bg-transparent border-0 cursor-pointer lowercase">
        choose
      </button>
      {playing && (
        <span className="text-[10px] text-[#e06b20] dark:text-[#f0853f] max-w-[160px] truncate hidden sm:inline">
          {current.name}
        </span>
      )}

      {menu && (
        <div ref={menuRef} className="absolute bottom-full right-0 mb-2 bg-[#f8f8f5] dark:bg-[#1e1e20] border border-black/[0.06] dark:border-white/[0.06] rounded-lg shadow-xl p-2 flex flex-col gap-0.5 w-[220px]">
          {STREAMS.map((s) => (
            <button
              key={s.id}
              onClick={() => play(s)}
              className={`text-left text-[11px] lowercase px-2 py-1 rounded truncate cursor-pointer ${current.id === s.id && playing ? "text-[#e06b20] dark:text-[#f0853f]" : "text-black/35 dark:text-white/25 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <iframe ref={playerRef} className="absolute opacity-0 pointer-events-none" width="1" height="1" allow="autoplay" title="lofi" />
    </div>
  );
}
