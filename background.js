// 1Password Extension - Manifest V3 Service Worker
// Shims MV2 APIs so that global.min.js can run in a MV3 service worker.

console.log('[1Password MV3] Service worker starting...');

// ---- 0. Dev helper: allow reload via external message ----
chrome.runtime.onMessageExternal.addListener(function(msg, sender, sendResponse) {
  if (msg && msg.type === '__1pw_reload__') {
    sendResponse({ok: true});
    chrome.runtime.reload();
  }
});
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg && msg.type === '__1pw_reload__') {
    sendResponse({ok: true});
    chrome.runtime.reload();
    return;
  }
  if (msg && msg.type === '__1pw_ping__') {
    sendResponse({alive: true, timestamp: Date.now()});
    return;
  }
});

// ---- 1. Service workers don't have 'window' ----
if (typeof window === 'undefined') {
  self.window = self;
}

// ---- 2. chrome.browserAction → chrome.action ----
try {
  if (typeof chrome.browserAction === 'undefined' && chrome.action) {
    chrome.browserAction = chrome.action;
  }
} catch(e) {
  console.error('[1Password MV3] browserAction shim error:', e);
}

// ---- 3. Completely replace webRequest.onBeforeRequest.addListener ----
// MV3 does NOT support blocking webRequest at all. The 'blocking' option
// throws even if we try to call the original without it in some cases.
// The onepasswdfill redirect is handled by declarativeNetRequest rules instead.
// We replace the entire addListener so global.min.js calls succeed silently.
try {
  if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
    // Stash original BEFORE replacing
    var _origWrAddListener = chrome.webRequest.onBeforeRequest.addListener.bind(
      chrome.webRequest.onBeforeRequest
    );
    chrome.webRequest.onBeforeRequest.addListener = function(callback, filter, optExtraInfoSpec) {
      // Strip 'blocking' — register as observation-only listener
      var safeSpec;
      if (Array.isArray(optExtraInfoSpec)) {
        safeSpec = optExtraInfoSpec.filter(function(s) { return s !== 'blocking'; });
        if (safeSpec.length === 0) safeSpec = undefined;
      }
      var wrappedCallback = function(details) {
        try { callback(details); } catch(e) {}
      };
      try {
        if (safeSpec) {
          _origWrAddListener(wrappedCallback, filter, safeSpec);
        } else {
          _origWrAddListener(wrappedCallback, filter);
        }
      } catch(e) {
        // If it still fails, just swallow — declarativeNetRequest handles redirects
        console.warn('[1Password MV3] webRequest.onBeforeRequest not available, using declarativeNetRequest instead');
      }
    };
  }
} catch(e) {
  console.warn('[1Password MV3] webRequest patch error (non-fatal):', e);
}

// ---- 4. Patch contextMenus.create ----
// MV3 requires: (a) an 'id' parameter, (b) no 'onclick' property.
// Also guard against duplicate ID errors on service worker restart.
try {
  if (chrome.contextMenus) {
    var _origCtxCreate = chrome.contextMenus.create.bind(chrome.contextMenus);
    var _onClickHandlers = {};
    var _ctxIdCounter = 0;

    chrome.contextMenus.create = function(createProperties, callback) {
      var props = Object.assign({}, createProperties);

      // MV3 requires an id
      if (!props.id) {
        props.id = '1password-ctx-' + (++_ctxIdCounter);
      }

      // MV3 doesn't support onclick — move to onClicked listener
      if (props.onclick) {
        _onClickHandlers[props.id] = props.onclick;
        delete props.onclick;
      }

      try {
        return _origCtxCreate(props, callback);
      } catch(e) {
        // Swallow duplicate id errors on SW restart
        console.warn('[1Password MV3] contextMenus.create:', e.message || e);
      }
    };

    chrome.contextMenus.onClicked.addListener(function(info, tab) {
      var handler = _onClickHandlers[info.menuItemId];
      if (handler) {
        handler(info, tab);
      }
    });
  }
} catch(e) {
  console.error('[1Password MV3] contextMenus patch error:', e);
}

// ---- 5. Import the original 1Password background logic ----
try {
  importScripts('ext/sjcl.js');
  importScripts('global.min.js');
  console.log('[1Password MV3] Successfully loaded global.min.js with native messaging');
} catch (e) {
  console.error('[1Password MV3] Failed to load scripts:', e);
}

console.log('[1Password MV3] Service worker initialization complete');
