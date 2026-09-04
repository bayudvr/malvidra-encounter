# Next.js 16 gotchas

Next.js 16 breaking changes that bit us in malvidra-encounter.

This repo runs Next.js 16.3.4. Differences from older Next:

- **Turbopack is the default** for both `next dev` and `next build`, BUT the Turbopack
  **build** crashes silently on Vercel's build container — dies right after "Running
  next.config.ts", before "Creating an optimized production build", no error in the log.
  Fix (committed): `"build": "next build --webpack"` in package.json. Dev stays on Turbopack.
  With `--webpack`, `next.config.ts` uses the `webpack` key again (we re-added the
  `canvas: false` alias for react-konva). Local webpack build ~50s, works on Vercel.
- Harmless local warning: "Next.js ignored package-lock.json in <parent> … set
  outputFileTracingRoot" — caused by a stray lockfile in `~/Documents/Projects`. Does not
  occur on Vercel; left unset to avoid `__dirname`/`process.cwd()` fragility in the config.
- **`middleware.ts` is deprecated → `proxy.ts`**, exporting `export function proxy()` not
  `middleware()`. Codemod: `npx @next/codemod@canary middleware-to-proxy .` (needs `--force`
  on a dirty tree). `next build` still labels it "Proxy (Middleware)".
- **react-hooks lint rules are errors by default**: `react-hooks/set-state-in-effect` and
  `react-hooks/refs`. We downgraded both to `warn` in `eslint.config.mjs` (they fire on
  legit external-sync effects and prop→state resets). Writing `ref.current = x` during
  render is flagged — do it in an effect.
- `next dev` rewrites the `<!-- BEGIN:nextjs-agent-rules -->` block in `AGENTS.md`; commit it
  with your work to keep the tree clean.
- Root `layout.tsx` from create-next-app uses `LayoutProps<"/">` (typed-routes global).

See [project-overview](project-overview.md).
