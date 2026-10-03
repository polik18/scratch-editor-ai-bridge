# Dependency security review

Snapshot date: 2026-10-03.

## Release conclusion

The current build remains suitable for a public GitHub Pages **beta**, but it is not a security-audited production
release. The static site has no server credentials or backend, uses a strict CSP without `unsafe-eval`, limits SB3 ZIP
input before decompression, and passes the browser round-trip gate. The inherited monorepo dependency graph still needs
upstream-compatible remediation.

## Audit and bundle reachability

`npm audit --omit=dev --json` reported 28 findings across the complete monorepo production graph:

| Severity | Count |
| -------- | ----: |
| Low      |     1 |
| Moderate |    10 |
| High     |    10 |
| Critical |     7 |

A production build with source maps contained 289 source modules. Comparing those source paths with every package named
by the audit found one flagged package in the Pages JavaScript bundle:

| Bundled package | Audit level | Observed bridge use                              | Assessment                                                                                                                                                                              |
| --------------- | ----------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid@8.3.2`    | Moderate    | Scratch VM calls `uuid.v1()` for runtime run IDs | The advisory concerns v3/v5/v6 calls with a caller-provided output buffer. That API path is not used here, but the flagged package is still bundled and should be upgraded or narrowed. |

The other 27 audit package names were not present in the production source map. They come from other Scratch
workspaces, build tooling, localization/publishing tools, or server-oriented transitive dependencies. Examples include
`hull.js`, `request`, `form-data`, `mocha`, `copy-webpack-plugin`, `postcss`, `tar`, and `transifex`.

Source-map matching is evidence about shipped code, not a proof that no vulnerability exists. It does not replace code
review, browser testing, or upstream advisory triage. Source maps are generated only for this review and are not part of
the final Pages artifact.

## Remaining actions

1. Upgrade Scratch VM's `uuid` dependency to a non-flagged compatible version, or bundle only the `v1` implementation
   after verifying official VM tests.
2. Remediate the remaining audit graph package-by-package with the official Scratch workspaces; avoid forced upgrades
   that bypass their compatibility tests.
3. Keep the strict-CSP Chromium round trip in CI and repeat this source-map comparison after dependency changes.
4. Treat build-time direct-`eval` warnings from browser fallbacks in `scratch-storage` and `js-md5` as upstream cleanup
   work. The enforced CSP and browser test currently demonstrate that the exercised Pages flows do not execute them.
