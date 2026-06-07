# Yaohuo Quantumult X Watcher

Quantumult X script for saving your own `yaohuo.me` cookie and sending a local notification when watched pages contain bounty-related keywords.

This repo intentionally does not include automatic posting, reward claiming, or other automated actions against the site. It only stores your own cookie locally and reminds you to review matching pages manually.

## Files

- `qx-snippet.conf`: Quantumult X rewrite and scheduled task snippet.
- `yaohuo_qx.js`: Saves the `yaohuo.me` Cookie from logged-in requests and checks configured pages for keywords.

## Setup

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

## Notes

- Cookies are stored in Quantumult X persistent storage on your device.
- GitHub raw URLs must be reachable by Quantumult X. If this repository is private, direct raw loading may fail unless you make the repo public or host the script somewhere QX can access.
- Do not share logs or screenshots that expose your Cookie.
- If the site changes its pages or wording, update `watchUrls` and `keywords`.
