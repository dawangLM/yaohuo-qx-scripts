const DEFAULT_PAGE_SCRIPT_URL = "https://raw.githubusercontent.com/dawangLM/yaohuo-qx-scripts/main/avjb_artplayer_page.js?v=20260608-2";
const LOADER_ID = "avjb-artplayer-qx-loader";

function escapeForScript(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildLoader(pageScriptUrl) {
  return `<script id="${LOADER_ID}">
(function () {
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

  const loader = buildLoader(pageScriptUrl);
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
    injectIntoHtml,
  };
}
