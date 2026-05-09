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
        <h1 className="text-xl font-semibold lowercase tracking-tight text-[#222] dark:text-[#d4d4d4]">
          {SITE.name}
        </h1>
        <p className="text-xs lowercase text-black/55 dark:text-white/45 leading-relaxed">
          <i>{SITE.title}</i>
          <br />
          <i>swe at <a href={SITE.links.work.href} target="_blank" rel="noopener noreferrer">{SITE.links.work.text}</a> | bangalore · 2025&ndash;ongoing</i>
          <br />
          <i>intern at <a href={SITE.links.internship.href} target="_blank" rel="noopener noreferrer">{SITE.links.internship.text}</a> | kochi · 2024&ndash;2025</i>
        </p>
        <p className="text-xs lowercase text-black/35 dark:text-white/25 leading-relaxed max-w-md">
          {SITE.bio}
        </p>
        <p className="text-sm lowercase text-black/30 dark:text-white/25">
          {SITE.location} · <ISTClock />
        </p>
        <nav className="flex gap-4 text-[12px] text-black/25 dark:text-white/25 lowercase">
          <a href={SITE.links.github} target="_blank" rel="noopener noreferrer">github</a>
          <a href={SITE.links.linkedin} target="_blank" rel="noopener noreferrer">linkedin</a>
          <a href={SITE.links.twitter} target="_blank" rel="noopener noreferrer">twitter</a>
          <a href={SITE.links.instagram} target="_blank" rel="noopener noreferrer">instagram</a>
          <a href={SITE.links.email}>email</a>
          <Link to="/cv" className="text-[#e06b20]/40 dark:text-[#f0853f]/40 hover:text-[#e06b20] dark:hover:text-[#f0853f]">cv</Link>
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
