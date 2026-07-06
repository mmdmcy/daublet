# Architecture

Daublet is a static browser app:

- `index.html` defines the application shell and native file inputs.
- `styles.css` contains the responsive editor layout and control styling.
- `app.js` owns all editor state, rendering, import/export, undo/redo, and
  project serialization.

The artboard is a canvas renderer backed by an object list. Layers are stored
as JSON objects for paths, images, text, and vector shapes. The renderer clears
and redraws the full scene after every state change, then paints selection
handles on top. Export creates an offscreen canvas and draws the same object
list without editor chrome.

Imported images are stored as data URLs inside project files. This keeps
`.daublet.json` files self-contained, at the cost of larger project files for
large images.
