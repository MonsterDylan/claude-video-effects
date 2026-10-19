#!/usr/bin/env node
// Install Claude Video Effects into a Hyperframes project.
//
//   node install.mjs <projectDir>                         copy fx.js + fx.css into <projectDir>/fx/ and write fx/SNIPPET.html
//   node install.mjs <projectDir> --list                  also print the effect catalog
//   node install.mjs <projectDir> --init --plate my.mp4   scaffold a full 9:16 project around your video
//                                                         (index.html, hyperframes.json, meta.json, assets/face.mp4 + 2 copies)
//   options for --init: --dur <seconds> (default: the plate's length via ffprobe, else 10)
//
// Re-run any time to pull library updates into a project. It only overwrites fx/fx.js, fx/fx.css and fx/SNIPPET.html.
// --init never overwrites an existing index.html, hyperframes.json or meta.json.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIB = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const projArg = args.find((a, i) => !a.startsWith("--") && !["--plate", "--dur"].includes(args[i - 1]));
if (!projArg) {
  console.error("usage: node install.mjs <projectDir> [--list] [--init --plate <video.mp4> [--dur <seconds>]]");
  process.exit(1);
}
const proj = path.resolve(projArg);
const init = args.includes("--init");
if (!fs.existsSync(proj)) {
  if (!init) { console.error(`project folder not found: ${proj} (pass --init to create it)`); process.exit(1); }
  fs.mkdirSync(proj, { recursive: true });
}

// 1) library files
const dest = path.join(proj, "fx");
fs.mkdirSync(dest, { recursive: true });
for (const f of ["fx.js", "fx.css"]) fs.copyFileSync(path.join(LIB, f), path.join(dest, f));

// tool commands, written relative to the project so they can be pasted from inside it
const rel = path.relative(proj, LIB) || ".";
const tool = (t) => `node ${path.join(rel, "tools", t)} .`;

const HEAD = `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <!-- only needed for FX.orbit3D / FX.model3D / FX.phoneFeed (three 0.147 = last version with the non-module GLTFLoader) -->
    <script src="https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/environments/RoomEnvironment.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Instrument+Serif:ital@0;1&display=block" rel="stylesheet">
    <link rel="stylesheet" href="fx/fx.css">`;

const body = (DUR) => `<div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}" data-width="1080" data-height="1920">
      <div id="fx-stage">
        <div id="fx-under"></div>
        <div id="fx-scene">
          <video id="plate" data-start="0" data-duration="${DUR}" data-track-index="0" src="assets/face.mp4" muted playsinline></video>
          <div id="fx-behind"></div>
          <!-- optional: a cutout (alpha video of just you, same take) makes "behind" effects sit BEHIND your head -->
          <!-- <video id="fx-cutout" data-start="0" data-duration="${DUR}" data-track-index="5" src="assets/cutout.webm" muted playsinline style="position:absolute;inset:0;width:1080px;height:1920px;object-fit:cover"></video> -->
        </div>
        <!-- plate copies: only needed for fileDrop, videoCard, multiverse. Each needs its OWN file name. -->
        <div class="fx-copy" id="fx-copy-1"><video id="copy1" data-start="0" data-duration="${DUR}" data-track-index="3" src="assets/face-copy1.mp4" muted playsinline></video></div>
        <div class="fx-copy" id="fx-copy-2"><video id="copy2" data-start="0" data-duration="${DUR}" data-track-index="4" src="assets/face-copy2.mp4" muted playsinline></video></div>
        <div id="fx-grade"></div>
        <div id="fx-ui"></div>
        <div id="fx-hud"></div>
      </div>
      <!-- your voice: the plate's own audio -->
      <audio id="vo" data-start="0" data-duration="${DUR}" data-track-index="1" src="assets/face.mp4" data-volume="1"></audio>
      <!-- SFX bed: run  ${tool("sfx-bed.mjs")}  then uncomment -->
      <!-- <audio id="sfx" data-start="0" data-duration="${DUR}" data-track-index="2" src="assets/sfx-bed.m4a" data-volume="1"></audio> -->
    </div>`;

const SCRIPT = (DUR) => `<!-- optional: face tracking for FX.faceCallout (macOS) -> bash ${path.join(rel, "tools", "face-track.sh")} assets/face.mp4 -->
    <!-- <script src="fx/face-track.js"></script> -->
    <script src="fx/fx.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const DUR = ${DUR};
      FX.init({ zone: "full" });           // "left" if you also run FX.toc (the chapter list) on the right

      // One effect per beat, anchored to the spoken word's time (seconds). Examples:
      // FX.kineticHook(tl, 0.3, { lines: ["STOP", "EDITING"] });
      // FX.terminalReveal(tl, 2.0, { prompt: "cut my filler words", result: "DONE" });
      // FX.commentCTA(tl, DUR - 2, { keyword: "KEYWORD" });

      FX.finalize(tl);                     // REQUIRED last call
      tl.set({}, {}, DUR);
      window.__timelines["main"] = tl;
    </script>`;

const snippet = `<!-- ===== Claude Video Effects: paste into index.html (see README.md) ===== -->
<!-- HEAD -->
    ${HEAD}

<!-- BODY: the layer stack (replace DUR with your video length in seconds) -->
    ${body("DUR")}

<!-- END OF BODY -->
    ${SCRIPT("DUR")}
`;
fs.writeFileSync(path.join(dest, "SNIPPET.html"), snippet);
console.log(`installed -> ${path.relative(process.cwd(), dest) || dest}/ (fx.js, fx.css, SNIPPET.html)`);

// 2) --init: scaffold a whole project
if (init) {
  const assets = path.join(proj, "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(path.join(proj, "renders"), { recursive: true });
  const plate = opt("--plate");
  if (plate) {
    if (!fs.existsSync(plate)) { console.error(`plate not found: ${plate}`); process.exit(1); }
    const face = path.join(assets, "face.mp4");
    if (path.resolve(plate) !== face) fs.copyFileSync(plate, face);
    for (const c of ["face-copy1.mp4", "face-copy2.mp4"]) fs.copyFileSync(face, path.join(assets, c));
    console.log("plate -> assets/face.mp4 (+ face-copy1.mp4, face-copy2.mp4)");
  } else if (!fs.existsSync(path.join(assets, "face.mp4"))) {
    console.log("no --plate given: put your 1080x1920 video at assets/face.mp4 (and copy it to face-copy1.mp4 + face-copy2.mp4)");
  }
  let dur = +opt("--dur", 0);
  const facePath = path.join(assets, "face.mp4");
  if (!dur && fs.existsSync(facePath)) {
    try {
      dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", facePath]).toString().trim();
    } catch { /* ffprobe missing */ }
  }
  dur = Math.round((dur || 10) * 100) / 100;
  const write = (f, content) => {
    const p = path.join(proj, f);
    if (fs.existsSync(p)) return console.log(`kept existing ${f}`);
    fs.writeFileSync(p, content); console.log(`wrote ${f}`);
  };
  const id = path.basename(proj).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  write("hyperframes.json", JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }, null, 2) + "\n");
  write("meta.json", JSON.stringify({ id, name: id, width: 1080, height: 1920, fps: 30 }) + "\n");
  write("index.html", `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1080, height=1920">
    <title>${id}</title>
    ${HEAD}
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: #07111F; }
    </style>
  </head>
  <body>
    ${body(dur)}

    ${SCRIPT(dur)}
  </body>
</html>
`);
  console.log(`\nnext: cd ${path.relative(process.cwd(), proj) || "."} && npx hyperframes preview`);
}

if (args.includes("--list")) {
  const src = fs.readFileSync(path.join(LIB, "fx.js"), "utf8");
  const m = [...src.matchAll(/\/\*\* (\d\d) ([^:]+): ([^*]+?)\*\//g)];
  for (const [, n, name, desc] of m) console.log(`${n}  ${name.padEnd(22)} ${desc.replace(/\s+/g, " ").trim()}`);
}
