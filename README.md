# Yaohuo Quantumult X Watcher

Quantumult X scripts for saving your own `yaohuo.me` cookie and sending a local notification when watched pages contain bounty-related keywords.

This repo intentionally does not include automatic posting, reward claiming, or other automated actions against the site. It only stores your own cookie locally and reminds you to review matching pages manually.

## Files

- `qx-snippet.conf`: Quantumult X rewrite and scheduled task snippet.
- `yaohuo_ck.js`: Saves the `yaohuo.me` Cookie from your logged-in requests.
- `yaohuo_watch.js`: Checks configured pages for keywords and sends a notification.

## Setup

1. Add the contents of `qx-snippet.conf` to Quantumult X.
2. Put `yaohuo_ck.js` and `yaohuo_watch.js` somewhere Quantumult X can load.
3. Enable rewrite and MitM for `yaohuo.me` if your setup requires it.
4. Log in to `https://yaohuo.me/` and open any page once. The cookie script will save the Cookie locally.
5. Edit `watchUrls` in `yaohuo_watch.js` to include the real bounty/list pages you want to monitor.

## Notes

- Cookies are stored in Quantumult X persistent storage on your device.
- Do not share logs or screenshots that expose your Cookie.
- If the site changes its pages or wording, update `watchUrls` and `keywords`.
