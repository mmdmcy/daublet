# Daublet

Daublet is a lightweight local paint app for quick annotations, simple shapes,
text, and movable image layers. It is a static web app with no third-party
runtime dependencies.

The name comes from "daub": to apply or smear paint. The `-let` ending keeps it
small and tool-like, matching the goal of a lean local editor.

## Features

- Import images as movable, resizable layers.
- Draw brush and eraser strokes.
- Add rectangles, ellipses, lines, arrows, and text.
- Reorder, hide, lock, duplicate, and delete layers.
- Save editable `.daublet.json` project files.
- Export flattened PNG, JPEG, or WebP images.
- Runs locally by opening `index.html`.

## Run

Open `index.html` in a modern desktop browser.

Optional local server for browser testing:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Test

There is no build step. For a quick syntax check:

```sh
node --check app.js
```

If Node.js is not installed, open `index.html` and exercise import, shape,
text, project save/open, and export manually.

## Repository Status

This repo is intended to be public/open source. Do not commit private host
names, private IPs, tokens, passwords, local runtime state, or machine-specific
agent notes.
