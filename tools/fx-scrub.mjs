#!/usr/bin/env node
// Pre-render scrub: load a project's index.html in headless Chromium, seek the GSAP timeline AND every
// <video> to exact times, and screenshot. Faster than a render, includes the video layer (unlike Studio).
//   node <repo>/tools/fx-scrub.mjs <projectDir> --times 1.2,3.4,5 [--out dir]
//   node <repo>/tools/fx-scrub.mjs <projectDir> --items [--points .3,.6,.9]   (reads window.__fxItems)
// Needs Playwright's Chromium: npm install && npx playwright install chromium (run once in the repo).
// Then tile: ffmpeg -i <out>/s_%03d.jpg -vf "scale=270:-2,tile=4x1" <out>/strip_%02d.jpg
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || ".");
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt("--out", path.join(dir, "renders", "scrub")));
fs.mkdirSync(out, { recursive: true });

const MIME = { ".m4a": "audio/mp4", ".wav": "audio/wav", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".mp4": "video/mp4", ".webm": "video/webm", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(p).size, type = MIME[path.extname(p)] || "application/octet-stream";
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (m) {
    const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${s}-${e}/${size}`, "Accept-Ranges": "bytes", "Content-Length": e - s + 1 });
    fs.createReadStream(p, { start: s, end: e }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    fs.createReadStream(p).pipe(res);
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// FX_SCRUB_ARGS: extra Chromium flags, e.g. "--enable-features=WebContentsForceDark" to see what a dark-mode browser shows
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--enable-unsafe-swiftshader", ...(process.env.FX_SCRUB_ARGS || "").split(" ").filter(Boolean)] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log("[page]", m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => window.FX && window.FX.ready && window.FX.ready());
await page.waitForTimeout(800);

let times = [];
if (args.includes("--items")) {
  const pts = (opt("--points", ".3,.6,.9")).split(",").map(Number);
  const items = await page.evaluate(() => window.__fxItems || []);
  items.forEach((it, i) => {
    const end = i + 1 < items.length ? items[i + 1].at : it.at + 1.4;
    pts.forEach((k) => times.push(+(it.at + (end - it.at) * k).toFixed(3)));
  });
} else times = (opt("--times", "0")).split(",").map(Number);

let n = 0;
for (const t of times) {
  await page.evaluate(async (t) => {
    const tl = window.__timelines && window.__timelines.main;
    if (tl) tl.seek(t, false);
    const vids = [...document.querySelectorAll("video")];
    await Promise.all(vids.map((v) => new Promise((res) => {
      const start = +(v.dataset.start || 0), ms = +(v.dataset.mediaStart || 0), dur = +(v.dataset.duration || 1e9);
      const local = Math.max(0, Math.min(t - start + ms, (v.duration || 1e9) - 0.05));
      v.style.visibility = t >= start && t < start + dur ? "visible" : "hidden";
      if (Math.abs(v.currentTime - local) < 0.01) return res();
      const done = () => { v.removeEventListener("seeked", done); res(); };
      v.addEventListener("seeked", done); v.currentTime = local; setTimeout(res, 3000);
    })));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t);
  n++;
  await page.screenshot({ path: path.join(out, `s_${String(n).padStart(3, "0")}.jpg`), type: "jpeg", quality: 82 });
  console.log(`s_${String(n).padStart(3, "0")}  t=${t}`);
}
await browser.close();
server.close();
