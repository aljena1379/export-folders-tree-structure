// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();

  const elTree = document.getElementById('tree');
  const elRoot = document.getElementById('root-label');
  const elStatFolders = document.getElementById('stat-folders');
  const elStatFiles = document.getElementById('stat-files');
  const elStatSize = document.getElementById('stat-size');
  const elStatTime = document.getElementById('stat-time');
  const elChips = document.getElementById('pattern-chips');
  const elInput = document.getElementById('pattern-input');
  const elFeedback = document.getElementById('copy-feedback');
  const elBtnRefresh = document.getElementById('btn-refresh');
  const elBtnCopy = document.getElementById('btn-copy');
  const elBtnExport = document.getElementById('btn-export');
  const elBtnAdd = document.getElementById('btn-add-pattern');
  const elOptFiles = document.getElementById('opt-include-files');
  const elOptHidden = document.getElementById('opt-include-hidden');
  const elOptSize = document.getElementById('opt-show-size');

  let currentLines = [];
  let expanded = true;

  function showFeedback(text) {
    elFeedback.textContent = text;
    elFeedback.classList.add('show');
    clearTimeout(showFeedback._t);
    showFeedback._t = setTimeout(() => elFeedback.classList.remove('show'), 2200);
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exp = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1
    );
    const v = bytes / Math.pow(1024, exp);
    return (
      (exp === 0 ? v.toString() : v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)) +
      ' ' +
      units[exp]
    );
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderLines(lines, limit) {
    const slice = limit > 0 ? lines.slice(0, limit) : lines;
    const html = slice
      .map((ln, idx) => {
        const isFirst = idx === 0;
        const cls = isFirst
          ? 'root'
          : ln.truncated
          ? 'truncated'
          : ln.isDir
          ? 'dir'
          : 'file';
        return (
          '<span class="' +
          cls +
          '">' +
          escapeHtml(ln.text) +
          '</span>'
        );
      })
      .join('\n');
    const tail = limit > 0 && lines.length > limit ? '\n… ' + (lines.length - limit) + ' more lines' : '';
    elTree.innerHTML = html + tail;
  }

  function applyRender() {
    if (expanded) {
      renderLines(currentLines, 0);
    } else {
      renderLines(currentLines, 60);
    }
  }

  function renderChips(payload) {
    const defaults = Array.isArray(payload.defaults) ? payload.defaults : [];
    const customs = Array.isArray(payload.customs) ? payload.customs : [];
    elChips.innerHTML = '';

    if (customs.length > 0) {
      const cat = document.createElement('div');
      cat.className = 'chip-category';
      cat.textContent = 'Custom patterns';
      elChips.appendChild(cat);
      customs.forEach((p) => elChips.appendChild(makeChip(p, false)));
    }
    if (defaults.length > 0) {
      const cat = document.createElement('div');
      cat.className = 'chip-category';
      cat.textContent = 'Default patterns (edit in settings.json)';
      elChips.appendChild(cat);
      defaults.forEach((p) => elChips.appendChild(makeChip(p, true)));
    }
    if (customs.length === 0 && defaults.length === 0) {
      const cat = document.createElement('div');
      cat.className = 'chip-category';
      cat.textContent = 'No ignore patterns configured';
      elChips.appendChild(cat);
    }
  }

  function makeChip(text, builtin) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (builtin ? ' builtin' : '');
    const t = document.createElement('span');
    t.textContent = text;
    chip.appendChild(t);
    if (!builtin) {
      const btn = document.createElement('button');
      btn.title = 'Remove pattern';
      btn.textContent = '×';
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'removePattern', pattern: text });
      });
      chip.appendChild(btn);
    }
    return chip;
  }

  elBtnRefresh.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });
  elBtnCopy.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyToClipboard' });
  });
  elBtnExport.addEventListener('click', () => {
    vscode.postMessage({ type: 'exportToFile' });
  });

  elBtnAdd.addEventListener('click', () => {
    const v = (elInput.value || '').trim();
    if (!v) return;
    vscode.postMessage({ type: 'addPatterns', patterns: [v] });
    elInput.value = '';
  });
  elInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      elBtnAdd.click();
    }
  });

  function bindToggle(el, key) {
    el.addEventListener('change', () => {
      vscode.postMessage({ type: 'setOption', key, value: el.checked });
    });
  }
  bindToggle(elOptHidden, 'includeHidden');
  bindToggle(elOptSize, 'showFileSize');

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'result') {
      const p = msg.payload;
      currentLines = Array.isArray(p.lines) ? p.lines : [];
      elRoot.textContent = p.rootPath;
      elRoot.title = p.rootPath;
      elStatFolders.textContent = String(p.stats.totalFolders);
      elStatFiles.textContent = String(p.stats.totalFiles);
      elStatSize.textContent = formatBytes(p.stats.totalSize);
      elStatTime.textContent = new Date(p.stats.generatedAt).toLocaleTimeString();
      if (p.options) {
        elOptHidden.checked = !!p.options.includeHidden;
        elOptSize.checked = !!p.options.showFileSize;
      }
      applyRender();
    } else if (msg.type === 'patterns') {
      renderChips(msg.payload);
    } else if (msg.type === 'feedback') {
      showFeedback(msg.payload.message || '');
    } else if (msg.type === 'error') {
      elTree.textContent = '✗ ' + (msg.payload.message || 'Unknown error');
    }
  });
})();
