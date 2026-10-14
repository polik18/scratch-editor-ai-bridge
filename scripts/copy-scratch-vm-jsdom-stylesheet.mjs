import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const dompurifyEntry = require.resolve("isomorphic-dompurify");
const requireFromDomPurify = createRequire(dompurifyEntry);
const source = requireFromDomPurify.resolve(
    "jsdom/lib/jsdom/browser/default-stylesheet.css",
);
const destination = resolve(
    "packages/scratch-vm/browser/default-stylesheet.css",
);

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`Copied jsdom's default stylesheet to ${destination}`);
