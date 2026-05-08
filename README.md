# me

personal site — portfolio, writing, and a cat that toggles dark mode. not open source. all rights reserved.

## stack

- **vite** + **react** + **typescript**
- **tailwind css** for styling
- **pnpm** for package management

## run locally

```bash
pnpm install
pnpm dev
```

opens at `http://localhost:5173`.

## build

```bash
pnpm build
# output in dist/
```

## structure

```
src/
  components/   — react components (Cat, ThemeToggle, BlogSearch, etc.)
  pages/        — home page, project page
  data/         — project list
  styles/       — global css
_projects/      — markdown blog posts
public/         — static assets
```
