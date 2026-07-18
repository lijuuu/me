import { useEffect, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { Link } from "react-router-dom";
import { getProjects, type Project } from "../data/projects";
import { SITE } from "../data/site";

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
        <h1 className="text-xl font-semibold lowercase tracking-tight text-[#4A8BFF]">
          {SITE.name}
        </h1>
        <p className="text-xs lowercase text-white/60 leading-relaxed">
          <i>{SITE.title}</i>
        </p>
        <p className="text-xs lowercase text-white/35 leading-relaxed max-w-md">
          {SITE.bio}
        </p>
        <p className="text-sm lowercase text-white/35">
          {SITE.location} · <ISTClock />
        </p>
        <nav className="flex gap-4 text-[12px] text-white/35 lowercase">
          <a href={SITE.links.github} target="_blank" rel="noopener noreferrer">github</a>
          <a href={SITE.links.linkedin} target="_blank" rel="noopener noreferrer">linkedin</a>
          <a href={SITE.links.twitter} target="_blank" rel="noopener noreferrer">twitter</a>
          <a href={SITE.links.instagram} target="_blank" rel="noopener noreferrer">instagram</a>
          <a href={SITE.links.email}>email</a>
          <Link to="/cv" className="text-[#6B9FFF]/60 hover:text-[#6B9FFF]">cv</Link>
          <a href="/feed.xml" className="text-[#6B9FFF]/60 hover:text-[#6B9FFF]">rss</a>
        </nav>
      </header>

      <section className="flex flex-col gap-6">
        {SITE.work.map((w, i) => (
          <div key={i} className="flex flex-col gap-1">
            <p className="text-xs text-white/35 lowercase">
              {w.role} at <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-[#4A8BFF]">{w.company}</a> | {w.location} · {w.period}
            </p>
            <ul className="flex flex-col gap-0.5">
              {w.lines.map((line, j) => (
                <li key={j} className="text-xs text-white/60 lowercase leading-relaxed max-w-lg">{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[12px] text-[#4A8BFF]/80 lowercase font-medium">projects</h2>
        <a href="https://zenx.lijuu.me" target="_blank" rel="noopener noreferrer"
           className="text-base lowercase no-underline hover:text-[#4A8BFF] font-medium text-white/80">
          zenx — competitive coding platform
        </a>
        <a href="https://github.com/zenxbattle" target="_blank" rel="noopener noreferrer"
           className="text-sm text-white/60 lowercase no-underline hover:text-[#6B9FFF]">
          source code: github.com/zenxbattle
        </a>
        <p className="text-sm text-white/60 lowercase leading-relaxed max-w-lg">
          go, typescript, react, gRPC, nats, docker sandbox, postgres, mongodb, redis, prometheus, grafana, betterstack, aws, gcp, kubernetes
        </p>
      </section>

      <footer className="text-[12px] lowercase pt-8 flex flex-col gap-1">
        <p className="text-[#4A8BFF]/60">keep it simple</p>
        <p className="text-white/35">build, scale, observe. repeat.</p>
      </footer>
    </main>
  );
}
