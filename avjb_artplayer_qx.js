const DEFAULT_PAGE_SCRIPT_URL = "https://cdn.jsdelivr.net/gh/dawangLM/yaohuo-qx-scripts@main/avjb_artplayer_page.js?v=20260608-6";
const LOADER_ID = "avjb-artplayer-qx-loader";

function escapeForScript(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function extractSafeId(body) {
  const match = String(body || "").match(/safeid\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : "";
}

function buildLoader(pageScriptUrl, safeId = "") {
  const safeCookieValue = `_safe=${safeId}`;
  const safeCookieLine = safeId ? `  var safeId = '${escapeForScript(safeId)}';
  var safeCookieValue = '${escapeForScript(safeCookieValue)}';
  var safeCookie = safeCookieValue + '; expires=' + new Date(Date.now() + 31536000000).toGMTString() + '; path=/';
  var hasSafeCookie = String(document.cookie || '').split(';').map(function (item) { return item.trim(); }).indexOf(safeCookieValue) >= 0;
  var reloadKey = 'avjb-qx-safe-reload-' + safeId;
  if (!hasSafeCookie && sessionStorage.getItem(reloadKey) !== '1') {
    document.cookie = safeCookie;
    sessionStorage.setItem(reloadKey, '1');
    location.reload();
    return;
  }
` : "";
  return `<script id="${LOADER_ID}">
(function () {
${safeCookieLine}  window.__AVJB_QX_INLINE_BOOT_RAN__ = true;
  if (window.__AVJB_ARTPLAYER_QX_LOADED__) return;
  window.__AVJB_ARTPLAYER_QX_LOADED__ = true;
  var script = document.createElement('script');
  script.src = '${escapeForScript(pageScriptUrl)}';
  script.async = false;
  script.onerror = function () {
    console.error('[AVJB-QX] failed to load page script:', script.src);
  };
  (document.documentElement || document.head || document.body).appendChild(script);
})();
</script>`;
}

function injectIntoHtml(body, pageScriptUrl = DEFAULT_PAGE_SCRIPT_URL) {
  const html = String(body || "");
  if (!html || html.includes(LOADER_ID)) return html;

  const loader = buildLoader(pageScriptUrl, extractSafeId(html));
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${loader}</head>`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${loader}</body>`);
  }
  return `${html}${loader}`;
}

if (typeof $response !== "undefined") {
  $done({ body: injectIntoHtml($response.body) });
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_PAGE_SCRIPT_URL,
    LOADER_ID,
    buildLoader,
    extractSafeId,
    injectIntoHtml,
  };
}
