# Quantumult X Scripts

Small Quantumult X script collection.

## AVJB Artplayer Rewrite

This converts the AVJB userscript-style Artplayer replacement into a Quantumult X rewrite package.

### AVJB Files

- `avjb-qx-snippet.conf`: Quantumult X rewrite and MitM snippet.
- `avjb_artplayer_qx.js`: Injects the browser-side player script into AVJB HTML responses.
- `avjb_avstatic_request_headers_qx.js`: Normalizes AVStatic request `Referer`/`Origin` headers for signed m3u8 and segment URLs.
- `avjb_cors_headers_qx.js`: Adds CORS response headers for AVStatic segment hosts.
- `avjb_artplayer_page.js`: Runs inside the AVJB page. It loads Artplayer, hls.js, and mux.js, replaces the site player, adds source copy and MP4 download actions, probes/caches tail segment indexes, and removes common ad blocks.

### AVJB Setup

1. Add the contents of `avjb-qx-snippet.conf` to Quantumult X.
2. Enable rewrite and MitM, then trust the Quantumult X CA certificate on your device.
3. Make sure these hostnames are included in `[mitm] hostname`: `avjb.cc`, `www.avjb.cc`, `list.avstatic.com`, `stat.avstatic.com`.
4. Open an AVJB video page in Safari or a WebView that goes through Quantumult X.
5. Use the replaced `下载` menu for `复制源`, `下载MP4`, or `取消`.

Remote snippet URLs:

```text
https://raw.githubusercontent.com/dawangLM/yaohuo-qx-scripts/main/avjb-qx-snippet.conf
https://raw.githubusercontent.com/dawangLM/yaohuo-qx-scripts/main/avjb_artplayer_qx.js?v=20260608-8
https://raw.githubusercontent.com/dawangLM/yaohuo-qx-scripts/main/avjb_avstatic_request_headers_qx.js?v=20260608-8
https://raw.githubusercontent.com/dawangLM/yaohuo-qx-scripts/main/avjb_cors_headers_qx.js?v=20260608-8
https://cdn.jsdelivr.net/gh/dawangLM/yaohuo-qx-scripts@main/avjb_artplayer_page.js?v=20260608-8
```

Notes:

- Quantumult X cannot run Tampermonkey scripts directly, so this package injects a normal page script through `script-response-body`.
- `list.avstatic.com` and `stat.avstatic.com` are MitM targets because the page script fetches segment and poster resources from those hosts.
- GitHub raw URLs must be reachable by Quantumult X. If this repository is private, host these files somewhere QX can fetch directly.

## Yaohuo Quantumult X Watcher

Quantumult X script for saving your own `yaohuo.me` cookie and sending a local notification when watched pages contain bounty-related keywords.

This repo intentionally does not include automatic posting, reward claiming, or other automated actions against the site. It only stores your own cookie locally and reminds you to review matching pages manually.

### Yaohuo Files

- `qx-snippet.conf`: Quantumult X rewrite and scheduled task snippet.
- `yaohuo_qx.js`: Saves the `yaohuo.me` Cookie from logged-in requests and checks configured pages for keywords.

### Yaohuo Setup

1. Add the contents of `qx-snippet.conf` to Quantumult X.
2. The snippet references `yaohuo_qx.js` by remote GitHub raw URL, so you do not need to add the script file locally.
3. Enable rewrite and MitM, then trust the Quantumult X CA certificate on your device.
4. Make sure `yaohuo.me` is included in `[mitm] hostname`. The provided snippet already includes it.
5. Log in to `https://yaohuo.me/` and open any page once. The script will save the Cookie locally.
6. Edit `watchUrls` in `yaohuo_qx.js` to include the real bounty/list pages you want to monitor.

Remote script URL:

```text
https://raw.githubusercontent.com/dawangLM/yaohuo-qx-scripts/main/yaohuo_qx.js
```

### Yaohuo Notes

- Cookies are stored in Quantumult X persistent storage on your device.
- GitHub raw URLs must be reachable by Quantumult X. If this repository is private, direct raw loading may fail unless you make the repo public or host the script somewhere QX can access.
- Do not share logs or screenshots that expose your Cookie.
- If the site changes its pages or wording, update `watchUrls` and `keywords`.
