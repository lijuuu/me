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
    <main className="relative z-10 max-w-screen-md px-6 sm:px-8 py-16 flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <img src="/hello_blue_dino.gif" alt="" className="w-14 h-14" />
        <h1 className="text-xl font-semibold lowercase tracking-tight text-[#64b5f6]">
          {SITE.name}
        </h1>
        <p className="text-[13px] lowercase text-[#8892b0] leading-relaxed max-w-md">
          {SITE.bio}
        </p>
        <p className="text-xs text-[#4a5578]">
          {SITE.location} · <ISTClock />
        </p>
        <nav className="flex gap-4 text-[12px] text-[#4a5578] lowercase">
          <a href={SITE.links.github} target="_blank" rel="noopener noreferrer">github</a>
          <a href={SITE.links.linkedin} target="_blank" rel="noopener noreferrer">linkedin</a>
          <a href={SITE.links.twitter} target="_blank" rel="noopener noreferrer">twitter</a>
          <a href={SITE.links.instagram} target="_blank" rel="noopener noreferrer">instagram</a>
          <a href={SITE.links.email}>email</a>
          <Link to="/cv">cv</Link>
          <a href="/feed.xml">rss</a>
        </nav>
      </header>

      <section className="flex flex-col gap-4">
        {SITE.work.map((w, i) => (
          <div key={i} className="flex flex-col gap-1">
            <p className="text-xs text-[#4a5578] lowercase">
              {w.role} at <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-[#64b5f6]">{w.company}</a> · {w.location}, {w.period}
            </p>
            <ul className="flex flex-col gap-0.5">
              {w.lines.map((line, j) => (
                <li key={j} className="text-[13px] text-[#8892b0] lowercase leading-relaxed max-w-lg">{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-[11px] text-[#64b5f6]/60 lowercase font-medium tracking-wider">projects</h2>
        <a href="https://zenx.lijuu.me" target="_blank" rel="noopener noreferrer"
           className="text-sm lowercase font-medium text-[#c8d6e5]">
          zenx — competitive coding platform
        </a>
        <a href="https://github.com/zenxbattle" target="_blank" rel="noopener noreferrer"
           className="text-xs text-[#8892b0] lowercase">
          source code: github.com/zenxbattle
        </a>
        <p className="text-xs text-[#4a5578] lowercase leading-relaxed max-w-lg mt-0.5">
          go, typescript, react, gRPC, nats, docker sandbox, postgres, mongodb, redis, prometheus, grafana, betterstack, aws, gcp, kubernetes
        </p>
      </section>

      {false && <section className="flex flex-col gap-2">
        <h2 className="text-[11px] text-[#64b5f6]/60 lowercase font-medium tracking-wider">writing</h2>
        <div className="flex flex-col gap-3">
        {projects.map(({ meta }) => (
          <article key={meta.slug} className="flex flex-col gap-0.5">
            <time className="text-[10px] text-[#4a5578]/70 lowercase">
              {dayjs(meta.date).format("YYYY MMM DD")}
            </time>
            <Link to={`/blog/${meta.slug}`} className="text-[13px] lowercase font-medium text-[#c8d6e5]">
              {meta.title}
            </Link>
            <p className="text-xs text-[#8892b0] lowercase leading-relaxed max-w-lg">
              {meta.description}
            </p>
          </article>
        ))}
        </div>
      </section>}

      <footer className="text-[11px] text-[#4a5578] lowercase flex flex-col gap-0.5">
        <p>keep it simple</p>
        <p>build, scale, observe. repeat.</p>
      </footer>
    </main>
  );
}
