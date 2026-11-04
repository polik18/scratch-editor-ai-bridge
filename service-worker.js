const CACHE_NAME = "scratch-ai-bridge-f9160d6b15388cf39f30";
const PRECACHE_URLS = ["./assets/1-snare-B2fsjSfj.mp3","./assets/108-Do9NxdmG.mp3","./assets/12-triangle-CkeNA8X0.mp3","./assets/13-bongo-BX-A7u5M.mp3","./assets/16-guiro-DICfWehz.mp3","./assets/17-vibraslap-DnLY_sYZ.mp3","./assets/24-DfZL3B2Z.mp3","./assets/36-B4ktSwb7.mp3","./assets/36-BYIlf20M.mp3","./assets/36-C-YFI-5k.mp3","./assets/36-CSNI_YFI.mp3","./assets/36-CrIuFRxB.mp3","./assets/36-MOVYa2f-.mp3","./assets/4-crash-cymbal-B5DPxKWr.mp3","./assets/48-DBWnnLbe.mp3","./assets/48-Dp1Uxa5U.mp3","./assets/48-DvUGjTVM.mp3","./assets/48-KmWBd-Ys.mp3","./assets/48-UypHsjrC.mp3","./assets/48-d-00hh56.mp3","./assets/48-dUTeCpH9.mp3","./assets/5-open-hi-hat-CJ2CkpF4.mp3","./assets/60-BACoCKH8.mp3","./assets/60-BF8RpvDU.mp3","./assets/60-BGo2-Wsr.mp3","./assets/60-BQRnsbjm.mp3","./assets/60-BhkHs35y.mp3","./assets/60-BlRzhPaE.mp3","./assets/60-C7zgQQ_u.mp3","./assets/60-CgQSRpYU.mp3","./assets/60-CstO5T9m.mp3","./assets/60-CywrlbKs.mp3","./assets/60-Cz01WHf0.mp3","./assets/60-D0TBHsdj.mp3","./assets/60-DVbO6FZ6.mp3","./assets/60-DYSWjzKc.mp3","./assets/60-D_6jhHsM.mp3","./assets/60-Dj1TdOvx.mp3","./assets/60-DyzpkYK1.mp3","./assets/60-T9CcdHvd.mp3","./assets/60-VYtBOP18.mp3","./assets/60-ZXp_Y-gn.mp3","./assets/7-tambourine-mVICHlDH.mp3","./assets/72-Ce5Arytp.mp3","./assets/72-D6LyQeYS.mp3","./assets/72-D9d7Bmpq.mp3","./assets/72-DNz_obRU.mp3","./assets/72-SnQwxse7.mp3","./assets/84--PBRpW_X.mp3","./assets/84-D5sammj4.mp3","./assets/96-Cyi6A2H4.mp3","./assets/__vite-browser-external-CS-BLuE0.js","./assets/__vite-browser-external-WlZv0icA.js","./assets/app-4F3LW161.js","./assets/chunk-Tjgt1bVo.js","./assets/events-Bgd3mdsT.js","./assets/jszip.min-769Lad5H.js","./assets/jszip.min-C3Uq3Slk.js","./assets/legacy-DSPdZdeX.js","./assets/measure-svg.144915fd839c8ff56b8d.js","./assets/measure-svg.f9a1fcb7ad5f276aeb94.js","./assets/modulepreload-polyfill-CXK8biUa.js","./assets/preload-helper-CjWs-_sd.js","./assets/preview-BR_LV8uM.js","./assets/runner.d26fd2223fe05c00a580.js","./assets/runner.eb6700df63d6d7780b1b.js","./assets/scratch-render-Dy7S0wx6.js","./assets/scratch-storage-B6ib-_Vn.js","./assets/scratch-storage-CJvjMjCQ.js","./assets/scratch-svg-renderer-DnggnMJw.js","./assets/scratch-svg-renderer-Z-C5Bmuj.js","./assets/self-hosted-DjKKkr24.js","./assets/session-CuAhj7HY.js","./assets/session-fuTS-WTG.js","./assets/sha256-DgogJPt2.js","./assets/src-CFKcn2Rt.js","./assets/studentHelp-BOGH9I0u.js","./assets/style-BASwF8ff.js","./assets/style-BmABiyIN.css","./assets/uiPreview-Dv-JsZxF.js","./assets/uiPreview-r6u79Vex.css","./assets/verification-D-kxfmVx.js","./assets/vm-0SkdI-3I.js","./assets/vm-DxppWxRy.js","./c-le-you-logo.jpg","./index.html","./preview.html","./src/ui/preview.html","./student-help.html"];
const CACHE_PREFIX = 'scratch-ai-bridge-';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const scopePath = new URL('./', self.registration.scope).pathname;
  if (!new URL(request.url).pathname.startsWith(scopePath)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (error) {
      if (request.mode === 'navigate') {
        const appShell = await cache.match(new URL('./index.html', self.registration.scope));
        if (appShell) return appShell;
      }
      throw error;
    }
  })());
});
