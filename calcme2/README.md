# UFO Finder / MRTOF Calculator

The integrated browser version lives in `ufo_finder_web_static/`.
Start the parent MRTOF Analyzer with `npm start`, then choose **UFO Finder**
on its home page (or open http://localhost:3000/ufo-finder/).
No separate installation or Electron build is needed.

Keep the web folder together: it includes the calculation and search scripts,
workspace persistence, NUBASE and periodic data, images, and the user manual.
Workspace state is automatically saved to `outputs/ufo-workspace.json` in the
parent project and restored after server restarts. Keep this file when moving
or updating the app. Browser local storage provides an additional backup.
The server has one shared UFO Finder workspace; the latest save is restored.

Original project: https://github.com/phschury/calcme
The original license reference is retained in `LICENSE.webloc`.

The web version includes a User Manual link. Click an element for natural
isotopes (green); Shift-click for natural plus radioactive isotopes (pink).
Radioactive isotopes require Max RI Atoms greater than zero. Selections are saved.
