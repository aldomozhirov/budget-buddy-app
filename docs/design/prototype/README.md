# Budget Buddy prototype

Snapshot of the clickable prototype the owner reviewed (version of 2026-10-06). The rules it shows are written down in `docs/design-spec.md`; read that first and use these files as the visual and behavioural reference.

- For building, prefer `docs/design/html/`: the same screens as plain static HTML with screenshots, and `bb.css`, the consolidated stylesheet.
- One `*.dc.html` file per screen. `docs/design-spec.md` section 2 maps each file to its screen and requirements, and section 19 explains how to read a file and what to ignore in it.
- `canvas.json` is the canvas layout: board titles, positions and order.
- The files do not run on their own. They need the design tool's runtime (`support.js`), which is not in the repository. Read them as source.
- Do not copy their code into the app. The data is invented, navigation is faked with session storage, and the font is loaded from Google Fonts, which the app must not do (SEC-7).
- The live version, which the owner may keep editing, is the private Claude artifact linked in `docs/design-spec.md`. If it changes, replace this folder with a fresh copy rather than editing files here.
