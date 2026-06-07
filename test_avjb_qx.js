const assert = require("assert");

const injector = require("./avjb_artplayer_qx.js");
const cors = require("./avjb_cors_headers_qx.js");

const html = "<!doctype html><html><head><title>x</title></head><body>ok</body></html>";
const injected = injector.injectIntoHtml(html, "https://example.com/avjb_artplayer_page.js");

assert(injected.includes("avjb-artplayer-qx-loader"), "loader marker is injected");
assert(injected.includes("https://example.com/avjb_artplayer_page.js"), "page script URL is injected");
assert(injected.indexOf("avjb-artplayer-qx-loader") === injected.lastIndexOf("avjb-artplayer-qx-loader"), "loader appears once");

const reinjected = injector.injectIntoHtml(injected, "https://example.com/avjb_artplayer_page.js");
assert.strictEqual(reinjected, injected, "already injected HTML is unchanged");

const noHead = "<html><body>ok</body></html>";
assert(injector.injectIntoHtml(noHead, "https://example.com/a.js").includes("</body>"), "HTML without head is still handled");

const headers = cors.withCorsHeaders({ "Content-Type": "video/mp2t" });
assert.strictEqual(headers["Access-Control-Allow-Origin"], "*");
assert.strictEqual(headers["Access-Control-Allow-Methods"], "GET, HEAD, OPTIONS");
assert.strictEqual(headers["Access-Control-Allow-Headers"], "*");
assert.strictEqual(headers["Content-Type"], "video/mp2t");

console.log("avjb qx static tests passed");
