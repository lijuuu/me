export const SITE = {
  name: "liju thomas",
  title: "site reliability engineer",
  location: "kalladikode, kerala, india",
  bio: "site reliability engineer at aion. i build infra, ship fast, and keep things simple. open for side hustles — not in aion's space.",
  links: {
    work: { href: "https://aion.xyz", text: "aion.xyz" },
    internship: { href: "https://brototype.com", text: "brototype" },
    github: "https://github.com/lijuuu",
    linkedin: "https://www.linkedin.com/in/liju-thomas-13ba6524b/",
    twitter: "https://twitter.com/_lijuuu",
    instagram: "https://instagram.com/_lijuuu",
    email: "mailto:lijuthomasliju03@gmail.com",
  },
  work: [
    {
      role: "swe",
      company: "aion.xyz",
      url: "https://aion.xyz",
      period: "2025–ongoing",
      location: "bangalore",
      lines: [
        "building microservice systems in go — api gateways, event-driven services, grpc",
        "sre — observability, incident response, capacity planning, reliability engineering",
        "platform engineering — eks, karpenter autoscaling, gitops with helm + argocd",
        "operating full o11y stack — prometheus, loki distributed, grafana",
      ],
    },
    {
      role: "intern",
      company: "brototype",
      url: "https://brototype.com",
      period: "2024–2025",
      location: "kochi",
      lines: [
        "full stack development — react, node.js, typescript, postgres",
      ],
    },
  ],
} as const;
