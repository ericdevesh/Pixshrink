"use strict";

/* =========================================================
   PixShrink — Application Script
   All image processing happens locally. Nothing here ever
   uploads image data anywhere.
   ========================================================= */

/* ---------- DOM references ---------- */
const themeToggle = document.getElementById("themeToggle");
const heroCtaBtn = document.getElementById("heroCtaBtn");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");

const workspaceSection = document.getElementById("workspace");
const batchSummary = document.getElementById("batchSummary");
const addMoreBtn = document.getElementById("addMoreBtn");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

const presetButtons = Array.from(document.querySelectorAll(".preset-btn"));
const qualitySlider = document.getElementById("qualitySlider");
const qualityValue = document.getElementById("qualityValue");
const qualityHint = document.getElementById("qualityHint");
const formatSelect = document.getElementById("formatSelect");
const formatHint = document.getElementById("formatHint");
const resizeSlider = document.getElementById("resizeSlider");
const resizeValue = document.getElementById("resizeValue");
const resizeHint = document.getElementById("resizeHint");
const targetSizeSlider = document.getElementById("targetSizeSlider");
const targetSizeValue = document.getElementById("targetSizeValue");
const targetSizeBtn = document.getElementById("targetSizeBtn");

const fileList = document.getElementById("fileList");
const fileCardTemplate = document.getElementById("fileCardTemplate");
const toastRegion = document.getElementById("toastRegion");

/* ---------- Application state ---------- */
const state = {
  files: [],
  settings: {
    quality: 0.8,
    format: "auto",
    maxDimension: null,
    targetSizeKB: null,
    preset: "balanced",
  },
  batchNotified: false,
};

const PRESETS = {
  maximum: { quality: 0.92 },
  balanced: { quality: 0.8 },
  web: { quality: 0.72 },
  smallest: { quality: 0.5 },
};

const RESIZE_SLIDER_MAX = 4000; // slider value at this point means "Original" (no resize)
const MIME_MAP = { jpeg: "image/jpeg", webp: "image/webp", png: "image/png" };
const EXTENSION_MAP = { jpeg: "jpg", webp: "webp", png: "png" };
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const LARGE_IMAGE_PIXELS = 24_000_000; // ~24 megapixels
const THEME_KEY = "pixshrink-theme";
const SETTINGS_KEY = "pixshrink-settings";

const capabilities = {
  createImageBitmap: typeof createImageBitmap === "function",
  offscreenCanvas: typeof OffscreenCanvas !== "undefined",
  clipboard: !!(navigator.clipboard && navigator.clipboard.writeText),
  webp: false,
};

const usedFilenames = new Set();
let idCounter = 0;

/* ---------- Utilities ---------- */
function generateId() {
  idCounter += 1;
  return `f_${Date.now().toString(36)}_${idCounter}`;
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function formatBytes(bytes) {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDimensions(width, height) {
  return `${width} × ${height}`;
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* localStorage may be unavailable (private mode); fail silently */
  }
}

function revokeIfExists(url) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch (e) {
    /* ignore */
  }
}

/* ---------- Theme manager ---------- */
function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
  );
  if (persist) safeSet(THEME_KEY, theme);
}

function initTheme() {
  const stored = safeGet(THEME_KEY);
  applyTheme(stored === "light" ? "light" : "dark", false);
}

/* ---------- Toast manager ---------- */
function showToast(message, tone = "info", duration = 3400) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.tone = tone;
  toast.textContent = message;
  toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 200ms ease";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

/* ---------- Feature detection ---------- */
function detectWebpSupport() {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob((blob) => resolve(!!blob && blob.type === "image/webp"), "image/webp");
    } catch (e) {
      resolve(false);
    }
  });
}

/* ---------- File validation ---------- */
function validateFile(file) {
  if (!file || file.size === 0) {
    return { ok: false, reason: "This file appears to be empty." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return { ok: false, reason: "Unsupported file type. Please upload JPG, PNG, or WebP." };
    }
  }
  return { ok: true };
}

/* ---------- Image decoding ---------- */
async function decodeFile(file) {
  if (capabilities.createImageBitmap) {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, kind: "bitmap" };
    } catch (e) {
      /* fall through to <img> based decoding */
    }
  }
  return decodeViaImageElement(file);
}

function decodeViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        kind: "element",
        objectUrl: url,
      });
    };
    img.onerror = () => {
      revokeIfExists(url);
      reject(new Error("decode-failed"));
    };
    img.src = url;
  });
}

function discardDecoded(decoded) {
  if (!decoded) return;
  if (decoded.kind === "bitmap" && decoded.source && decoded.source.close) {
    try {
      decoded.source.close();
    } catch (e) {
      /* ignore */
    }
  }
  if (decoded.objectUrl) revokeIfExists(decoded.objectUrl);
}

/* ---------- Transparency detection ---------- */
async function detectTransparency(decoded, mimeType) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return false;

  const probeMax = 256;
  const scale = Math.min(1, probeMax / Math.max(decoded.width, decoded.height));
  const w = Math.max(1, Math.round(decoded.width * scale));
  const h = Math.max(1, Math.round(decoded.height * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(decoded.source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/* ---------- Resize logic ---------- */
function computeResizedDimensions(width, height, maxWidth, maxHeight) {
  if (!maxWidth && !maxHeight) return { width, height };
  const targetW = maxWidth || Infinity;
  const targetH = maxHeight || Infinity;
  const ratio = Math.min(targetW / width, targetH / height, 1); // never upscale
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/* ---------- Auto format logic ---------- */
function resolveOutputFormat(hasAlpha, sourceMime, webpSupported) {
  if (hasAlpha) {
    return webpSupported ? "webp" : "png";
  }
  if (webpSupported) return "webp";
  if (sourceMime === "image/png") return "png";
  return "jpeg";
}

/* ---------- Canvas helpers ---------- */
function createCanvas(width, height) {
  if (capabilities.offscreenCanvas) {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, mimeType, quality) {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    const opts = quality !== undefined ? { type: mimeType, quality } : { type: mimeType };
    return canvas.convertToBlob(opts);
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/* ---------- Compression engine ---------- */
async function compressImage(entry, settings) {
  const decoded = entry.decoded;
  const format =
    settings.format === "auto"
      ? resolveOutputFormat(entry.hasAlpha, entry.originalFile.type, capabilities.webp)
      : settings.format;

  const { width, height } = computeResizedDimensions(
    decoded.width,
    decoded.height,
    settings.maxWidth,
    settings.maxHeight
  );

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("encode-failed");

  if (format === "jpeg") {
    // JPEG has no alpha channel — flatten onto a white background.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(decoded.source, 0, 0, width, height);

  const mimeType = MIME_MAP[format];
  const quality = format === "png" ? undefined : settings.quality;
  let blob;
  try {
    blob = await canvasToBlob(canvas, mimeType, quality);
  } catch (e) {
    throw new Error("encode-failed");
  }
  if (!blob) throw new Error("encode-failed");

  return {
    blob,
    width,
    height,
    outputFormat: format,
    qualityUsed: format === "png" ? null : settings.quality,
  };
}

/* ---------- Target-size optimization (bounded binary search) ---------- */
async function optimizeToTargetSize(entry, settings) {
  const format =
    settings.format === "auto"
      ? resolveOutputFormat(entry.hasAlpha, entry.originalFile.type, capabilities.webp)
      : settings.format;

  if (format === "png") {
    throw new Error("target-size-unsupported-png");
  }

  const targetBytes = Math.max(1, settings.targetSizeKB) * 1024;
  let lo = 0.05;
  let hi = 0.98;
  let best = null;
  const maxIterations = 8;

  for (let i = 0; i < maxIterations; i += 1) {
    const q = (lo + hi) / 2;
    const result = await compressImage(entry, { ...settings, format, quality: q });
    if (!best || Math.abs(result.blob.size - targetBytes) < Math.abs(best.blob.size - targetBytes)) {
      best = result;
    }
    if (result.blob.size > targetBytes) {
      hi = q; // still too big — reduce quality
    } else {
      lo = q; // room to spare — try higher quality
    }
  }
  return best;
}

/* ---------- Friendly error messages ---------- */
function friendlyErrorMessage(err) {
  const code = err && err.message;
  if (code === "decode-failed") {
    return "We couldn't process this image in your browser. Try a smaller image or another format.";
  }
  if (code === "target-size-unsupported-png") {
    return "Target size doesn't apply to PNG output since PNG is lossless. Try WebP or JPEG instead.";
  }
  return "Something went wrong while optimizing this image. Please try again.";
}

/* ---------- Filename handling ---------- */
function buildBaseDownloadName(entry) {
  const original = entry.originalFile.name || "image";
  const dotIndex = original.lastIndexOf(".");
  const rawBase = dotIndex > 0 ? original.slice(0, dotIndex) : original;
  const safeBase = rawBase.replace(/[\\/:*?"<>|]/g, "_").trim() || "image";
  const ext = EXTENSION_MAP[entry.outputFormat] || "jpg";
  return `${safeBase}-optimized.${ext}`;
}

function reserveFilename(name) {
  if (!usedFilenames.has(name)) {
    usedFilenames.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > -1 ? name.slice(0, dot) : name;
  const ext = dot > -1 ? name.slice(dot) : "";
  let i = 2;
  let candidate = `${base}-${i}${ext}`;
  while (usedFilenames.has(candidate)) {
    i += 1;
    candidate = `${base}-${i}${ext}`;
  }
  usedFilenames.add(candidate);
  return candidate;
}

function releaseFilename(name) {
  if (name) usedFilenames.delete(name);
}

/* ---------- Statistics ---------- */
function computeReduction(originalSize, optimizedSize) {
  if (optimizedSize >= originalSize) return null;
  return ((originalSize - optimizedSize) / originalSize) * 100;
}

/* ---------- Clipboard ---------- */
async function copyText(text) {
  try {
    if (capabilities.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- Processing queue (controlled concurrency) ---------- */
const processingQueue = [];
let activeWorkers = 0;
const MAX_CONCURRENT = 2;

function enqueueEntry(entry) {
  entry.runToken = (entry.runToken || 0) + 1;
  entry.removed = false;
  state.batchNotified = false;
  if (!processingQueue.includes(entry)) {
    processingQueue.push(entry);
  }
  pump();
}

function pump() {
  while (activeWorkers < MAX_CONCURRENT && processingQueue.length) {
    const entry = processingQueue.shift();
    if (entry.removed) continue;
    activeWorkers += 1;
    processEntry(entry).finally(() => {
      activeWorkers -= 1;
      pump();
    });
  }
}

async function processEntry(entry) {
  const myToken = entry.runToken;
  setStatus(entry, "processing", "Optimizing…");
  try {
    if (!entry.decoded) {
      const decoded = await decodeFile(entry.originalFile);
      if (entry.removed || entry.runToken !== myToken) {
        discardDecoded(decoded);
        return;
      }
      entry.decoded = decoded;
      entry.width = decoded.width;
      entry.height = decoded.height;
      entry.originalUrl = entry.originalUrl || URL.createObjectURL(entry.originalFile);
      entry.hasAlpha = await detectTransparency(decoded, entry.originalFile.type);
      if (entry.removed || entry.runToken !== myToken) return;
      updateCardMeta(entry);
      maybeShowLargeImageNotice(entry);
    }

    const settings = buildEffectiveSettings();
    const result = entry.useTargetSize
      ? await optimizeToTargetSize(entry, settings)
      : await compressImage(entry, settings);

    if (entry.removed || entry.runToken !== myToken) return;

    applyResult(entry, result);
    setStatus(entry, "completed", "Complete");
  } catch (err) {
    if (entry.removed) return;
    if (err && err.message === "target-size-unsupported-png") {
      entry.useTargetSize = false;
    }
    handleEntryError(entry, err);
  }
}

/* ---------- Settings ---------- */
function buildEffectiveSettings() {
  const s = state.settings;
  return {
    quality: s.quality,
    format: s.format,
    maxWidth: s.maxDimension,
    maxHeight: s.maxDimension,
    targetSizeKB: s.targetSizeKB,
  };
}

function reprocessAll() {
  state.files.forEach((entry) => {
    entry.useTargetSize = false;
    enqueueEntry(entry);
  });
}

function setActivePresetButton(name) {
  state.settings.preset = name;
  presetButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.preset === name));
}

function applyPreset(name) {
  setActivePresetButton(name);
  if (name !== "custom" && PRESETS[name]) {
    state.settings.quality = PRESETS[name].quality;
    qualitySlider.value = String(Math.round(PRESETS[name].quality * 100));
    qualityValue.textContent = `${qualitySlider.value}%`;
  }
  persistSettings();
  reprocessAll();
}

function updateFormatHint() {
  const hints = {
    auto: "Format is chosen automatically based on transparency and browser support.",
    jpeg: "Lossy compression. Does not support transparency.",
    webp: "Strong compression with broad modern browser support.",
    png: "Lossless. The quality slider doesn't affect PNG output.",
  };
  formatHint.textContent = hints[state.settings.format] || "";
}

function updateQualityHint() {
  qualityHint.textContent =
    state.settings.format === "png" ? "Quality doesn't apply to PNG output since PNG is lossless." : "";
}

function updateResizeDisplay() {
  const value = Number(resizeSlider.value);
  if (value >= RESIZE_SLIDER_MAX) {
    resizeValue.textContent = "Original";
    resizeHint.textContent = "Drag left to cap the longest side. Aspect ratio is kept and images are never upscaled.";
  } else {
    resizeValue.textContent = `${value}px`;
    resizeHint.textContent = "Longest side is capped to this size. Aspect ratio is kept and images are never upscaled.";
  }
}

function updateTargetSizeDisplay() {
  const value = Number(targetSizeSlider.value);
  targetSizeValue.textContent = value >= 1000 ? `${(value / 1000).toFixed(1)} MB` : `${value} KB`;
}

function persistSettings() {
  safeSet(
    SETTINGS_KEY,
    JSON.stringify({
      preset: state.settings.preset,
      quality: state.settings.quality,
      format: state.settings.format,
      maxDimension: state.settings.maxDimension,
    })
  );
}

function restoreSettings() {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (saved.preset && (PRESETS[saved.preset] || saved.preset === "custom")) {
    setActivePresetButton(saved.preset);
  }
  if (typeof saved.quality === "number" && saved.quality > 0 && saved.quality <= 1) {
    state.settings.quality = saved.quality;
    qualitySlider.value = String(Math.round(saved.quality * 100));
    qualityValue.textContent = `${qualitySlider.value}%`;
  }
  if (saved.format && MIME_MAP[saved.format] !== undefined) {
    state.settings.format = saved.format;
    formatSelect.value = saved.format;
    qualitySlider.disabled = saved.format === "png";
  } else if (saved.format === "auto") {
    state.settings.format = "auto";
    formatSelect.value = "auto";
  }
  if (typeof saved.maxDimension === "number" && saved.maxDimension > 0) {
    state.settings.maxDimension = saved.maxDimension;
    resizeSlider.value = String(saved.maxDimension);
    updateResizeDisplay();
  }
}

/* ---------- Rendering: file cards ---------- */
function createFileCard(entry) {
  const fragment = fileCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".file-card");
  card.dataset.fileId = entry.id;
  card.dataset.status = "waiting";
  card.querySelector(".file-name").textContent = entry.originalFile.name;
  card.querySelector(".status-label").textContent = "Waiting";
  card.querySelector(".file-meta-size").textContent = formatBytes(entry.originalSize);

  card.querySelector(".btn-compare").addEventListener("click", () => toggleDetail(entry));
  card.querySelector(".btn-download").addEventListener("click", () => downloadEntry(entry));
  card.querySelector(".btn-retry").addEventListener("click", () => enqueueEntry(entry));
  card.querySelector(".btn-remove").addEventListener("click", () => removeEntry(entry.id));
  card.querySelector(".btn-copy-snippet").addEventListener("click", async () => {
    const snippet = card.querySelector(".dev-snippet").textContent;
    const ok = await copyText(snippet);
    showToast(ok ? "Copied" : "Could not copy to clipboard", ok ? "success" : "error");
  });

  setupCompareSlider(card.querySelector(".compare"));

  fileList.appendChild(card);
  entry.cardEl = card;
  return card;
}

function updateCardMeta(entry) {
  const el = entry.cardEl;
  const thumb = el.querySelector(".file-thumb img");
  thumb.src = entry.originalUrl;
  thumb.alt = "";
  el.querySelector(".file-meta-size").textContent = formatBytes(entry.originalSize);
  el.querySelector(".file-meta-dims").textContent = formatDimensions(entry.width, entry.height);
}

function maybeShowLargeImageNotice(entry) {
  if (!entry.largeNoticeShown && entry.width * entry.height > LARGE_IMAGE_PIXELS) {
    entry.largeNoticeShown = true;
    showToast("This is a large image and may take a little longer to process.", "info");
  }
}

function setStatus(entry, status, label) {
  entry.status = status;
  if (entry.cardEl) {
    entry.cardEl.dataset.status = status;
    entry.cardEl.querySelector(".status-label").textContent = label;
  }
  renderBatchSummary();
}

function applyResult(entry, result) {
  revokeIfExists(entry.optimizedUrl);
  entry.optimizedBlob = result.blob;
  entry.optimizedUrl = URL.createObjectURL(result.blob);
  entry.optimizedSize = result.blob.size;
  entry.optimizedWidth = result.width;
  entry.optimizedHeight = result.height;
  entry.outputFormat = result.outputFormat;
  entry.lastQualityUsed = result.qualityUsed;
  renderResult(entry);
}

function renderResult(entry) {
  const el = entry.cardEl;
  const resultBox = el.querySelector(".file-result");
  const reduction = computeReduction(entry.originalSize, entry.optimizedSize);

  resultBox.hidden = false;
  resultBox.querySelector(".file-result-size").textContent = formatBytes(entry.optimizedSize);
  if (reduction === null) {
    resultBox.dataset.larger = "true";
    resultBox.querySelector(".file-result-reduction").textContent = "Larger than original";
  } else {
    delete resultBox.dataset.larger;
    resultBox.querySelector(".file-result-reduction").textContent = `${reduction.toFixed(0)}% smaller`;
  }

  el.querySelector(".btn-compare").hidden = false;
  el.querySelector(".btn-download").hidden = false;
  el.querySelector(".btn-retry").hidden = true;
  el.querySelector(".file-error-msg").hidden = true;

  el.querySelector(".compare-after").src = entry.optimizedUrl;
  el.querySelector(".compare-before").src = entry.originalUrl;

  el.querySelector(".stat-original-size").textContent = formatBytes(entry.originalSize);
  el.querySelector(".stat-optimized-size").textContent = formatBytes(entry.optimizedSize);
  const saved = entry.originalSize - entry.optimizedSize;
  el.querySelector(".stat-saved").textContent = saved >= 0 ? formatBytes(saved) : `-${formatBytes(-saved)}`;
  el.querySelector(".stat-reduction").textContent = reduction === null ? "—" : `${reduction.toFixed(0)}%`;
  el.querySelector(".stat-dimensions").textContent = formatDimensions(entry.optimizedWidth, entry.optimizedHeight);
  el.querySelector(".stat-output").textContent = entry.outputFormat.toUpperCase();

  el.querySelector(".quality-warning").hidden = !(
    entry.lastQualityUsed != null && entry.lastQualityUsed < 0.5
  );
  el.querySelector(".size-warning").hidden = reduction !== null;
  el.querySelector(".transparency-warning").hidden = !(entry.outputFormat === "jpeg" && entry.hasAlpha);

  el.querySelector(".dev-filename").textContent = entry.originalFile.name;
  el.querySelector(".dev-mime").textContent = entry.originalFile.type || "unknown";
  el.querySelector(".dev-orig-dims").textContent = formatDimensions(entry.width, entry.height);
  el.querySelector(".dev-opt-dims").textContent = formatDimensions(entry.optimizedWidth, entry.optimizedHeight);
  el.querySelector(".dev-orig-size").textContent = formatBytes(entry.originalSize);
  el.querySelector(".dev-opt-size").textContent = formatBytes(entry.optimizedSize);
  el.querySelector(".dev-format").textContent = entry.outputFormat.toUpperCase();

  releaseFilename(entry.downloadFilename);
  entry.downloadFilename = reserveFilename(buildBaseDownloadName(entry));
  el.querySelector(".dev-snippet").textContent = `<img src="${entry.downloadFilename}" alt="Optimized image">`;

  renderBatchSummary();
}

function handleEntryError(entry, err) {
  entry.status = "error";
  entry.error = friendlyErrorMessage(err);
  const el = entry.cardEl;
  if (el) {
    el.dataset.status = "error";
    el.querySelector(".status-label").textContent = "Error";
    const msg = el.querySelector(".file-error-msg");
    msg.hidden = false;
    msg.textContent = entry.error;
    el.querySelector(".btn-retry").hidden = false;
    el.querySelector(".btn-compare").hidden = true;
    el.querySelector(".btn-download").hidden = true;
    el.querySelector(".file-result").hidden = true;
  }
  renderBatchSummary();
}

function toggleDetail(entry) {
  const detail = entry.cardEl.querySelector(".file-detail");
  const btn = entry.cardEl.querySelector(".btn-compare");
  const wasHidden = detail.hidden;
  detail.hidden = !wasHidden;
  btn.textContent = wasHidden ? "Hide comparison" : "Compare";
}

/* ---------- Before / after comparison slider ---------- */
function setupCompareSlider(compareEl) {
  const beforeWrap = compareEl.querySelector(".compare-before-wrap");
  const handle = compareEl.querySelector(".compare-handle");
  let dragging = false;

  function setPosition(percent) {
    const clamped = Math.min(100, Math.max(0, percent));
    beforeWrap.style.clipPath = `inset(0 ${100 - clamped}% 0 0)`;
    handle.style.left = `${clamped}%`;
    compareEl.setAttribute("aria-valuenow", String(Math.round(clamped)));
  }

  function percentFromClientX(clientX) {
    const rect = compareEl.getBoundingClientRect();
    if (!rect.width) return 50;
    return ((clientX - rect.left) / rect.width) * 100;
  }

  compareEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    try {
      compareEl.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    setPosition(percentFromClientX(e.clientX));
  });
  compareEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    setPosition(percentFromClientX(e.clientX));
  });
  ["pointerup", "pointercancel"].forEach((evt) =>
    compareEl.addEventListener(evt, () => {
      dragging = false;
    })
  );

  compareEl.addEventListener("keydown", (e) => {
    const current = parseFloat(compareEl.getAttribute("aria-valuenow")) || 50;
    if (e.key === "ArrowLeft") {
      setPosition(current - 5);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      setPosition(current + 5);
      e.preventDefault();
    } else if (e.key === "Home") {
      setPosition(0);
      e.preventDefault();
    } else if (e.key === "End") {
      setPosition(100);
      e.preventDefault();
    }
  });

  setPosition(50);
}

/* ---------- Batch summary ---------- */
function renderBatchSummary() {
  const total = state.files.length;
  if (total === 0) {
    batchSummary.textContent = "";
    downloadAllBtn.hidden = true;
    return;
  }

  const completed = state.files.filter((f) => f.status === "completed");
  const processing = state.files.filter((f) => f.status === "processing").length;
  const errors = state.files.filter((f) => f.status === "error");
  const doneCount = completed.length + errors.length;

  if (doneCount < total) {
    batchSummary.textContent = `Processing ${Math.min(
      doneCount + (processing ? 1 : 0),
      total
    )} of ${total} · ${completed.length} completed${errors.length ? `, ${errors.length} failed` : ""}`;
    state.batchNotified = false;
  } else {
    const totalOriginal = completed.reduce((sum, f) => sum + f.originalSize, 0);
    const totalOptimized = completed.reduce((sum, f) => sum + f.optimizedSize, 0);
    const saved = totalOriginal - totalOptimized;
    const pct = totalOriginal > 0 ? (saved / totalOriginal) * 100 : 0;
    const savedText = saved > 0 ? `saved ${formatBytes(saved)} (${pct.toFixed(0)}% smaller)` : "no overall size reduction";
    batchSummary.textContent = `${completed.length} of ${total} completed${
      errors.length ? `, ${errors.length} failed` : ""
    } · ${savedText}`;

    if (!state.batchNotified && total > 0) {
      state.batchNotified = true;
      showToast(total === 1 ? "Compression complete" : `${completed.length} of ${total} images optimized`, "success");
    }
  }

  downloadAllBtn.hidden = completed.length === 0;
}

/* ---------- Download manager ---------- */
function downloadEntry(entry) {
  if (!entry.optimizedBlob || !entry.optimizedUrl) return;
  const a = document.createElement("a");
  a.href = entry.optimizedUrl;
  a.download = entry.downloadFilename || buildBaseDownloadName(entry);
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast("Download started", "info");
}

function downloadAll() {
  const completed = state.files.filter((f) => f.status === "completed" && f.optimizedBlob);
  if (!completed.length) return;
  completed.forEach((entry, i) => {
    setTimeout(() => downloadEntry(entry), i * 220);
  });
}

/* ---------- Add / remove / reset ---------- */
function showWorkspace() {
  workspaceSection.hidden = false;
}

function hideWorkspace() {
  workspaceSection.hidden = true;
}

function handleIncomingFiles(fileArray) {
  const validFiles = [];
  fileArray.forEach((file) => {
    const validation = validateFile(file);
    if (!validation.ok) {
      showToast(validation.reason, "error");
      return;
    }
    validFiles.push(file);
  });
  if (!validFiles.length) return;

  showWorkspace();
  validFiles.forEach((file) => {
    const entry = {
      id: generateId(),
      originalFile: file,
      originalSize: file.size,
      status: "waiting",
      runToken: 0,
      removed: false,
      useTargetSize: false,
    };
    state.files.push(entry);
    createFileCard(entry);
    enqueueEntry(entry);
  });
  renderBatchSummary();
}

function cleanupEntryResources(entry) {
  revokeIfExists(entry.originalUrl);
  revokeIfExists(entry.optimizedUrl);
  if (entry.decoded) discardDecoded(entry.decoded);
  releaseFilename(entry.downloadFilename);
}

function removeEntry(id) {
  const index = state.files.findIndex((f) => f.id === id);
  if (index === -1) return;
  const entry = state.files[index];
  entry.removed = true;
  entry.runToken = (entry.runToken || 0) + 1;
  cleanupEntryResources(entry);
  state.files.splice(index, 1);
  if (entry.cardEl) entry.cardEl.remove();
  renderBatchSummary();
  if (state.files.length === 0) hideWorkspace();
  showToast("File removed", "info");
}

function clearAll() {
  if (!state.files.length) return;
  state.files.forEach(cleanupEntryResources);
  state.files = [];
  fileList.innerHTML = "";
  usedFilenames.clear();
  hideWorkspace();
  showToast("All images cleared", "info");
}

/* ---------- Drag & drop ---------- */
function initDragAndDrop() {
  ["dragenter", "dragover", "dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  dropzone.addEventListener("dragenter", () => dropzone.classList.add("is-dragover"));
  dropzone.addEventListener("dragover", () => dropzone.classList.add("is-dragover"));
  dropzone.addEventListener("dragleave", (e) => {
    if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove("is-dragover");
  });
  dropzone.addEventListener("drop", (e) => {
    dropzone.classList.remove("is-dragover");
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    handleIncomingFiles(files);
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
}

/* ---------- Event binding ---------- */
const scheduleReprocessDebounced = debounce(() => reprocessAll(), 400);
const scheduleResizeDebounced = debounce(() => reprocessAll(), 400);

function bindEvents() {
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  heroCtaBtn.addEventListener("click", () => fileInput.click());
  addMoreBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    handleIncomingFiles(Array.from(fileInput.files || []));
    fileInput.value = "";
  });

  initDragAndDrop();

  presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  qualitySlider.addEventListener("input", () => {
    qualityValue.textContent = `${qualitySlider.value}%`;
    state.settings.quality = Number(qualitySlider.value) / 100;
    setActivePresetButton("custom");
    persistSettings();
    scheduleReprocessDebounced();
  });

  formatSelect.addEventListener("change", () => {
    state.settings.format = formatSelect.value;
    qualitySlider.disabled = formatSelect.value === "png";
    updateFormatHint();
    updateQualityHint();
    persistSettings();
    reprocessAll();
  });

  resizeSlider.addEventListener("input", () => {
    updateResizeDisplay();
    const value = Number(resizeSlider.value);
    state.settings.maxDimension = value >= RESIZE_SLIDER_MAX ? null : value;
    persistSettings();
    scheduleResizeDebounced();
  });

  targetSizeSlider.addEventListener("input", updateTargetSizeDisplay);

  targetSizeBtn.addEventListener("click", () => {
    const kb = Number(targetSizeSlider.value);
    if (!kb || kb <= 0) {
      showToast("Choose a target size.", "error");
      return;
    }
    if (!state.files.length) {
      showToast("Upload an image first.", "error");
      return;
    }
    state.settings.targetSizeKB = kb;
    state.files.forEach((entry) => {
      entry.useTargetSize = true;
      enqueueEntry(entry);
    });
  });

  downloadAllBtn.addEventListener("click", downloadAll);
  clearAllBtn.addEventListener("click", clearAll);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".file-detail:not([hidden])").forEach((detail) => {
      detail.hidden = true;
      const card = detail.closest(".file-card");
      const btn = card && card.querySelector(".btn-compare");
      if (btn) btn.textContent = "Compare";
    });
  });
}

/* ---------- Initialization ---------- */
function init() {
  initTheme();
  restoreSettings();
  updateFormatHint();
  updateQualityHint();
  updateResizeDisplay();
  updateTargetSizeDisplay();
  bindEvents();

  detectWebpSupport().then((supported) => {
    capabilities.webp = supported;
    if (!supported) {
      const webpOption = formatSelect.querySelector('option[value="webp"]');
      if (webpOption) {
        webpOption.disabled = true;
        webpOption.textContent = "WebP (not supported in this browser)";
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
