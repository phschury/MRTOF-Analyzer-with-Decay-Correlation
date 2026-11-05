const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

// A single UFO Finder workspace, independent of the Analyzer's in-memory session.
function mountUfoWorkspace(app, file = path.join(__dirname, 'outputs', 'ufo-workspace.json')) {
  app.get('/api/ufo-workspace', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const workspace = JSON.parse(fs.readFileSync(file, 'utf8'));
      res.json({ok: true, workspace});
    } catch (error) {
      if (error.code === 'ENOENT') return res.json({ok: true, workspace: null});
      res.status(500).json({ok: false, error: 'Could not read the saved UFO Finder workspace.'});
    }
  });
  app.put('/api/ufo-workspace', (req, res) => {
    const workspace = req.body;
    if (!workspace || workspace.version !== 1 || !workspace.fields || typeof workspace.fields !== 'object' ||
        Array.isArray(workspace.fields) || !Array.isArray(workspace.rows) || !Array.isArray(workspace.elements) ||
        !Array.isArray(workspace.radioactiveElements) || !Number.isFinite(workspace.updatedAt)) {
      return res.status(400).json({ok: false, error: 'Invalid UFO Finder workspace.'});
    }
    const temporary = file + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(workspace));
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file);
      res.json({ok: true});
    } catch {
      res.status(500).json({ok: false, error: 'Could not save the UFO Finder workspace to disk.'});
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch {}
    }
  });
}
module.exports = {mountUfoWorkspace};
