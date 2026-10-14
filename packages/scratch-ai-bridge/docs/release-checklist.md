# Scratch AI Bridge release checklist

This checklist applies to the GitHub Pages deployment configured by
`.github/workflows/deploy-scratch-ai-bridge.yml`. The workflow builds the private workspace, runs tests and lint, enforces
the production bundle budget, enforces the performance benchmark ceilings, runs exact-cap Chromium/Firefox/WebKit smoke,
stores benchmark and browser JSON evidence, then uploads and deploys the Pages artifact on `develop` or `main`.

## Before deployment

- [ ] Confirm the intended source branch and commit SHA; Pages deployment is limited to `main` and `develop`, including manual dispatch.
- [ ] Review `docs/status.md` and `docs/completeness-roadmap.md`; make sure known limits are represented in the release notes.
- [ ] Confirm package tests, lint, production build, bundle-size check, and benchmark ceilings are current for the candidate
      commit. The Pages workflow runs all three browser smokes with an exact 256 MiB SB3 import and stores the performance
      report plus per-engine JSON for 90 days; inspect Ubuntu PSS fields and the fourteen AI repair recovery assertions
      (schema type, schema extra property, schema enum, schema const, schema required input, schema minLength, costume index, unknown sprite, unknown variable, unknown broadcast, unknown list, unknown procedure, unknown procedure argument, duplicate procedure argument) in a completed workflow run. The broader package CI lane also runs
      these cross-browser checks. Each browser artifact must also pass the compile-repair recovery assertions for SVG,
      raster, and audio preflight failures, including the copied issue/path prompt, corrected full response, SB3 download,
      and re-imported asset owner. Confirm `officialDraggablePreview` records the official `draggable.sb3` fixture,
      `Sprite1` as draggable, the +50/+40 stage-unit movement, and a changed rendered canvas in all three engines.
      Confirm `officialEventHatPreview` records the official timer hat → 10-step movement, equal nonzero before/after
      canvas dimensions, and a changed rendered canvas after the isolated VM starts the project. Confirm
      `combinedAudioEffects` applies PITCH 120 and PAN -100 in one fixture and reports a 2× source rate with left/right
      gains of 1/0 in all three engines. Require `offlineReload` to show a controlled nested Pages path and a usable app
      after offline reload in Chromium, Firefox, and WebKit; the WebKit artifact records origin-unavailable simulation.
- [ ] Run `npm run test:browser:safari` on macOS with Safari Settings → Developer → Allow Remote Automation enabled;
      this opens the production build in native Safari, imports the official default SB3 fixture, and checks the Canonical
      analysis result. The Pages workflow also runs this on a macOS-hosted runner and requires it before deployment.
      Playwright WebKit alone does not satisfy this Safari-specific gate.
- [ ] Review the npm production audit and source-map reachability artifact. The Pages build blocks any vulnerable installed
      package path that is present in mapped production sources; workspace findings without a mapped vulnerable path still
      require documented owner triage and must not be described as a clean audit. Confirm the artifact's
      `bridgeProductionVulnerableInstallPathCount` against the Bridge's production dependency closure; investigate any
      nonzero value even when source-map matching reports no intersection.
- [ ] Confirm the generated Pages artifact contains `index.html` and references its JavaScript, CSS, fonts, and other
      bundled assets with paths that resolve under the deployed project path (for this Vite app, `base: './'` produces
      `./assets/...` references). Verify the app at `https://USER.github.io/REPOSITORY/`; an absolute root path such as
      `/assets/...` would incorrectly point outside the repository site.

## After deployment

- [ ] Confirm the deployment job is green and record its workflow run URL and source SHA. Resolve the site URL from the
      `github-pages` environment URL, then the configured Pages URL or repository metadata; ask for the URL only when
      those sources do not identify it.
- [ ] Open the deployed nested-path URL and verify the app loads, a sample can be compiled/downloaded, and an SB3 can be
      uploaded for analysis. Confirm the service worker script is served from the same Pages path and the app reloads
      after the origin becomes unavailable; speech/translation and cloud/hardware features still require their services.
- [ ] Record any known browser, CSP, Scratch VM, or extension limitations with the run.

## Rollback

The workflow deploys a newly built artifact; it does not retain an in-workflow one-click rollback command. To roll back a
bad Pages release:

1. Identify the source commit associated with the bad deployment and the last known-good deployed source SHA.
2. Create a corrective source commit that reverts only the bad change or restores the last known-good files. Avoid force-pushing
   the deployment branch.
3. Let the normal deployment workflow rebuild and run its gates. Do not manually upload a stale artifact.
4. Verify the deployed nested-path URL and sample compile/download/upload flow again.
5. Record the bad run, corrective commit, successful rollback run, and verification result in the release log.

Until a real rollback has been exercised and recorded, rollback evidence remains pending; this document is a procedure, not
proof of a completed rollback drill.
