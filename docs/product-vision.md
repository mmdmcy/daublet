# Product Vision

Daublet is a small local graphics utility for people who need the useful parts
of a paint program without installing a heavy editor. The core promise is that
imported pictures, text, and shapes stay editable until the user chooses to
export a flattened image.

## Goals

- Stay zero-dependency at runtime.
- Keep the first screen as the working editor, not a landing page.
- Make common annotation work fast: image import, move, resize, arrows, labels,
  boxes, circles, text, and export.
- Prefer explicit project files over hidden local storage so work is portable.
- Keep the code easy to inspect and hack on.

## Non-goals

- Compete with full raster editors.
- Add cloud storage, accounts, telemetry, or hosted collaboration.
- Require a package manager, build pipeline, or framework for normal use.
