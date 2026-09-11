# PixShrink

**Compress images. Keep the quality.**

PixShrink is a fast, privacy-first image compression and optimization tool that runs entirely inside your browser. Upload JPG, PNG, or WebP images, choose your settings, compare the results, and download — nothing is ever sent to a server.

> **Your images never leave your browser.**

## Features

- JPG / JPEG compression
- PNG optimization with transparency support
- WebP encoding (where the browser supports it)
- Batch compression with controlled concurrency
- Quality control with presets (Maximum Quality, Balanced, Web Optimized, Smallest Size, Custom)
- Optimize-to-target-size mode (bounded binary search on quality)
- Optional resizing with aspect ratio preserved (never upscales)
- Before/after comparison slider (mouse, touch, and keyboard)
- Accurate, real-time compression statistics
- Light and dark mode, persisted across visits
- Fully keyboard-accessible, screen-reader-friendly interface
- Browser-based, offline-capable, and free — no account required

## Technology

- HTML5
- CSS3 (custom properties, no build step)
- Vanilla JavaScript (ES2020+, no frameworks or bundlers)
- Canvas API / OffscreenCanvas for encoding
- File API, Blob, and Object URLs for local file handling
- `createImageBitmap()` where supported, with an `<img>`-based fallback

No Node server, database, authentication, or third-party API is used anywhere in this project.

## Privacy

PixShrink processes every image directly on your device using the browser's Canvas API. Files are never uploaded, transmitted, or stored outside your machine:

- No backend or API calls for image processing
- No image data, filenames, or metadata sent to analytics or third parties
- No image content ever written to `localStorage` — only your theme and compression preferences are persisted
- No account or sign-in required

You can confirm this yourself: open your browser's network tab while compressing an image and you'll see no outgoing requests carrying image data.

## Getting started

No build step is required. Just open the app:

```
open index.html
```

Or serve it with any static file server if your browser restricts local file access for module-like features:

```
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Deployment

PixShrink is a static site — deploy the `PixShrink/` folder as-is to any static host:

- **GitHub Pages** — push to a repository and enable Pages for the branch/folder.
- **Netlify** — drag and drop the folder onto the Netlify dashboard, or connect the repo.
- **Vercel** — import the repository and deploy with the default static preset.
- **Cloudflare Pages** — connect the repository with no build command and `/` as the output directory.

## Project structure

```
PixShrink/
├── index.html
├── style.css
├── script.js
├── favicon.svg
└── README.md
```

## Browser support

Targets current versions of Chrome, Edge, Firefox, and Safari. Feature detection is used for `createImageBitmap`, `OffscreenCanvas`, the Clipboard API, and WebP encoding, with graceful fallbacks where a feature isn't available.

## License

Use, modify, and deploy freely for your own projects.
