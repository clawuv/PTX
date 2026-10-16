# Renderer CSS guidelines

Decision (2026-10): the pi-desktop token-framework adoption — Tailwind CSS 4
as a token/utility engine plus a layered `tokens.css` — was prototyped and
deliberately reverted. A full-surface migration has no functional payoff
today, and pi-desktop itself keeps semantic class names rather than
utility-first components. Adoption is deferred until a feature needs it; the
rules below keep the codebase ready for that day without paying for it now.

## Rules

- Styles live in per-surface files under `src/styles/`, imported in cascade
  order from `src/styles.css`. Components use semantic class names, not
  utility classes.
- Theme tokens (colors, shadows, the conversation frame width) live in the
  `:root` / `:root[data-theme="dark"]` blocks at the top of
  `src/styles/base.css`. Component CSS consumes them via `var(--token)` and
  never hardcodes theme-dependent colors.
- New code reuses the values already dominant on its surface. When a file is
  touched for real work, snap its font sizes, radii, and weights toward the
  steps already present there instead of introducing new ones (font sizes
  cluster on a half-pixel rhythm around the 13px base; weights on
  400/500/600/700).
- Fixed identity colors (harness marks in `controls.css`, welcome hero-card
  icons) stay constant across themes, like the harness brand marks.

## Triggers that reverse the decision

Adopt the token framework (model: pi-desktop `apps/desktop/src/styles/tokens.css`
— a `@theme`-registered scale consumed by both plain CSS `var()` reads and
Tailwind utilities) when any of these land:

1. **Font-size zoom / accessibility scaling** — the whole type ramp must sit
   on tokens multiplied by `--font-scale`, or the UI scales unevenly. At that
   point the backfill is mostly mechanical: ~95% of existing font-size and
   border-radius literals map exactly onto a rung ladder.
2. **User themes / theme marketplace** — every surface color must come from
   semantic tokens (colors already largely comply).
3. **A style lint** (pi-desktop's `scripts/check-style-tokens.mjs` model) —
   it can only guard surfaces that are fully on tokens, so per-surface
   adoption precedes enforcement.

## Build note

electron-vite defaults the renderer to `minify: false`, which also disables
CSS minification (`cssMinify` follows `minify`). The renderer therefore sets
`minify: 'esbuild'` explicitly, matching main and preload. That setting is
what keeps `rendererJsCssBytes` under its budget (~44% smaller at adoption);
do not remove it.
