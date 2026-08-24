"use client";

import { useEffect, useState, useRef, Suspense, lazy, type PointerEvent } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import Link from "next/link";
import type { Project } from "../data/projects";
import { SITE } from "../data/site";

const HeatTextWater = lazy(() => import("./HeatTextWater"));

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

function BioText() {
  return (
    <p className="text-[13px] lowercase text-[#444444] leading-relaxed max-w-md">
      {SITE.bio.map((line, i) => (
        <span key={i}>
          {line}
          {i < SITE.bio.length - 1 && <br />}
        </span>
      ))}
    </p>
  );
}

// runs the WebGL shader compile/init off the critical rendering path: it's a
// genuinely expensive main-thread task (~1.8s), so it waits for the browser
// to be idle before mounting instead of blocking interactivity right away.
function useIdle() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const ric = (window as any).requestIdleCallback as ((cb: () => void) => number) | undefined;
    const cancel = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
    const id = ric ? ric(() => setIdle(true)) : window.setTimeout(() => setIdle(true), 300);
    return () => {
      if (ric && cancel) cancel(id);
      else window.clearTimeout(id);
    };
  }, []);
  return idle;
}

function DraggableAvatar() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const [matched, setMatched] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const dragging_ = useRef(false);
  const start = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const anchorRef = useRef<HTMLDivElement>(null);

  const showGuides = active && !matched;

  const onPointerDown = (e: PointerEvent<HTMLImageElement>) => {
    const el = anchorRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    dragging_.current = true;
    setActive(true);
    start.current = { x: pos.x, y: pos.y, px: e.clientX, py: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLImageElement>) => {
    if (!dragging_.current) return;
    const nx = start.current.x + (e.clientX - start.current.px);
    const ny = start.current.y + (e.clientY - start.current.py);
    setPos({ x: nx, y: ny });
    setMatched(Math.round(nx) === 0 && Math.round(ny) === 0);
  };
  const onPointerUp = () => {
    dragging_.current = false;
  };

  const crosshairX = origin.x + pos.x;
  const crosshairY = origin.y + pos.y;

  return (
    <>
      {showGuides && (
        <div className="fixed inset-0 z-10 pointer-events-none">
          <div
            style={{
              position: "absolute",
              left: 0,
              top: crosshairY,
              width: "100%",
              height: 1,
              background:
                "repeating-linear-gradient(to right, rgba(51,85,238,0.35) 0 4px, transparent 4px 8px)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: crosshairX,
              width: 1,
              height: "100%",
              background:
                "repeating-linear-gradient(to bottom, rgba(51,85,238,0.35) 0 4px, transparent 4px 8px)",
            }}
          />
        </div>
      )}
      <div ref={anchorRef} className="relative z-20 w-[88px] h-[88px]">
        {showGuides && (
          <div className="absolute inset-0 border border-dashed border-black/30 rounded-sm pointer-events-none" />
        )}
        <div style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }} className="relative w-[88px] h-[88px]">
          <img
            src="/avatar.webp"
            alt=""
            width={88}
            height={88}
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{ touchAction: "none" }}
            className="w-[88px] h-[88px] rounded-sm object-cover shadow-[0_4px_16px_rgba(17,17,17,0.18)] cursor-grab active:cursor-grabbing select-none"
          />
          {showGuides && (
            <div className="absolute top-full left-0 w-full mt-1.5 text-[10px] leading-none text-[#3355ee] pointer-events-none whitespace-nowrap">
              x {Math.round(pos.x)} y {Math.round(pos.y)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function HomeClient({ projects }: { projects: Project[] }) {
  const shimmerReady = useIdle();

  return (
    <>
    <main className="relative z-10 max-w-screen-md px-6 sm:px-8 pt-16 pb-16 flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <DraggableAvatar />
        <h1 className="text-xl font-bold lowercase tracking-tight text-[#111111]">
          {SITE.name}
        </h1>
        {shimmerReady ? (
        <Suspense fallback={<BioText />}>
          <HeatTextWater
            lines={[...SITE.bio]}
            fontSize={13}
            fontWeight={400}
            color="#444444"
            backgroundColor="#ececec"
            waves={0.022}
            caustic={0.009}
            layering={0.018}
            size={0.8}
            speed={0.5}
            blur={0.5}
          />
        </Suspense>
        ) : (
          <BioText />
        )}
        <p className="text-xs text-[#6b6b6b]">
          {SITE.location} · <ISTClock />
        </p>
        <nav className="flex gap-4 text-[12px] text-[#6b6b6b] lowercase">
          <a href={SITE.links.github} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5 -my-1.5">github</a>
          <a href={SITE.links.linkedin} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5 -my-1.5">linkedin</a>
          <a href={SITE.links.twitter} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5 -my-1.5">twitter</a>
          <a href={SITE.links.instagram} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5 -my-1.5">instagram</a>
          <a href={SITE.links.email} className="inline-block py-1.5 -my-1.5">email</a>
          <Link href="/cv" className="inline-block py-1.5 -my-1.5">cv</Link>
        </nav>
      </header>

      <section className="flex flex-col gap-2 pt-6 border-t border-dashed border-black/12">
        <h2 className="text-[11px] text-[#111111]/60 lowercase font-medium tracking-wider">work</h2>
        <div className="flex flex-col gap-3">
        {SITE.work.map((w, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <p className="text-xs text-[#6b6b6b] lowercase">
              {w.role} at <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-[#111111]">{w.company}</a> · {w.location}, {w.period}
            </p>
            <ul className="flex flex-col gap-0.5">
              {w.lines.map((line, j) => (
                <li key={j} className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
                  <span aria-hidden="true">-</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        </div>
      </section>

      <section className="flex flex-col gap-2 pt-6 border-t border-dashed border-black/12">
        <h2 className="text-[11px] text-[#111111]/60 lowercase font-medium tracking-wider">projects</h2>
        <div className="flex flex-col gap-4">

        <div className="flex flex-col gap-0.5">
          <a href="https://zenx.lijuu.me" target="_blank" rel="noopener noreferrer"
             className="inline-block py-1.5 -my-1.5 text-sm lowercase font-medium text-[#1a1a1a]">
            zenx — competitive coding platform
          </a>
          <a href="https://github.com/zenxbattle" target="_blank" rel="noopener noreferrer"
             className="inline-block py-1.5 -my-1.5 text-xs text-[#444444] lowercase">
            source code: github.com/zenxbattle
          </a>
          <p className="text-xs text-[#6b6b6b] lowercase leading-relaxed max-w-lg">
            go, typescript, react, gRPC, nats, docker sandbox, postgres, mongodb, redis, prometheus, grafana, aws, gcp, kubernetes
          </p>
          <ul className="flex flex-col gap-0.5 mt-1">
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>api gateway: go + gin, the single rest entrypoint proxying grpc to every service, with prometheus metrics, ip-based rate limiting, and a ristretto cache used as a jwt blacklist store</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>auth &amp; user service: grpc, postgres via gorm, redis session cache, jwt issuance and rotation, totp-based 2fa, role-based admin controls</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>problem service: mongodb for problems and test cases, redis cache, nats for async solution validation, redisboard for problem-level leaderboards</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>code execution engine: docker-sandboxed judging for python, javascript, c++, and go, dispatched through a nats-driven worker pool</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>challenge service: local in-process state for live battles, redis-backed shared state, leaderboard backed via redisboard (sorted linkedlists), reads fall back to mongo once a challenge's been archived, graceful shutdown flushes completed challenges to mongo for permanent history and snapshots current matches in redis to .rdb</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>frontend: react 19, vite, typescript, shadcn/ui, a real-time battle arena over websockets using a dispatch pattern</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>commonproto: a global proto store, the single source of truth for every service's grpc contracts</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>infra: terraform for cloud bootstrap and core (vpc, ecr, route53, eks), k3s + kustomize on-prem, argocd gitops, prometheus/grafana monitoring</span>
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-0.5">
          <a href="https://github.com/lijuuu/RedisBoard" target="_blank" rel="noopener noreferrer"
             className="inline-block py-1.5 -my-1.5 text-sm lowercase font-medium text-[#1a1a1a]">
            redisboard — redis-backed leaderboard library
          </a>
          <a href="https://github.com/lijuuu/RedisBoard" target="_blank" rel="noopener noreferrer"
             className="inline-block py-1.5 -my-1.5 text-xs text-[#444444] lowercase">
            source code: github.com/lijuuu/redisboard
          </a>
          <p className="text-xs text-[#6b6b6b] lowercase leading-relaxed max-w-lg">
            go, redis
          </p>
          <ul className="flex flex-col gap-0.5 mt-1">
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>atomic, pipelined score updates and o(log n) top-k / rank queries over redis sorted sets</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>namespaced per leaderboard, built to scale to ~1m users and 200 entities</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>the leaderboard engine behind zenx's problem and challenge services</span>
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-0.5">
          <a href="https://github.com/lijuuu/FoodBuddyMonolithBackend" target="_blank" rel="noopener noreferrer"
             className="inline-block py-1.5 -my-1.5 text-sm lowercase font-medium text-[#1a1a1a]">
            foodbuddy — food ordering & restaurant platform
          </a>
          <a href="https://github.com/lijuuu/FoodBuddyMonolithBackend" target="_blank" rel="noopener noreferrer"
             className="inline-block py-1.5 -my-1.5 text-xs text-[#444444] lowercase">
            source code: github.com/lijuuu/foodbuddymonolithbackend
          </a>
          <p className="text-xs text-[#6b6b6b] lowercase leading-relaxed max-w-lg">
            go, gin, mysql, gorm, grpc, docker, kubernetes
          </p>
          <ul className="flex flex-col gap-0.5 mt-1">
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>started as a go + gin monolith: gorm/mysql, google oauth, jwt sessions, stripe + razorpay payments, cloudinary uploads, smtp notifications</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>re-architected into grpc microservices (api gateway, user, restaurant + product, order + cart, admin auth), with a centralized proto repo as the shared contract source</span>
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-0.5">
          <a href="https://github.com/lijuuu/shrtn" target="_blank" rel="noopener noreferrer"
             className="inline-block py-1.5 -my-1.5 text-sm lowercase font-medium text-[#1a1a1a]">
            shrtn — a url shortener built to scale
          </a>
          <a href="https://github.com/lijuuu/shrtn" target="_blank" rel="noopener noreferrer"
             className="inline-block py-1.5 -my-1.5 text-xs text-[#444444] lowercase">
            source code: github.com/lijuuu/shrtn
          </a>
          <p className="text-xs text-[#6b6b6b] lowercase leading-relaxed max-w-lg">
            python, django, postgres, redis, scylladb
          </p>
          <ul className="flex flex-col gap-0.5 mt-1">
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>postgres for entity data: users, organizations, namespaces, url metadata</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>redis as a cache layer in front of the hot paths</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>scylladb holds the short-url lookup table itself, since resolving a short code is the highest-read path by far</span>
            </li>
            <li className="flex gap-1.5 text-[13px] text-[#444444] lowercase leading-relaxed max-w-2xl">
              <span aria-hidden="true">-</span>
              <span>partitioned by (namespace, shortcode), a single-partition-key lookup with predictable routing per redirect, plus a separate click-analytics table clustered by date, since scylla's wide-column model is well suited to high-volume, append-heavy event workloads</span>
            </li>
          </ul>
        </div>

        </div>
      </section>

      <section className="flex flex-col gap-2 pt-6 border-t border-dashed border-black/12">
        <h2 className="text-[11px] text-[#111111]/60 lowercase font-medium tracking-wider">writing</h2>
        <div className="flex flex-col gap-3">
        {projects.map(({ meta }) => (
          <article key={meta.slug} className="flex flex-col gap-0.5">
            <time className="text-[10px] text-[#6b6b6b] lowercase">
              {dayjs(meta.date).format("YYYY MMM DD")}
            </time>
            <Link href={`/blog/${meta.slug}`} className="inline-block py-1.5 -my-1.5 text-[13px] lowercase font-medium text-[#1a1a1a]">
              {meta.title}
            </Link>
            <p className="text-xs text-[#444444] lowercase leading-relaxed max-w-lg">
              {meta.description}
            </p>
          </article>
        ))}
        </div>
      </section>

    </main>
    </>
  );
}
