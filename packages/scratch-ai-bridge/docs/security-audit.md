# Dependency security review

Snapshot date: 2026-10-14 (requeried during this work; npm registry advisory data against the current installed lockfile).

## SB3 extension loading guard (2026-10-13)

Review of the pinned Scratch VM found that `installTargets()` forwards extension IDs from imported projects to
`ExtensionManager.loadExtensionURL()`. Built-in IDs resolve locally, while unknown IDs can create a Worker that uses
`importScripts()` for the supplied extension URL. The bridge's `createVM()` now wraps this loader with an explicit list of
bundled Scratch extension IDs. Any other value resolves without loading code; the VM still imports and serializes unknown
blocks as opaque data. A regression test imports a project containing an unknown extension ID/opcode and verifies both
remain in project JSON. This does not add third-party extension execution support.

The bundled `faceSensing` and `videoSensing` adapters are explicitly excluded from automatic loading. Face sensing enables
video and loads a MediaPipe detector, with a fallback model URL at jsDelivr. Video sensing enables the camera on first
extension load. Analysis reports both extensions as preserved but inactive, and the official Video Sensing fixture confirms
its opcodes remain in the source Raw Graph IR without calling the camera API. Other bundled adapters can be instantiated
locally, though hardware and network behavior remains subject to separate browser/device checks.

The isolated preview now presents scan/connect/disconnect controls for WeDo 2.0, micro:bit, EV3, Boost, and GDX for. A scan
may connect to the local Scratch Link WebSocket (`ws://127.0.0.1:20111`) or Scratch's fixed device-manager fallback
(`wss://device-manager.scratch.mit.edu:20110`); the preview CSP permits only those two device endpoints. The connection is
attempted only after the user presses「搜尋裝置」, and stopping the preview disconnects the adapters. Device discovery and
commands are mediated by Scratch Link. Chromium, Firefox, and WebKit smoke mock discovery/connect/disconnect and verify the
socket closes on stop; this does not establish physical-device behavior. Hardware/browser compatibility and Scratch Link
support must still be checked per platform.

The bundled Text to Speech adapter sends up to 128 characters of each `speak` input to
`https://synthesis-service.scratch.mit.edu/synth` to generate audio. The bundled Translate adapter sends its input to
`https://translate-service.scratch.mit.edu/translate`. During the isolated animation preview, both services require
per-call approval; the prompt shows the exact text and Translate target language. Translate inputs above 1,024 characters
are canceled before prompting or sending. The preview CSP allows these two fixed service hosts plus the two Scratch Link
device endpoints described above, and the
VM fetch boundary intercepts both endpoints. Analyzer warnings disclose each transfer and advise against personal or
sensitive text. Chromium, Firefox, and WebKit smoke verifies the real parent consent dialog, zero requests after decline,
one request after approval, acceptance at the 1,024-character Translate limit, and rejection at 1,025 characters. A bundled WAV response starts Scratch Audio, and a
stubbed Translate JSON response changes stage text. Live service response and codec fidelity remain unverified.

## Release conclusion

The current build remains suitable for a public GitHub Pages **beta**, but it is not a security-audited production
release. The static site has no server credentials or backend, uses a strict script CSP without `unsafe-eval`, limits SB3 ZIP
input before decompression, and passes the browser round-trip gate. The inherited monorepo dependency graph still needs
upstream-compatible remediation.

`style-src-elem` allows inline style elements because the official Scratch renderer injects a fixed sandbox-hiding rule and
bundled font-face rules at runtime. `style-src-attr` remains restricted to same-origin styles, and scripts remain same-origin only.

## Audit and bundle reachability

`npm audit --omit=dev --json` reports 30 findings across the complete monorepo production graph (1 low, 13 moderate, 10 high, 6 critical). Running the same command scoped to `packages/scratch-ai-bridge` reports 25 findings (9 moderate, 10 high, 6 critical); this npm workspace view still includes transitive packages from linked Scratch workspaces and is not equivalent to code shipped in the Pages bundle:

| Severity | Count |
| -------- | ----: |
| Low      |     1 |
| Moderate |    13 |
| High     |    10 |
| Critical |     6 |

A current production build with source maps contains 7 maps and 302 source modules from 29 third-party package roots. The bridge workspace query currently reports 25 findings (9 moderate, 10 high, 6 critical). Comparing map sources against all 25 package names reported by the production workspace audit finds one overlapping package name (`uuid`); exact install-path matching distinguishes the bundled patched `uuid@11.1.1` from the vulnerable copy. Matching mapped sources against all 27 vulnerable install locations reported by `npm audit` finds zero exact path intersections. The checker output now includes a row for every vulnerable install path with its lockfile version, advisory severity/range/fix availability, mapped-source count, the production/optional/peer workspace consumer closure, and the nearest introducing workspace(s) derived from lockfile dependency edges. Development-only dependency edges are excluded. Introducing workspaces are dependency-routing candidates, not confirmed human ownership. Neither field adjudicates remediation:

The fresh 2026-10-14 production-edge report routes all 27 vulnerable installation rows to the Scratch GUI workspace as the nearest introducing candidate. Earlier results included development-only reverse edges and were overbroad; the checker now excludes them. Confirm human ownership before changing shared dependency families. The audit dry run still recommends major-version moves for most dependency chains; no lockfile remediation was applied.

The refreshed checker now also walks the Bridge's own production dependency closure from `packages/scratch-ai-bridge` through installed dependencies, optional dependencies, peer dependencies, and npm workspace links, while excluding development dependencies. It resolves lockfile workspace links using their root-relative `resolved` path and compares the resulting package paths with npm audit's vulnerable install locations. On the current lockfile, this closure contains 262 package paths and zero of the 27 vulnerable installation paths. All 27 remain outside the Bridge production closure, and none intersects the 302 source-map paths. They remain monorepo owner-triage items; this does not mean the shared workspaces have a clean audit.

The 2026-10-14 rerun after the procedure-default and import changes rebuilt into an isolated audit directory: 7 source maps, 302 mapped sources, 29 third-party package roots, and 0 intersections across all 27 vulnerable install paths. Every reported vulnerable path has `mappedSourceCount: 0`. The workspace audit still reports 25 findings; this reachability result does not close dependency-owner remediation.

The current source-map comparison is reproducible from the lockfile and build output:

```sh
npm audit --workspace @scratch/scratch-ai-bridge --omit=dev --json > packages/scratch-ai-bridge/test-results/bridge-production-audit.json || test $? -eq 1
cd packages/scratch-ai-bridge
npx vite build --sourcemap
npm run audit:reachability -- test-results/bridge-production-audit.json dist
```

The checker compares each source map's resolved source path with npm audit's exact vulnerable installation paths; it exits non-zero if any vulnerable installation is present in a mapped source path. Run the normal production build after review so local `dist/` matches the deploy artifact settings. The Pages workflow runs this check before its normal deployment build and uploads the audit/reachability JSON reports; source maps stay in the isolated audit output and are not deployed.

| Bundled package | Audit level                                                                  | Observed bridge use                              | Assessment                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid@11.1.1`   | Workspace aggregate reports a moderate advisory for other installed versions | Scratch VM calls `uuid.v1()` for runtime run IDs | Updated from 8.3.2. The emitted browser source resolves to `scratch-vm/node_modules/uuid` 11.1.1; the advisory range is `<11.1.1`. The affected audit node is `node_modules/request/node_modules/uuid` 3.4.0 and does not intersect the mapped package path. The build map does not contain those other package copies. Scratch VM tests and the upstream run-ID integration checks are recorded above. |

The other 24 vulnerable package names from the bridge workspace audit were not found as separately named sources in the production source map. Exact path matching likewise found no mapped source inside any vulnerable installed package directory. `source-map-js@1.2.1` was updated to patched `1.2.2` within existing semver ranges; its advisory is removed from the current production audit results. The Bridge suite (312 tests), SVG renderer suite (245 tests), and Task Herder suite (28 tests) pass against the updated lockfile. They come from other Scratch workspaces, build tooling, localization/publishing tools, or server-oriented transitive dependencies. Examples include `request`, `form-data`, `mocha`, `copy-webpack-plugin`, `postcss`, `tar`, and `transifex`. The vulnerable `hull.js` dependency has been removed from `scratch-render`: its call site already generates the convex boundary, so a small local boundary normalization replaces the redundant package call. Its output was compared against the prior implementation over 5,005 random point sets and every 3×3 and 4×4 binary drawable mask. The newly direct `@noble/hashes@1.8.0` source is present for incremental SB3 SHA-256, but has no npm audit finding. The full monorepo production audit has five additional advisory package names from workspace branches outside the bridge scope. A development-inclusive workspace audit currently reports 79 findings (6 low, 18 moderate, 47 high, 8 critical); those include test/build-only dependency trees and require separate owner triage.

Source-map matching is evidence about shipped code, not a proof that no vulnerability exists. It does not replace code
review, browser testing, or upstream advisory triage. Source maps are generated only for this review and are not part of
the final Pages artifact.

### 2026-10-14 safe-fix and workspace routing recheck

The current workspace-scoped `npm audit fix --dry-run --package-lock-only --omit=dev` still reports all 25 findings. The
proposed fixes for `copy-webpack-plugin`, the legacy `scratch-l10n` tree, and PostCSS plugins require `--force`, which
would cross major-version or dependency-family boundaries. `npm ls --workspaces --depth=0` identifies the direct
workspace consumers: `copy-webpack-plugin` is declared by GUI, Render, SVG Renderer, and VM; the PostCSS plugins are
declared by GUI and Paint; and `scratch-l10n` is declared by GUI, Paint, and VM. These consumers need compatibility
review by their workspace maintainers before those upgrades.

The audit marks `sprintf-js` as fixable without force, but its installed `1.0.3` is constrained by `argparse@1.0.10`'s
`~1.0.2` dependency. The current GitHub advisory reports no patched `sprintf-js` release and affects versions through
1.1.3, so a lockfile-only update cannot resolve it. No dependency changes were applied in this recheck. Current exact
source-map matching remains 0/27 vulnerable installation paths in shipped sources; this does not close the broader
workspace advisory triage.

## 2026-10-14 Bridge production dependency closure follow-up

Fresh audits report 30 findings in the monorepo production graph and 25 in the npm workspace query. The latter includes
linked-workspace audit paths, so it is not by itself the Bridge runtime dependency count. The reachability checker now walks
the lockfile closure from `packages/scratch-ai-bridge`, follows root-relative npm workspace links, includes production,
optional, and peer dependencies, and excludes development dependencies. It finds 262 Bridge production package paths and
zero of the 27 workspace-audit vulnerable install paths in that closure. The separate source-map check remains 0/27 exact
intersections (7 maps, 302 mapped sources, 29 third-party roots). All 27 nearest introducing-workspace candidates resolve to
Scratch GUI; this remains shared-workspace owner triage, not a clean monorepo audit or confirmed human ownership. The checker
tests pass 4/4, including workspace-link resolution, optional/peer inclusion, and development/unrelated-path exclusion.
No dependency upgrade was made because current audit remediation proposals cross major-version or dependency-family boundaries.

## Remaining actions

1. Remediate remaining audit findings package-by-package in their owning Scratch workspaces; do not apply forced monorepo upgrades without compatibility tests. Distinguish npm workspace findings from packages actually present in the production source map.
2. Keep strict-CSP browser smoke and repeat this source-map comparison after dependency changes.
3. Keep tracking the upstream Scratch VM standalone-loader CSP limitation. The Bridge app uses generated SB3 validators and does not bundle the legacy SB1 converter; its current production build has no direct-`eval` warning. Recheck this boundary if the supported import formats or VM loader changes.

### 2026-10-14 reachability artifact serialization fix

The Pages workflow piped `npm run audit:reachability` directly into `tee` for a `.json` artifact. npm's lifecycle banner preceded the script's JSON, making the uploaded artifact invalid JSON even though the reachability check itself completed. The workflow now invokes the script with `npm run --silent` and parses both audit artifacts before upload. Reproducing those steps against the current production audit and seven source maps yields valid JSON: 302 mapped sources, 27 vulnerable installation paths, and zero exact source-map intersections. The npm audit still reports 25 workspace findings and requires the owner triage listed above.

## 2026-10-14 Scratch Storage MD5 runtime replacement

Scratch Storage now computes asset IDs with `@noble/hashes@1.8.0` while preserving UTF-8 string behavior and byte-array output. `js-md5@0.7.3` remains a development dependency for compatibility tests. Unit coverage compares empty, ASCII, Unicode, large string, typed-byte and plain-array inputs against the previous implementation. Scratch Storage tests pass 27/27 and its production webpack build succeeds without `js-md5`/direct-`eval` output. The initial Bridge Vite build still surfaced `js-md5` warnings; the following CSP loader integration removes the legacy converter from the production bundle. Workspace audit triage remains open.

## 2026-10-14 strict-CSP VM import boundary

The upstream standalone Scratch VM bundle calls `scratch-parser` from `loadProject()`. Its Ajv 6 schema compilation uses `new Function`; a direct Chromium check confirms a valid SB3 fails under `script-src 'self'`. The Bridge Vite build already aliases `scratch-parser` to generated validators, and the VM adapter now invokes that CSP-compatible parser directly before official `deserializeProject()` and the project-loaded event. The production Vite alias replaces the unused legacy SB1 converter in this SB3-only application; that converter was the source of the residual `js-md5` direct-eval build warning. This reduces the raw app bundle from 4.11 MiB to 3.68 MiB and the VM chunk from 2.29 MiB to 1.84 MiB. Production build reports no `EVAL`/`js-md5` warning. Three-engine browser smoke asserts zero blocked eval violations and passes exact-cap 256 MiB SB3 import and exact 393,240 UTF-16-unit Unicode round-trip. The standalone upstream Scratch VM loader remains CSP-incompatible when used outside this Bridge adapter; workspace audit/security triage remains open.

The post-change source-map audit was rerun against the current lockfile and production workspace audit: 7 maps, 301 mapped modules, 29 third-party package roots, and 27 vulnerable install paths; exact path intersections remain zero. The audit still reports 25 workspace findings (9 moderate, 10 high, 6 critical), so bundle reachability evidence does not resolve ownership or remediation.

## 2026-10-14 `sprintf-js` / `argparse` advisory triage

The current installed `sprintf-js@1.0.3` is reached through `argparse@1.0.10` (lockfile requirement `~1.0.2`); the shared `argparse@1.0.10` is used by TensorFlow.js and legacy `js-yaml@3` workspace paths. Registry metadata reports `sprintf-js@1.1.3` as latest and the current advisory range includes versions through 1.1.3; no patched release within the dependency's declared range is available. Upgrading `argparse` to 2.x or 3.x crosses a major API boundary. An npm `audit fix --dry-run --workspace=@scratch/scratch-ai-bridge --omit=dev` proposed no package changes and still reported 25 findings; its dry-run install plan also prunes 1,525 omitted packages, so it is not a reviewable targeted fix. No override was applied. The source-map audit continues to report zero vulnerable install-path intersections in shipped sources. Track this with the owning workspace and upgrade only with compatibility tests.

## 2026-10-14 current audit scope correction

Fresh npm audit results: the full monorepo reports 30 findings (1 low, 13 moderate, 10 high, 6 critical); the `scratch-ai-bridge` workspace query reports 25 (9 moderate, 10 high, 6 critical). npm workspace selection still includes linked-workspace dependency paths, so the latter count is not a standalone Bridge runtime finding count. Rebuilt the current Bridge production artifact with source maps: 7 maps, 302 mapped sources, 29 third-party roots. Exact path comparison remains 0/27 vulnerable installation paths in shipped sources. The checker routes all 27 workspace-audit vulnerable install paths to `@scratch/scratch-gui` as the nearest introducing workspace candidate. The full monorepo audit routes its 33 vulnerable install paths to Scratch GUI (33) and Scratch Paint (2; two paths have both nearest candidates). This narrows local remediation ownership; it does not clear the upstream Scratch GUI/Paint advisories or replace maintainer review. No dependency changes were applied because the available audit fixes cross major-version or dependency-family boundaries.

## 2026-10-14 full-tree audit refresh

A fresh default `npm audit --json` now reports 114 vulnerable package entries across the entire monorepo dependency tree (7 critical, 71 high, 29 moderate, 7 low); this includes development tooling and is not the Bridge production dependency count. The Bridge workspace production query reports 25 vulnerability records, while the lockfile reachability checker finds 27 vulnerable install paths in the full npm workspace query, all routed to Scratch GUI as the nearest introducing workspace candidate. Rebuilt source maps show 302 mapped sources and zero exact intersections with those 27 paths; the Bridge production dependency closure remains 262 paths with zero vulnerable paths. `npm audit fix --dry-run` proposes zero changes and no safe semver-only remediation was found. Major dependency-family upgrades remain for owning-workspace review; the Bridge bundle evidence does not clear the monorepo findings.
