# Path Draw

A small browser tool for drawing a freehand path, shaping it with Bézier handles, giving it a gradient stroke, and exporting it as a static or animated SVG.

## Features

- **Draw** a path by dragging on the canvas. It smooths into an editable curve when you release.
- **Edit** anchors and handles, click the path to add a point, and delete anchors you don't need. Anchors can be symmetric, asymmetric or sharp.
- **Move** the whole path around the canvas.
- **Load SVG** to bring in the first `<path>` from an existing file.
- **Style** the stroke with a line width from 1 to 200 and a multi-stop gradient that follows the path.
- **Animate** the stroke drawing itself on, with a duration from 0.3 to 6 seconds, six easing presets and a reverse direction.
- **Export** the result as a static or animated SVG. Animated exports need no JavaScript or CSS.

The canvas size is set in the toolbar and defaults to 400 × 400.

## Getting started

You'll need [Node.js](https://nodejs.org) 20, or 22 and newer.

```sh
npm install
npm run dev
```

Then open the local URL Vite prints.

| Command           | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Starts the dev server                         |
| `npm run build`   | Typechecks and builds to `dist/`              |
| `npm run preview` | Serves the production build locally           |

## Built with

React, TypeScript and Vite. Nearly all of the app lives in [`src/App.tsx`](src/App.tsx).

## License

[MIT](LICENSE)
