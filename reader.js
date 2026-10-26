(() => {
  // The same file also runs as the GitHub Pages service worker, so the
  // reader.js does not need a separate coi-serviceworker.js upload.
  if (typeof window === 'undefined') {
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', (event) => {
      if (new URL(event.request.url).origin !== self.location.origin) return;
      if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
      event.respondWith(fetch(event.request).then((response) => {
        if (response.status === 0) return response;
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }));
    });
    return;
  }

  if (window.__CORB_REGISTER_COI__ !== false && !window.crossOriginIsolated && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('reader.js', document.currentScript.src || location.href).href)
      .then(() => {
        if (!navigator.serviceWorker.controller) {
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        }
      })
      .catch((err) => console.error('COI service worker:', err));
  }

  const KEY = [0x4B, 0x7E, 0x1A, 0xC5];
  const K32 = KEY[0] | (KEY[1] << 8) | (KEY[2] << 16) | (KEY[3] << 24);
  const DATA_FILES = ["assets.data","assets-2.data"];

  let vfs = {};
  let isReady = false;
  let isMountRequested = false;
  let readyResolve = null;
  let loadError = null;

  window.__CORB_VFS__ = vfs;
  window.__CORB_GET__ = function(p) {
    if (!p) return '';
    const clean = p.replace(/^\.?\/+/g, '');
    return vfs[clean] || vfs[p] || p;
  };

  window.__CORB_READY__ = new Promise((resolve) => {
    readyResolve = resolve;
  });

  function deXor(u8) {
    const len = u8.length;
    if (u8.byteOffset % 4 === 0) {
      const u32Count = Math.floor(len / 4);
      const u32 = new Uint32Array(u8.buffer, u8.byteOffset, u32Count);
      for (let i = 0; i < u32Count; i++) {
        u32[i] ^= K32;
      }
      const rem = len % 4;
      const start = u32Count * 4;
      for (let i = 0; i < rem; i++) {
        u8[start + i] ^= KEY[i];
      }
    } else {
      for (let i = 0; i < len; i++) {
        u8[i] ^= KEY[i & 3];
      }
    }
    return u8;
  }

  function unpackCorb(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 0x43 || bytes[1] !== 0x4F || bytes[2] !== 0x52 || bytes[3] !== 0x42) {
      throw new Error('Invalid package');
    }
    const manifestLen = (bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15];
    const manifestBytes = bytes.subarray(16, 16 + manifestLen);
    deXor(manifestBytes);
    const manifestStr = new TextDecoder('utf-8').decode(manifestBytes).trim();
    const manifest = JSON.parse(manifestStr);

    const dataStart = 16 + manifestLen;
    const dataBytes = bytes.subarray(dataStart);
    deXor(dataBytes);

    for (const [name, meta] of Object.entries(manifest)) {
      const fileBytes = dataBytes.subarray(meta.o, meta.o + meta.s);
      if (name === 'play.html') {
        window.__CORB_PLAY_HTML__ = new TextDecoder('utf-8').decode(fileBytes);
      }
      const blob = new Blob([fileBytes], { type: meta.m });
      const url = URL.createObjectURL(blob);
      vfs[name] = url;
    }

    isReady = true;
    if (readyResolve) readyResolve(vfs);
    if (isMountRequested) performMount();
  }

  async function loadPackage() {
    const base = window.__CORB_DATA_BASE__ || '';
    const parts = await Promise.all(DATA_FILES.map(async (name) => {
      const response = await fetch(base + name);
      if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
      return new Uint8Array(await response.arrayBuffer());
    }));
    const totalSize = parts.reduce((total, part) => total + part.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const part of parts) {
      combined.set(part, offset);
      offset += part.length;
    }
    return combined.buffer;
  }

  loadPackage()
    .then(unpackCorb)
    .catch((err) => {
      loadError = err;
      console.error(err);
      const loader = document.getElementById('corb-loader');
      if (loader) loader.textContent = 'Could not load assets: ' + err.message;
    });

  window.__CORB_MOUNT__ = function() {
    isMountRequested = true;
    if (isReady) {
      performMount();
    } else {
      let loader = document.getElementById('corb-loader');
      if (!loader) {
        loader = document.createElement('div');
        loader.id = 'corb-loader';
        loader.style.cssText = 'position:fixed;inset:0;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-size:14px;z-index:999999;';
        loader.textContent = loadError ? 'Could not load assets: ' + loadError.message : 'Loading...';
        document.body.appendChild(loader);
      }
    }
  };

  function performMount() {
    const loader = document.getElementById('corb-loader');
    if (loader) loader.remove();

    const cssUrl = window.__CORB_GET__('style.css');
    if (cssUrl && !document.querySelector('link[data-corb="style"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.corb = 'style';
      link.href = cssUrl;
      document.head.appendChild(link);
    }

    const jsUrl = window.__CORB_GET__('app.js');
    if (jsUrl && !document.querySelector('script[data-corb="app"]')) {
      const s = document.createElement('script');
      s.dataset.corb = 'app';
      s.src = jsUrl;
      document.body.appendChild(s);
    }
  }

  let calcDisplay = null;
  let currentVal = '0';
  let prevVal = null;
  let currentOp = null;
  let resetNext = false;
  let keyBuf = '';
  let unlocked = false;

  function doUnlock() {
    if (unlocked) return;
    unlocked = true;
    const disguise = document.getElementById('disguise-view');
    if (disguise) disguise.remove();
    document.title = 'X.T-A-L';
    const mainApp = document.getElementById('main-app');
    if (mainApp) mainApp.style.display = '';
    window.__CORB_MOUNT__();
  }

  function checkCode(str) {
    if (str === '1245' || keyBuf.endsWith('1245')) {
      doUnlock();
      return true;
    }
    return false;
  }

  function updateDisplay() {
    if (calcDisplay) calcDisplay.value = currentVal;
    checkCode(currentVal);
  }

  function handleDigit(d) {
    keyBuf = (keyBuf + d).slice(-10);
    if (currentVal === '0' || resetNext) {
      currentVal = d;
      resetNext = false;
    } else {
      currentVal += d;
    }
    updateDisplay();
  }

  function handleClear() {
    currentVal = '0';
    prevVal = null;
    currentOp = null;
    resetNext = false;
    updateDisplay();
  }

  function handleOp(op) {
    if (currentOp && prevVal !== null && !resetNext) {
      compute();
    }
    prevVal = parseFloat(currentVal);
    currentOp = op;
    resetNext = true;
  }

  function compute() {
    if (prevVal === null || !currentOp) return;
    const cur = parseFloat(currentVal);
    let res = 0;
    if (currentOp === '+') res = prevVal + cur;
    else if (currentOp === '-') res = prevVal - cur;
    else if (currentOp === '*') res = prevVal * cur;
    else if (currentOp === '/') res = cur !== 0 ? prevVal / cur : 0;
    else if (currentOp === '%') res = prevVal % cur;
    currentVal = String(res);
    prevVal = null;
    currentOp = null;
    resetNext = true;
    updateDisplay();
  }

  function initCalculator() {
    calcDisplay = document.getElementById('calc-display');
    if (!calcDisplay) return;

    document.querySelectorAll('.calc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.val;
        if (!v) return;
        if (v >= '0' && v <= '9') {
          handleDigit(v);
        } else if (v === '.') {
          if (!currentVal.includes('.')) {
            currentVal += '.';
            updateDisplay();
          }
        } else if (v === 'C' || v === 'CE') {
          handleClear();
        } else if (v === '=') {
          compute();
        } else if (v === '+/-') {
          currentVal = String(-parseFloat(currentVal) || 0);
          updateDisplay();
        } else {
          handleOp(v);
        }
      });
    });

    window.addEventListener('keydown', (e) => {
      if (unlocked) return;
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === '.') {
        if (!currentVal.includes('.')) {
          currentVal += '.';
          updateDisplay();
        }
      } else if (e.key === 'Enter' || e.key === '=') {
        compute();
      } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
        handleClear();
      } else if (['+', '-', '*', '/'].includes(e.key)) {
        handleOp(e.key);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalculator);
  } else {
    initCalculator();
  }
})();