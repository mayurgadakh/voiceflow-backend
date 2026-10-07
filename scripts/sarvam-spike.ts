import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

// Usage: npx tsx scripts/sarvam-spike.ts clip1.webm clip2.mp4 ...
// Tries each model and mode on every clip so we can see which combinations Sarvam accepts.
const key = process.env.SARVAM_API_KEY;
if (!key) throw new Error("SARVAM_API_KEY is not set");

const MIME: Record<string, string> = { ".webm": "audio/webm", ".mp4": "audio/mp4", ".ogg": "audio/ogg" };
const combos = [
  { model: "saaras:v3", mode: "transcribe" },
  { model: "saaras:v3", mode: "translate" },
  { model: "saaras:v3", mode: "codemix" },
  { model: "saaras:v4", mode: "translate" },
  { model: "saaras:v4", mode: undefined },
];

for (const path of process.argv.slice(2)) {
  const bytes = await readFile(path);
  console.log(`\n=== ${basename(path)} (${bytes.length} bytes)`);
  for (const { model, mode } of combos) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: MIME[extname(path)] }), basename(path));
    form.append("model", model);
    if (mode) form.append("mode", mode);
    form.append("language_code", "unknown");
    const started = Date.now();
    const res = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
    });
    const body = await res.text();
    console.log(`${model} ${mode ?? "(no mode)"} -> ${res.status} in ${Date.now() - started}ms\n  ${body.slice(0, 300)}`);
  }
}
