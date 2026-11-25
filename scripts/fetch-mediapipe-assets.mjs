#!/usr/bin/env node
/**
 * Self-hosts MediaPipe assets for background blur (#255) under public/mediapipe/:
 *   - wasm/  : Tasks Vision WASM runtime, copied from node_modules (version-locked)
 *   - selfie_segmenter.tflite : selfie segmentation model (~250 KB)
 *
 * Self-hosting keeps the strict `connect-src 'self'` CSP intact and means no
 * third party learns when a patient or clinician starts a consultation.
 *
 * Usage: npm run mediapipe:assets
 */
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODEL_URL =
  process.env.MEDIAPIPE_SELFIE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(outDir, { recursive: true });

if (!(await exists(wasmSrc))) {
  console.error('✗ @mediapipe/tasks-vision is not installed. Run `npm install` first.');
  process.exit(1);
}
await cp(wasmSrc, join(outDir, 'wasm'), { recursive: true });
console.log('✓ Copied MediaPipe WASM runtime → public/mediapipe/wasm');

const modelPath = join(outDir, 'selfie_segmenter.tflite');
if (await exists(modelPath)) {
  console.log('✓ Model already present → public/mediapipe/selfie_segmenter.tflite');
} else {
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`✗ Failed to download model (${res.status}) from ${MODEL_URL}`);
    process.exit(1);
  }
  await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log('✓ Downloaded selfie segmentation model → public/mediapipe/selfie_segmenter.tflite');
}
