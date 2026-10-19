#!/usr/bin/env node
// Build ONE full-length SFX bed from the cues every FX effect drops (FX.DEFAULT_CUES + FX.cue()).
//   node <repo>/tools/sfx-bed.mjs <projectDir>
// Writes assets/sfx-bed.m4a + assets/sfx-cues.json (the cue sheet). Wire it as ONE <audio> on a LOW
// data-track-index (audio on a high track index can be silently dropped from the mix):
//   <audio id="sfx" data-start="0" data-duration="DUR" data-track-index="2" src="assets/sfx-bed.m4a"></audio>
// Each cue is set so its PEAK lands near -7 dBFS x gain. Sounds come from <repo>/sounds/ (Kenney, CC0).
// Needs ffmpeg on your PATH and Playwright's Chromium (npm install && npx playwright install chromium).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dir = path.resolve(process.argv[2] || ".");
const SFX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sounds");
const PEAK_DB = -7;

const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto(`http://localhost:${server.address().port}/index.html`, { waitUntil: "load" });
const { cues, dur } = await page.evaluate(() => ({
  cues: window.__fxCues || (window.FX && window.FX.cues()) || [],
  dur: +document.querySelector("[data-composition-id]").dataset.duration,
}));
await browser.close(); server.close();
if (!cues.length) { console.error("no cues found (did the page call FX.finalize?)"); process.exit(1); }

const peak = {};
const peakOf = (f) => peak[f] ??= +(/max_volume: (-?[\d.]+) dB/.exec(spawnSync("ffmpeg", ["-nostdin", "-i", f, "-af", "volumedetect", "-f", "null", "-"]).stderr.toString()) || [0, -1])[1];
const args = ["-y", "-nostdin"], filt = [];
const used = cues.filter((c) => c.t < dur && fs.existsSync(path.join(SFX, c.id + ".wav")));
used.forEach((c, i) => {
  const f = path.join(SFX, c.id + ".wav");
  args.push("-i", f);
  const g = Math.pow(10, (PEAK_DB - peakOf(f)) / 20) * (c.gain ?? 1);
  const ms = Math.round(c.t * 1000);
  filt.push(`[${i}]aformat=sample_rates=48000:channel_layouts=stereo,volume=${g.toFixed(4)},adelay=${ms}|${ms}[c${i}]`);
});
filt.push(`${used.map((_, i) => `[c${i}]`).join("")}amix=inputs=${used.length}:normalize=0:dropout_transition=0,apad,atrim=0:${dur}[out]`);
const out = path.join(dir, "assets", "sfx-bed.m4a");
execFileSync("ffmpeg", [...args, "-filter_complex", filt.join(";"), "-map", "[out]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out], { stdio: "ignore" });
fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
fs.writeFileSync(path.join(dir, "assets", "sfx-cues.json"), JSON.stringify(used, null, 1));
const missing = cues.filter((c) => !fs.existsSync(path.join(SFX, c.id + ".wav")));
console.log(`sfx-bed: ${used.length} cues -> ${out}` + (missing.length ? ` (${missing.length} missing sounds skipped)` : ""));
