# GitHub Pages deployment

## Current release level

The Canonical IR v1 feature set is suitable for a public **beta** on GitHub Pages. It is not yet a claim of complete
Scratch project round-trip fidelity: strict authoring covers 130 capabilities, while some legacy procedure metadata,
unknown opcodes, and third-party extension behavior remain outside the modeled authoring path.

## One-time repository setup

1. Push the repository to GitHub with `main` or `develop` as the release branch.
2. Open **Settings → Pages** and choose **GitHub Actions** as the source.
3. Run **Deploy Scratch AI Bridge to GitHub Pages** manually once, or push a matching change.
4. Confirm the `github-pages` environment reports the deployed URL.

Automatic deployment runs only on pushes to `main` or `develop`; manual `workflow_dispatch` deployment is also limited to those branches. Pull requests and manual runs from other refs can run checks but cannot publish Pages.

The Vite build uses relative asset URLs, so both user sites and project sites such as
`https://USER.github.io/REPOSITORY/` are supported.

## Current public deployment evidence

The public Pages URL is `https://polik18.github.io/scratch-editor-ai-bridge/`. The latest successful deployment remains
run `37132144623` for `main` at source SHA `e814add96a5ee243f15a1626821e61f1afe270c2` (2026-10-03); its
`github-pages` deployment status records the same environment URL. The authenticated Pages settings API reports
`build_type: workflow`, source `main`/`/`, and the expected URL; nullable `status` is not a failure signal for Actions mode.

One direct check on 2026-10-14 returned HTTP 404, but a later deployed-page smoke passed three consecutive checks: each
received HTTP 200 and downloaded the app JavaScript and stylesheet (about 4.38 MB total). The earlier unauthenticated Pages
settings API 404 was an authentication limitation, not evidence that Pages was disabled. The live site is currently
available, but still serves the October 3 deployment; it does not contain the current local worktree. A new post-deployment
workflow check now verifies the app title, mount point, same-site JavaScript/CSS assets, and the offline service worker to
catch a deployment that reports success while the URL or worker is unavailable.

The Pages verifier was rerun at 2026-10-14 11:35 UTC after the earlier conflicting response: the entrypoint returned HTTP 200
on two direct requests and in `verify-deployed-pages.mjs`; the title, app mount, 4,372,597-byte JavaScript bundle, and
7,356-byte stylesheet all passed. At that check, the public Actions API showed `main` at
`e814add96a5ee243f15a1626821e61f1afe270c2`; this remains the deployed source SHA.

The current public page was rechecked on 2026-10-15: it returns HTTP 200 and still serves the October 3 assets; the new
service worker returns 404, confirming that the candidate has not been published. The current local production build
succeeds with relative asset paths, a complete `dist/` artifact, and
`service-worker.js` for offline reload. The October 3 public artifact does not have this file;
the strengthened local verifier returns HTTP 404 for that old service-worker path, as expected. After the next authorized
deployment, the verifier will require the worker to be served beneath the repository Pages path with the precache and
offline-navigation fallback code.

For post-deployment verification, resolve the URL from the `github-pages` deployment environment first, then the configured
Pages URL or repository metadata. Ask the user for a URL only when those sources do not identify one; the verifier should
fetch the entrypoint and every referenced same-path JavaScript/CSS asset.

## Automated gates

The deployment workflow uses the exact Node version from `.nvmrc`, performs a clean `npm ci`, builds the required official
Scratch workspaces, then runs:

- Bridge Vitest suite (latest recorded: 410/410 across 32 files), including Canonical IR, official fixture differentials,
  procedure execution, raw block-graph preservation, archive security/mutation cases, generated control-flow and AI-response
  cases, malformed media preflight, and validation-report coverage. Check `docs/status.md` for evidence from the candidate build.
- ESLint and Prettier checks
- Vitest performance benchmark at 100/500/2,000 blocks with mean latency ceilings and a JSON report
- TypeScript and production Vite build, with JS/CSS raw and gzip size budgets
- Chromium, Firefox, and WebKit generate → download → upload → analyze smoke tests under a nested project-site path; each
  also verifies the official `draggable.sb3` preview through the isolated VM and renderer, moving `Sprite1` by +50/+40
  stage units and checking for a changed canvas in each engine. The fixture dispatches Pointer Events on the real canvas
  because Playwright mouse movement is inconsistent across nested Firefox iframes. Each engine also imports official
  `edge-triggered-hat.sb3`, verifies the timer hat and 10-step movement data, starts the isolated runtime, and records
  equal-sized before/after canvases with a visible change. A same-sprite Scratch audio fixture applies PITCH 120, PAN -100, and 40% volume before playback; the release evidence gate requires a 2× source rate, left/right pan gains of 1/0, and a 0.4 volume gain.
  Each engine imports an exact 256 MiB uncompressed archive and records process-tree RSS (and PSS on Linux) plus over-limit
  preflight results in retained browser JSON evidence. A dedicated Linux evidence gate requires positive PSS peaks and sample counts for each engine on both the 2,020-block flow and exact-cap import; missing PSS data blocks deployment. Accessibility evidence records eight text contrast ratios, ARIA tab
  keyboard navigation and visible focus outline, and 320px reflow across Generate, Analyze, and validation-error views.
  Each engine's artifact also records schema-type, schema-additionalProperties, schema-enum, schema-const, schema-required, schema-minLength, invalid costume-index, unknown-sprite, unknown-variable, unknown-broadcast, unknown-list, unknown-procedure, unknown-procedure-argument, and duplicate-procedure-argument
  repair recovery; the evidence gate requires successful SB3 downloads and re-import assertions for all fourteen loops. Each
  engine also records complete report/prompt → corrected response → SB3 download → re-import recovery for malformed SVG,
  raster, and audio assets; missing any of these three compile-repair flows blocks deployment.
  It also requires each engine's retained `offlineReload` evidence for the nested Pages path after the origin becomes
  unavailable.
- top-level `dist/index.html` artifact check

The Pages workflow runs and stores the Vitest benchmark, dependency reachability report, browser evidence and Safari evidence.
Pull requests run build and browser gates without deploying. Pushes to `main` or `develop` upload and deploy the Pages artifact
only after the Linux and native Safari jobs pass. Candidate branch run [38596592201](https://github.com/polik18/scratch-editor-ai-bridge/actions/runs/38596592201)
passed the production audit, Bridge tests/lint/build/bench, Chromium/Firefox/WebKit, native Safari, Linux PSS, and artifact
upload on source SHA `4749f4a8d8c11fa6f81da1c946f00c3c07207bb5`; deployment correctly skipped because the branch is not
`main` or `develop`. This establishes the candidate workflow gates, not post-deployment behavior or a release decision.
The candidate branch's subsequent push-triggered monorepo `CI` run on documentation-only SHA `3ab9633c47` ended as
`startup_failure` with zero jobs/check runs (run `38598379134`); GitHub's public response exposes no runner error. No pull
request is currently listed for the candidate, so the successful Pages gate is not a merge or deployment.

All external Actions used by the Pages workflow are pinned to verified 40-character commit SHAs. Its push and pull-request
filters include `.nvmrc` and `scripts/**`, which affect Node selection and dependency builds; the candidate run above confirms
these paths and hosted runner jobs execute successfully. After deployment, the workflow fetches the published entrypoint
and all script/style URLs under the Pages path; a failed response or unexpected app document fails the deployment job.

The latest recorded sequential whole-monorepo `npm test` and `npm run build` both exit 0 on 2026-10-14; Bridge passes
410/410 across 32 files, VM 3,872/3,872, GUI Selenium 127 passed/7 skipped, and GUI Playwright 8/8. The earlier concurrent
test/build attempt failed two GUI Selenium cases because the GUI build was cleaning its shared output directory; the
sequential rerun passed after build completion. The hosted candidate run on 2026-10-15 independently passed Bridge tests and
all browser, Safari, and Linux PSS release gates. Neither local nor candidate evidence shows that the candidate has been
published; deployed-page functional verification remains pending.

## Runtime protections

- No server or API key is required; generation and analysis stay in the browser.
- The production build generates a content-versioned same-origin service worker that precaches the app shell, preview, and
  bundled assets. Once its install completes, the app shell can reload at the nested Pages path when the network is
  unavailable. Speech/translation, Scratch Cloud, and hardware connections still require their external service/device.
- Chromium and Firefox browser smokes disable browser networking for the reload; WebKit's Playwright offline emulation
  produces an internal navigation error, so its smoke drops all requests to the local Pages origin and verifies the cached
  app still reloads. Per-engine `offlineReload` evidence is required by the Linux release gate.
- The production browser smoke watches imported-project analysis and both preview modes; Chromium, Firefox, and WebKit fail if
  they observe an off-origin request or any request method other than GET/HEAD during this flow. Their JSON release evidence
  retains the same-origin/no-write result. Explicitly consented speech/translation and separately initiated local hardware
  connections are distinct preview actions.
- User-derived diagnostic text is inserted with `textContent`, not HTML.
- SB3 input is checked before decompression: 64 MiB compressed, 256 MiB total uncompressed, 16 MiB `project.json`,
  and 2,048 ZIP entries.
- Generated assets use content-derived MD5 identifiers and are serialized again by the official Scratch VM.
- A static Content Security Policy restricts resources to the same origin and does not permit `unsafe-eval`. The
  Canonical IR validator is generated from the JSON schema at build time instead of compiling it in the browser.
- AI drafts and recursive Canonical metadata are limited to 128 nesting levels and 100,000 values; cyclic object graphs
  are rejected before normalization/schema traversal.

## Known release risks

- The upstream Scratch monorepo dependency graph reports inherited npm audit findings. The latest audit scope review found
  0 vulnerable install paths inside the Bridge production dependency closure (262 package paths), and 0 exact source-map
  intersections with the 27 workspace-audit paths. Those paths route to shared Scratch GUI/Paint workspaces as dependency
  candidates; this does not confirm owner attribution or remediation. See `security-audit.md`. Do not describe the beta as
  security-audited production software.
- The production JavaScript budget is split across the app, deferred renderer, and sandbox assets; see `docs/status.md` for
  current measurements. All three browser engines accept an exact 256 MiB archive and reject 256 MiB + 1 before
  decompression. Candidate run 38596592201 provides the first passing hosted Ubuntu PSS evidence; 40 ms sampling can still
  miss brief peaks. Additional large-asset workloads and student usability remain open.
- Strict Canonical authoring supports 130 registered opcode capabilities. Procedure compile/decompile and raw block-graph
  preservation have verified slices; exhaustive procedure/opcode behavior and arbitrary extension runtime support remain open.
  Unknown extension code is never downloaded or executed by the app.
- The student result uses the official Scratch VM and renderer for static and isolated animated previews. Chromium, Firefox, and
  WebKit cover keyboard/pointer response and stop behavior; this does not replace student usability sessions or physical
  Scratch Link hardware validation.
- Pages rollback requires a corrective source commit and a successful redeployment. No rollback drill has been completed;
  see [`release-checklist.md`](release-checklist.md).

The post-deploy verifier also checks each asset's final response URL after redirects; JavaScript or CSS redirected outside the repository's Pages path fails the deployment job.

Workflow permissions are scoped by job: build gets repository read and Pages read for configuration, Safari gets repository read, and only the deployment job receives Pages write plus OIDC token permission. The workflow no longer grants deployment credentials to pull-request build or browser-smoke jobs.
