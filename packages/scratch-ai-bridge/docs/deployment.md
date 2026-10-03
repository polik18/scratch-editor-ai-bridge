# GitHub Pages deployment

## Current release level

The Canonical IR v1 feature set is suitable for a public **beta** on GitHub Pages. It is not yet a claim of complete
Scratch project round-trip fidelity: unsupported opcodes and procedures remain outside the strict authoring schema.

## One-time repository setup

1. Push the repository to GitHub with `main` or `develop` as the release branch.
2. Open **Settings → Pages** and choose **GitHub Actions** as the source.
3. Run **Deploy Scratch AI Bridge to GitHub Pages** manually once, or push a matching change.
4. Confirm the `github-pages` environment reports the deployed URL.

The Vite build uses relative asset URLs, so both user sites and project sites such as
`https://USER.github.io/REPOSITORY/` are supported.

## Automated gates

The workflow uses the exact Node version from `.nvmrc`, performs a clean `npm ci`, builds the required official
Scratch workspaces, then runs:

- ESLint and Prettier checks
- 28 Vitest tests, including the official fixture matrix, lossless archive security cases, all five built-in examples
  through official `scratch-parser`, and the CSP parser path
- TypeScript and production Vite build
- Chromium generate → download → upload → analyze smoke test under a nested project-site path
- top-level `dist/index.html` artifact check

Pull requests run the build gates without deploying. Pushes to `main` or `develop` upload and deploy the Pages
artifact.

## Runtime protections

- No server or API key is required; generation and analysis stay in the browser.
- User-derived diagnostic text is inserted with `textContent`, not HTML.
- SB3 input is checked before decompression: 64 MiB compressed, 256 MiB total uncompressed, 16 MiB `project.json`,
  and 2,048 ZIP entries.
- Generated assets use content-derived MD5 identifiers and are serialized again by the official Scratch VM.
- A static Content Security Policy restricts resources to the same origin and does not permit `unsafe-eval`. The
  Canonical IR validator is generated from the JSON schema at build time instead of compiling it in the browser.

## Known release risks

- The upstream Scratch monorepo dependency graph currently reports inherited npm audit findings. The Pages source-map
  reachability review found one flagged package (`uuid`) in the browser bundle; see `security-audit.md`. Do not
  describe the beta as security-audited production software.
- The main JavaScript bundle is about 4.30 MB minified (about 1.48 MB gzip). Lazy loading and VM tree-shaking are a
  post-beta performance task.
- Canonical IR v1 intentionally supports a limited opcode set. Procedures and lossless preservation of arbitrary
  unknown blocks are future phases.
