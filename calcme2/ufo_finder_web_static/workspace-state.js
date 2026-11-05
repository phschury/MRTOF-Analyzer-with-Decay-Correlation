// Save locally for immediate recovery and on the server for recovery after reboot.
(() => {
  const key = 'ufoFinderWorkspace.v1';
  const outputIds = ['Mass1', 'Mass2', 'MassAna', 'lblCalct0', 'lblb',
    'lblMassExcess', 'lbldM', 'lblDM', 'lblSearching'];
  const controls = [...document.querySelectorAll('input[id], select[id]')];
  let saved, timer, remoteTimer, pending, writing = false;
  const serverEnabled = typeof fetch === 'function';
  let loading = serverEnabled, serverReadable = !serverEnabled, changed = false;
  const notice = document.createElement('p');
  notice.id = 'workspaceSaveStatus';
  notice.setAttribute('role', 'status');
  notice.style.cssText = 'position:fixed;bottom:0;left:0;background:white;color:#a00;z-index:1000;margin:0';
  document.body.appendChild(notice);
  try {
    saved = JSON.parse(localStorage.getItem(key));
    if (saved && saved.version !== 1) saved = null;
    // Migrate the earlier, reference-only settings if present.
    if (!saved) {
      const legacy = JSON.parse(localStorage.getItem('ufoFinderLastRefSettings'));
      if (legacy) saved = {version: 1, fields: legacy};
    }
  } catch { notice.textContent = 'Saved workspace could not be read. Changes will be saved as you work.'; }

  // Store only text and sub/superscripts; never load executable HTML from storage.
  function pack(node) {
    return node.nodeType === 3 ? node.textContent : {
      tag: ['SUP', 'SUB'].includes(node.nodeName) ? node.nodeName : 'SPAN',
      children: [...node.childNodes].map(pack)
    };
  }
  function unpack(value) {
    if (typeof value === 'string') return document.createTextNode(value);
    const node = document.createElement(['SUP', 'SUB'].includes(value.tag) ? value.tag : 'span');
    for (const child of value.children || []) node.appendChild(unpack(child));
    return node;
  }
  function restoreElements() {
    if (!saved?.elements) return;
    periodicData.forEach((element, index) => {
      element.selected = (saved.radioactiveElements || []).includes(element.Symbol) ? 'R' :
        saved.elements.includes(element.Symbol) ? 'Y' : 'N';
      updateElementButton(element, document.getElementById('btnElement' + index));
    });
  }
  document.addEventListener('ufo-elements-ready', restoreElements, {once: true});
  function restore() {
    if (!saved) return;
  // Earlier workspaces applied the radioactive limit to every selected element.
  if (saved && !Array.isArray(saved.radioactiveElements)) {
    saved.radioactiveElements = Number(saved.fields?.selMaxRI) > 0 ? [...(saved.elements || [])] : [];
  }
    try {
      for (const control of controls) {
        if (typeof saved.fields?.[control.id] === 'string') control.value = saved.fields[control.id];
      }
      for (const id of outputIds) {
        if (typeof saved.outputs?.[id] === 'string') document.getElementById(id).textContent = saved.outputs[id];
      }
      for (const [name, fallback] of [['t0', t0withErr], ['b', bwithErr]]) {
        const pair = saved[name];
        if (pair && Number.isFinite(Number(pair.val)) && Number.isFinite(Number(pair.err))) {
          Object.assign(fallback, pair);
        }
      }
      if (saved.rows) {
        const body = clearSCMTable();
        for (const row of saved.rows) {
          const tr = document.createElement('tr');
          if (row.radioactive) tr.style.backgroundColor = 'pink';
          for (const cell of row.cells) {
            const td = document.createElement('td');
            if (typeof cell.copyText === 'string') td.dataset.copyText = cell.copyText;
            for (const child of cell.content) td.appendChild(unpack(child));
            tr.appendChild(td);
          }
          body.appendChild(tr);
        }
      }
      if (saved.searching) {
        document.getElementById('lblSearching').textContent =
          'Search interrupted when closed. Results so far restored; Find Them! starts a new search.';
      }
      restoreElements();
    } catch { notice.textContent = 'Some saved workspace data could not be restored.'; }
  }

  restore();

  function save() {
    clearTimeout(timer);
    if (loading || (!serverReadable && !changed)) return;
    try {
      const snapshot = {
        version: 1, updatedAt: Date.now(),
        fields: Object.fromEntries(controls.map(control => [control.id, control.value])),
        outputs: Object.fromEntries(outputIds.map(id => [id, document.getElementById(id).textContent])),
        t0: {...t0withErr}, b: {...bwithErr},
        // Preserve saved selection while the asynchronous periodic table loads.
        elements: periodicData.length ? periodicData.filter(e => e.selected === 'Y').map(e => e.Symbol) : saved?.elements || [],
        radioactiveElements: periodicData.length ? periodicData.filter(e => e.selected === 'R').map(e => e.Symbol) : saved?.radioactiveElements || [],
        searching: !!activeSCMSearch || document.getElementById('btnFindSCM').textContent === 'Stop',
        rows: [...document.querySelectorAll('#SCMTable tbody tr')].map(row => ({
          radioactive: row.style.backgroundColor === 'pink',
          cells: [...row.children].map(cell => ({copyText: cell.dataset.copyText,
            content: [...cell.childNodes].map(pack)}))
        }))
      };
      saved = snapshot;
      pending = snapshot;
      try {
        localStorage.setItem(key, JSON.stringify(snapshot));
        notice.textContent = '';
      } catch {
        notice.textContent = serverEnabled ? 'Browser backup unavailable. Saving workspace on the server…' : 'Workspace could not be saved. Keep this tab open and export results before closing.';
      }
      if (serverEnabled) {
        clearTimeout(remoteTimer);
        remoteTimer = setTimeout(upload, 500);
      }
    } catch {
      notice.textContent = 'Workspace could not be saved (browser storage unavailable or full). Keep this tab open and export results before closing.';
    }
  }
  async function upload() {
    clearTimeout(remoteTimer);
    if (!pending || writing || loading || !serverEnabled || !serverReadable) return;
    writing = true;
    const snapshot = pending;
    try {
      const response = await fetch('/api/ufo-workspace', {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(snapshot)
      });
      if (!response.ok) throw new Error('Save failed');
      if (pending === snapshot) pending = null;
      notice.textContent = '';
    } catch {
      notice.textContent = 'Server save unavailable. Browser backup retained; retrying automatically.';
    } finally {
      writing = false;
      if (pending) remoteTimer = setTimeout(upload, 5000);
    }
  }
  async function connect() {
    try {
      const response = await fetch('/api/ufo-workspace', {cache: 'no-store', signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error('Load failed');
      const remote = (await response.json()).workspace;
      // Edits made while disconnected take precedence over the earlier disk copy.
      if (!pending && remote?.version === 1 && (!saved || (remote.updatedAt || 0) > (saved.updatedAt || 0))) {
        saved = remote;
        restore();
      }
      serverReadable = true;
    } catch {
      notice.textContent = 'Server workspace unavailable. Using browser backup; retrying automatically.';
      setTimeout(connect, 5000);
    } finally {
      loading = false;
      document.body.inert = false;
    }
    if (serverReadable) {
      // Also migrate existing browser-only workspaces to the server.
      save();
      upload();
    }
  }
  if (serverEnabled) {
    // Avoid replacing a disk workspace with page defaults before it has loaded.
    document.body.inert = true;
    connect();
  }
  const schedule = () => { if (loading) return; changed = true; clearTimeout(timer); timer = setTimeout(save, 200); };
  const edit = () => { changed = true; save(); };
  document.addEventListener('input', edit);
  document.addEventListener('change', edit);
  document.addEventListener('click', edit);
  // Covers asynchronous result batches and programmatic calculation outputs.
  const observer = new MutationObserver(schedule);
  for (const id of [...outputIds, 'SCMTable']) {
    observer.observe(document.getElementById(id), {childList: true, subtree: true, characterData: true});
  }
  window.addEventListener('pagehide', () => {
    save();
    if (pending && serverEnabled && serverReadable) {
      const body = JSON.stringify(pending);
      // Larger results remain in the browser backup; ordinary autosaves upload
      // without the browser's small keepalive request limit.
      fetch('/api/ufo-workspace', {method: 'PUT', headers: {'Content-Type': 'application/json'},
        body, keepalive: new Blob([body]).size < 60000}).catch(() => {});
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
})();
