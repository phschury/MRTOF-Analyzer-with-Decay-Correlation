UFO Finder / MRTOF Calculator - Static Web Version
==================================================

This folder is intended to run from a normal static webserver with no Node.js,
Electron, or backend process.

Required files:
- index.html
- index.css
- render.js
- searchWorker.js
- nubase_4.mas20.txt
- periodic.data
- wnsc_logo.png
- Mirror.png
- workspace-state.js
- manual.html
- images/manual-top.png
- images/manual-ufo-search.png

How to deploy:
1. Upload all files in this folder to the same directory on your webserver.
2. Open index.html through the webserver URL.

Important:
- Do not open index.html directly with file:// for normal use. Browser security
  restrictions commonly block fetch() and Web Worker loading from file://.
- A simple static server is sufficient. No server-side code is needed.

What changed from the Electron version:
- Removed the hard dependency on window.electronAPI/preload.js.
- Kept the Web Worker search architecture. searchWorker.js is loaded directly
  by the browser from the same directory.
- Data files are loaded with fetch() from the same directory.
- Electron-only files such as main.js, preload.js, package.json, and forge config
  are not required for this static deployment.

In MRTOF Analyzer this folder is served at /ufo-finder/.
workspace-state.js saves locally and via /api/ufo-workspace. MRTOF Analyzer
stores the server copy in outputs/ufo-workspace.json across server restarts.
On a standalone static server, only the browser backup is available.
