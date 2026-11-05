const CACHE_NAME = "scratch-ai-bridge-d178da45850e0983a404";
const PRECACHE_URLS = ["./assets/1-snare-B2fsjSfj.mp3","./assets/108-Do9NxdmG.mp3","./assets/12-triangle-CkeNA8X0.mp3","./assets/13-bongo-BX-A7u5M.mp3","./assets/16-guiro-DICfWehz.mp3","./assets/17-vibraslap-DnLY_sYZ.mp3","./assets/24-DfZL3B2Z.mp3","./assets/36-B4ktSwb7.mp3","./assets/36-BYIlf20M.mp3","./assets/36-C-YFI-5k.mp3","./assets/36-CSNI_YFI.mp3","./assets/36-CrIuFRxB.mp3","./assets/36-MOVYa2f-.mp3","./assets/4-crash-cymbal-B5DPxKWr.mp3","./assets/48-DBWnnLbe.mp3","./assets/48-Dp1Uxa5U.mp3","./assets/48-DvUGjTVM.mp3","./assets/48-KmWBd-Ys.mp3","./assets/48-UypHsjrC.mp3","./assets/48-d-00hh56.mp3","./assets/48-dUTeCpH9.mp3","./assets/5-open-hi-hat-CJ2CkpF4.mp3","./assets/60-BACoCKH8.mp3","./assets/60-BF8RpvDU.mp3","./assets/60-BGo2-Wsr.mp3","./assets/60-BQRnsbjm.mp3","./assets/60-BhkHs35y.mp3","./assets/60-BlRzhPaE.mp3","./assets/60-C7zgQQ_u.mp3","./assets/60-CgQSRpYU.mp3","./assets/60-CstO5T9m.mp3","./assets/60-CywrlbKs.mp3","./assets/60-Cz01WHf0.mp3","./assets/60-D0TBHsdj.mp3","./assets/60-DVbO6FZ6.mp3","./assets/60-DYSWjzKc.mp3","./assets/60-D_6jhHsM.mp3","./assets/60-Dj1TdOvx.mp3","./assets/60-DyzpkYK1.mp3","./assets/60-T9CcdHvd.mp3","./assets/60-VYtBOP18.mp3","./assets/60-ZXp_Y-gn.mp3","./assets/7-tambourine-mVICHlDH.mp3","./assets/72-Ce5Arytp.mp3","./assets/72-D6LyQeYS.mp3","./assets/72-D9d7Bmpq.mp3","./assets/72-DNz_obRU.mp3","./assets/72-SnQwxse7.mp3","./assets/84--PBRpW_X.mp3","./assets/84-D5sammj4.mp3","./assets/96-Cyi6A2H4.mp3","./assets/__vite-browser-external-CS-BLuE0.js","./assets/__vite-browser-external-WlZv0icA.js","./assets/app-CcaAXY3C.js","./assets/chunk-Tjgt1bVo.js","./assets/events-Bgd3mdsT.js","./assets/jszip.min-769Lad5H.js","./assets/jszip.min-C3Uq3Slk.js","./assets/legacy-DSPdZdeX.js","./assets/measure-svg.c9adf574a3cf11fff4a4.js","./assets/measure-svg.f2adbbf8882df746f6ac.js","./assets/modulepreload-polyfill-CXK8biUa.js","./assets/preload-helper-CjWs-_sd.js","./assets/preview-CJBCM3yi.js","./assets/runner.03ea87a633c885a5505a.js","./assets/runner.bf01a09c83cc195e306e.js","./assets/scratch-render-l5i8JJkf.js","./assets/scratch-storage-D3fL8Ppm.js","./assets/scratch-storage-DEhRxtU-.js","./assets/scratch-svg-renderer-B3iCJaOJ.js","./assets/scratch-svg-renderer-CLqyy0mU.js","./assets/self-hosted-DjKKkr24.js","./assets/session-Bk9aNuga.js","./assets/session-CU97PNmt.js","./assets/sha256-DgogJPt2.js","./assets/src-CFKcn2Rt.js","./assets/studentHelp-Sp82MLAq.js","./assets/style-BmABiyIN.css","./assets/style-CPYvNNPX.js","./assets/uiPreview-D_P7Xujh.js","./assets/uiPreview-r6u79Vex.css","./assets/verification-CyGPNJyB.js","./assets/vm-EuflpmX-.js","./assets/vm-NgINavJF.js","./c-le-you-logo.jpg","./index.html","./preview.html","./src/ui/preview.html","./student-help.html"];
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
