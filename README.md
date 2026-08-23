# me

personal site — portfolio and writing. not open source. all rights reserved.

## stack

- **next.js** (app router) + **react** + **typescript**
- **tailwind css** for styling
- **pnpm** for package management

## run locally

```bash
pnpm install
pnpm dev
```

opens at `http://localhost:3000`.

## build

```bash
pnpm build
pnpm start
```

## structure

```
src/
  app/          — routes (home, blog/[slug], cv)
  components/   — react components (HomeClient, Toc, HeatTextWater)
  data/         — site content, project list
  styles/       — global css
_projects/      — markdown blog posts
public/         — static assets
```
