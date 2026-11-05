const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const prefix = path.resolve(path.dirname(process.execPath), '..');
const candidates = [process.env.npm_config_node_gyp,
  path.join(prefix, 'lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js'),
  path.join(prefix, 'libexec/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js')].filter(Boolean);
const gyp = candidates.find(p => fs.existsSync(p));
if (!gyp) throw new Error('node-gyp not found. Run this script through npm with a Node.js development installation.');
const headers = process.env.NODE_HEADERS_DIR || prefix;
const args = [gyp, 'rebuild'];
if (fs.existsSync(path.join(headers, 'include/node/node_api.h'))) args.push('--nodedir=' + headers);
const result = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
