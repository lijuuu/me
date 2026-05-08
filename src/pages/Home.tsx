import { useEffect, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { Link } from "react-router-dom";
import { getProjects, type Project } from "../data/projects";

dayjs.extend(utc);
dayjs.extend(timezone);

function ISTClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(dayjs().tz ? dayjs().tz("Asia/Kolkata").format("HH:mm") : "");
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  return <span>{time} ist</span>;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    setProjects(getProjects());
  }, []);

  return (
    <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16 flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold lowercase tracking-tight text-[#222] dark:text-[#d4d4d4]">
          liju thomas
        </h1>
        <p className="text-sm lowercase text-black/55 dark:text-white/45 leading-relaxed">
          <i>swe at <a href="https://aion.xyz" target="_blank" rel="noopener noreferrer">aion.xyz</a></i> &middot; generalist
        </p>
        <p className="text-xs lowercase text-black/35 dark:text-white/25 leading-relaxed max-w-md">
          go, distributed systems, react, typescript, k8s, docker, observability. used to write smart contracts. drawn to cybersec. highly minimalist.
        </p>
        <p className="text-sm lowercase text-black/30 dark:text-white/25">
          kalladikode, kerala, india · currently at bangalore · <ISTClock />
        </p>
        <nav className="flex gap-4 text-[12px] text-black/25 dark:text-white/25 lowercase">
          <a href="https://github.com/lijuuu" target="_blank" rel="noopener noreferrer">github</a>
          <a href="https://www.linkedin.com/in/liju-thomas-13ba6524b/" target="_blank" rel="noopener noreferrer">linkedin</a>
          <a href="https://twitter.com/_lijuuu" target="_blank" rel="noopener noreferrer">twitter</a>
          <a href="mailto:lijuthomasliju03@gmail.com">email</a>
          <a href="/feed.xml" className="text-[#e06b20]/40 dark:text-[#f0853f]/40 hover:text-[#e06b20] dark:hover:text-[#f0853f]">rss</a>
        </nav>
      </header>

      <section className="flex flex-col gap-8">
        {projects.map(({ meta }) => (
          <article key={meta.slug} className="flex flex-col gap-1">
            <time className="text-[12px] text-black/25 dark:text-white/20 lowercase">
              {dayjs(meta.date).format("YYYY MMM DD")}
            </time>
            <Link to={`/blog/${meta.slug}`} className="text-base lowercase no-underline hover:text-[#e06b20] dark:hover:text-[#f0853f] font-medium">
              {meta.title}
            </Link>
            <p className="text-sm text-black/45 dark:text-white/30 lowercase leading-relaxed max-w-lg">
              {meta.description}
            </p>
          </article>
        ))}
      </section>

      <footer className="text-[12px] lowercase pt-8 flex flex-col gap-1">
        <p className="text-[#e06b20]/30 dark:text-[#f0853f]/30">keep it simple</p>
        <p className="text-black/20 dark:text-white/15">articles ai-generated, curated by intent.</p>
      </footer>
    </main>
  );
}
