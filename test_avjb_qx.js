const assert = require("assert");
const fs = require("fs");

const injector = require("./avjb_artplayer_qx.js");
const cors = require("./avjb_cors_headers_qx.js");
const avstaticRequest = require("./avjb_avstatic_request_headers_qx.js");
const pageUtils = require("./avjb_page_utils.js");

assert(injector.DEFAULT_PAGE_SCRIPT_URL.includes("cdn.jsdelivr.net/gh/"), "default page script uses browser-executable CDN");

const html = "<!doctype html><html><head><title>x</title></head><body>ok</body></html>";
const injected = injector.injectIntoHtml(html, "https://example.com/avjb_artplayer_page.js");

assert(injected.includes("avjb-artplayer-qx-loader"), "loader marker is injected");
assert(injected.includes("https://example.com/avjb_artplayer_page.js"), "page script URL is injected");
assert(injected.indexOf("avjb-artplayer-qx-loader") === injected.lastIndexOf("avjb-artplayer-qx-loader"), "loader appears once");

const reinjected = injector.injectIntoHtml(injected, "https://example.com/avjb_artplayer_page.js");
assert.strictEqual(reinjected, injected, "already injected HTML is unchanged");

const noHead = "<html><body>ok</body></html>";
assert(injector.injectIntoHtml(noHead, "https://example.com/a.js").includes("</body>"), "HTML without head is still handled");

const safeShell = "<html><head></head><body><script>var safeid='CHfVnsdmCIzAl3P7';</script></body></html>";
const safeInjected = injector.injectIntoHtml(safeShell, "https://example.com/avjb_artplayer_page.js");
assert(safeInjected.includes("_safe=CHfVnsdmCIzAl3P7"), "safeid shell injects inline _safe cookie setter");
assert(safeInjected.includes("location.reload()"), "safeid shell reloads without depending on external page script");

const headers = cors.withCorsHeaders({ "Content-Type": "video/mp2t" });
assert.strictEqual(headers["Access-Control-Allow-Origin"], "*");
assert.strictEqual(headers["Access-Control-Allow-Methods"], "GET, HEAD, OPTIONS");
assert.strictEqual(headers["Access-Control-Allow-Headers"], "*");
assert.strictEqual(headers["Content-Type"], "video/mp2t");

const requestHeaders = avstaticRequest.withAvstaticRequestHeaders({ Accept: "*/*", Referer: "https://avjb.cc/video/1/" });
assert.strictEqual(requestHeaders.Referer, "https://avjb.cc/");
assert.strictEqual(requestHeaders.Origin, "https://avjb.cc");
assert.strictEqual(requestHeaders.Accept, "*/*");

const loginCandidates = [
  { textContent: "已有账号，登录", offsetParent: {}, disabled: false },
];
assert.strictEqual(pageUtils.pickExistingAccountElement(loginCandidates), null, "does not click login-modal button");

const candidates = [
  { textContent: "下载MP4", offsetParent: {}, disabled: false },
  { textContent: "注册账号", offsetParent: {}, disabled: false },
  { textContent: "已有账号，直接播放", offsetParent: {}, disabled: false },
];
assert.strictEqual(pageUtils.pickExistingAccountElement(candidates), candidates[2], "picks existing-account button");

const hidden = { textContent: "已有账号", offsetParent: null, disabled: false };
assert.strictEqual(pageUtils.pickExistingAccountElement([hidden]), null, "ignores hidden elements");

const traditionalChinese = { textContent: "已有帳號，直接播放", offsetParent: {}, disabled: false };
assert.strictEqual(pageUtils.pickExistingAccountElement([traditionalChinese]), traditionalChinese, "supports traditional Chinese account wording");

const safeCookie = pageUtils.buildSafeCookie("CHfVnsdmCIzAl3P7", new Date("2026-06-08T00:00:00Z"));
assert(safeCookie.startsWith("_safe=CHfVnsdmCIzAl3P7; expires="), "builds _safe cookie");
assert(safeCookie.endsWith("; path=/"), "safe cookie is scoped to root path");
assert.strictEqual(pageUtils.extractSafeIdFromHtml("<script>var safeid='embedSafe123';</script>"), "embedSafe123", "extracts embed safeid");
const signedM3u8 = "https://list.avstatic.com/signature/videos/37000/37529/index.m3u8";
assert.strictEqual(pageUtils.extractM3u8FromHtml(`<script>var url = '${signedM3u8}';</script>`, "https://avjb.cc/newembed/37529"), signedM3u8, "extracts signed m3u8 from embed html");
assert.strictEqual(pageUtils.shouldUseEmbedIframe("/video/37529/example/"), true, "main video pages use embed iframe");
assert.strictEqual(pageUtils.shouldUseEmbedIframe("/videos/37529/example/"), true, "alternate video pages use embed iframe");
assert.strictEqual(pageUtils.shouldUseEmbedIframe("/newembed/37529"), false, "embed pages mount Artplayer directly");

const pageScript = fs.readFileSync("./avjb_artplayer_page.js", "utf8");
assert(!pageScript.includes("unpkg.com"), "page script does not depend on unpkg");
assert(pageScript.includes("cdn.jsdelivr.net/npm/hls.js"), "page script loads hls.js from jsDelivr");
assert(pageScript.includes("mountEmbedIframe"), "page script can mount native embed iframe");
assert(pageScript.includes("/newembed/"), "page script uses native embed route for video pages");

const snippet = fs.readFileSync("./avjb-qx-snippet.conf", "utf8");
assert(snippet.includes("script-request-header"), "snippet rewrites AVStatic request headers");
assert(snippet.includes("avjb_avstatic_request_headers_qx.js?v=20260608-8"), "snippet uses versioned AVStatic request header script");
assert(snippet.includes("script-response-header"), "snippet rewrites AVStatic response headers");

console.log("avjb qx static tests passed");
