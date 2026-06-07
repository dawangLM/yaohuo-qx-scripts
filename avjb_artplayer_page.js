(function () {
  "use strict";

  if (typeof window === "undefined" || window.__AVJB_ARTPLAYER_PAGE_READY__) return;
  window.__AVJB_ARTPLAYER_PAGE_READY__ = true;

  const config = {
    knownLastIndexByVideoId: {
      117424: 1240,
      116919: 477,
      117430: 895,
    },
    preferOriginalM3u8: true,
    probeMaxIndex: 65536,
    requestTimeoutMs: 15000,
    playbackAssumedLastIndex: 4095,
    hlsSegmentDurationSec: 2,
    downloadWorkers: 12,
    downloadRetries: 4,
    downloadRetryDelayMs: 500,
    downloadRequestTimeoutMs: 30000,
    lastIndexStoragePrefix: "avjb_last_index_",
    downloadMenuSelector: "li.sort.download",
    libs: [
      "https://unpkg.com/hls.js@1.5.18/dist/hls.min.js",
      "https://unpkg.com/artplayer@5.3.0/dist/artplayer.js",
      "https://unpkg.com/mux.js@6.3.0/dist/mux.min.js",
    ],
  };

  const state = {
    art: null,
    playlistBlobUrl: null,
    mountedVideoId: null,
    runningBootstrap: false,
    runningDownload: false,
    abortController: null,
    playbackCtxCache: null,
    progressUi: null,
  };

  const logPrefix = "[AVJB-QX]";

  function log(message, data) {
    if (data === undefined) console.log(`${logPrefix} ${message}`);
    else console.log(`${logPrefix} ${message}`, data);
  }

  function warn(message, data) {
    if (data === undefined) console.warn(`${logPrefix} ${message}`);
    else console.warn(`${logPrefix} ${message}`, data);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function padIndex(value) {
    return String(value).padStart(4, "0");
  }

  function folderId(videoId) {
    return 1000 * Math.floor(Number(videoId) / 1000);
  }

  function baseUrl(videoId) {
    return `https://list.avstatic.com/cdn/videos/${folderId(videoId)}/${videoId}`;
  }

  function segmentUrl(base, index) {
    return `${base}/${padIndex(index)}.jpg`;
  }

  function posterUrl(videoId) {
    return `https://stat.avstatic.com/cdn1/contents/videos_screenshots/${folderId(videoId)}/${videoId}/preview.jpg`;
  }

  function lastIndexKey(videoId) {
    return `${config.lastIndexStoragePrefix}${videoId}`;
  }

  function readLastIndex(videoId) {
    const raw = localStorage.getItem(lastIndexKey(videoId));
    if (!raw) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function writeLastIndex(videoId, lastIndex) {
    if (Number.isInteger(lastIndex) && lastIndex >= 0) {
      localStorage.setItem(lastIndexKey(videoId), String(lastIndex));
    }
  }

  function parseVideoFromPath(pathname) {
    const match = String(pathname || "").match(/\/(?:video|videos|newembed)\/(\d+)(?:\/|$)/i);
    if (!match) return null;
    return { videoId: Number(match[1]) };
  }

  function cleanFilename(title, fallback) {
    const cleaned = String(title || "")
      .replace(/\s*[-|｜]\s*(?:avjb(?:\.cc)?|www\.avjb\.cc)\s*$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[. ]+|[. ]+$/g, "")
      .trim();
    const name = cleaned || fallback || "video";
    return `${name.slice(0, 120).replace(/[. ]+$/g, "")}.mp4`;
  }

  function pickVideoTitle(videoId) {
    const selectors = [".headline h1", ".block-video h1", ".video-info h1", "h1[itemprop='name']", "h1"];
    for (const selector of selectors) {
      const text = document.querySelector(selector)?.textContent?.trim();
      if (text) return cleanFilename(text, `video_${videoId}`);
    }
    const ogTitle = document.querySelector("meta[property='og:title'],meta[name='og:title']")?.getAttribute("content");
    if (ogTitle) return cleanFilename(ogTitle, `video_${videoId}`);
    return cleanFilename(document.title, `video_${videoId}`);
  }

  function toast(message, type = "info", timeout = 3000) {
    let root = document.getElementById("avjb-qx-toast-container");
    if (!root) {
      root = document.createElement("div");
      root.id = "avjb-qx-toast-container";
      document.body.appendChild(root);
    }
    const item = document.createElement("div");
    item.className = `avjb-qx-toast avjb-qx-toast-${type}`;
    item.innerHTML = message;
    root.appendChild(item);
    requestAnimationFrame(() => item.classList.add("show"));
    setTimeout(() => {
      item.classList.remove("show");
      setTimeout(() => item.remove(), 300);
    }, timeout);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`load failed: ${src}`));
      document.head.appendChild(script);
    });
  }

  async function loadLibraries() {
    for (const src of config.libs) await loadScript(src);
    if (!window.Artplayer) throw new Error("Artplayer failed to load");
  }

  function absoluteUrl(value, base) {
    if (!value) return null;
    try {
      return new URL(String(value).replace(/\\u0026/gi, "&").replace(/\\\//g, "/"), base || location.href).href;
    } catch (_) {
      return null;
    }
  }

  function parseM3u8FromText(text, base) {
    const patterns = [
      /var\s+url\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i,
      /\burl\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i,
      /['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i,
    ];
    for (const pattern of patterns) {
      const match = String(text || "").match(pattern);
      const url = match && absoluteUrl(match[1], base);
      if (url) return url;
    }
    return null;
  }

  function parsePlaylistStats(text) {
    let lastIndex = -1;
    let count = 0;
    let duration = 0;
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("#EXTINF:")) {
        const value = Number(line.slice(8).split(",")[0]);
        if (Number.isFinite(value) && value > 0) duration += value;
        continue;
      }
      if (line.startsWith("#")) continue;
      count += 1;
      const match = line.match(/\/(\d+)\.jpg(?:\?|$)/i);
      if (match) {
        const index = Number(match[1]);
        if (Number.isInteger(index) && index > lastIndex) lastIndex = index;
      }
    }
    if (lastIndex < 0 && count > 0) lastIndex = count - 1;
    return { lastIndex: lastIndex >= 0 ? lastIndex : null, segmentCount: count, totalDurationSec: duration };
  }

  async function fetchText(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetch(url, Object.assign({ cache: "no-store", credentials: "include", signal: controller.signal }, options));
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function findOriginalM3u8(videoId, allowNetwork) {
    if (!config.preferOriginalM3u8) return null;
    const lang = location.pathname.match(/^\/([a-z]{2,5})\/(?:video|videos|newembed)(?:\/|$)/i)?.[1];
    const embedPath = `${lang ? `/${lang}` : ""}/newembed/${videoId}`;
    const embedUrl = `${location.origin}${embedPath}`;

    let m3u8Url = null;
    if (/\/newembed\/\d+(?:\/|$)/i.test(location.pathname)) {
      for (const script of Array.from(document.querySelectorAll("script"))) {
        m3u8Url = parseM3u8FromText(script.textContent || "", embedUrl);
        if (m3u8Url) break;
      }
    }
    if (!m3u8Url && allowNetwork) {
      const embedHtml = await fetchText(embedUrl, { headers: { Referer: location.href } });
      m3u8Url = parseM3u8FromText(embedHtml, embedUrl);
    }
    if (!m3u8Url) return null;

    let stats = { lastIndex: null, segmentCount: 0, totalDurationSec: 0 };
    try {
      stats = parsePlaylistStats(await fetchText(m3u8Url, { credentials: "omit" }));
    } catch (error) {
      warn("original m3u8 found but playlist stats fetch failed", error);
    }
    return Object.assign({ m3u8Url, source: "original_m3u8" }, stats);
  }

  async function headExists(url, signal) {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", credentials: "omit", signal });
    if (response.status === 200 || response.status === 206) return true;
    if (response.status === 404) return false;
    throw new Error(`HEAD ${response.status}: ${url}`);
  }

  async function probeLastIndex(videoId, signal) {
    const base = baseUrl(videoId);
    if (!(await headExists(segmentUrl(base, 0), signal))) throw new Error("segment 0000 is not reachable");

    let low = 0;
    let high = 1;
    while (high < config.probeMaxIndex && await headExists(segmentUrl(base, high), signal)) {
      low = high;
      high *= 2;
    }
    if (high >= config.probeMaxIndex) throw new Error("probe exceeded configured limit");

    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (await headExists(segmentUrl(base, mid), signal)) low = mid;
      else high = mid;
    }
    writeLastIndex(videoId, low);
    return low;
  }

  function buildSyntheticPlaylist(base, lastIndex) {
    const duration = Math.max(1, Number(config.hlsSegmentDurationSec) || 2);
    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${Math.ceil(duration)}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXT-X-PLAYLIST-TYPE:VOD",
    ];
    for (let index = 0; index <= lastIndex; index += 1) {
      lines.push(`#EXTINF:${duration.toFixed(6)},`);
      lines.push(segmentUrl(base, index));
    }
    lines.push("#EXT-X-ENDLIST");
    return `${lines.join("\n")}\n`;
  }

  async function getPlaybackContext(allowNetwork) {
    const parsed = parseVideoFromPath(location.pathname);
    if (!parsed) throw new Error(`video id not found in path: ${location.pathname}`);
    const videoId = parsed.videoId;
    if (state.playbackCtxCache?.videoId === videoId) return state.playbackCtxCache;

    const original = await findOriginalM3u8(videoId, allowNetwork).catch((error) => {
      warn("original m3u8 lookup failed", error);
      return null;
    });
    const known = config.knownLastIndexByVideoId[videoId];
    const saved = readLastIndex(videoId);
    const base = baseUrl(videoId);

    let ctx;
    if (original?.m3u8Url) {
      const exact = Number.isInteger(original.lastIndex) && original.lastIndex >= 0;
      ctx = {
        videoId,
        base,
        lastIndex: exact ? original.lastIndex : (known ?? saved ?? config.playbackAssumedLastIndex),
        exact,
        source: original.source,
        rawM3u8Url: original.m3u8Url,
        poster: posterUrl(videoId),
      };
      if (exact) writeLastIndex(videoId, original.lastIndex);
    } else if (Number.isInteger(known)) {
      ctx = { videoId, base, lastIndex: known, exact: true, source: "known", rawM3u8Url: null, poster: posterUrl(videoId) };
    } else if (Number.isInteger(saved)) {
      ctx = { videoId, base, lastIndex: saved, exact: true, source: "localStorage", rawM3u8Url: null, poster: posterUrl(videoId) };
    } else {
      ctx = { videoId, base, lastIndex: config.playbackAssumedLastIndex, exact: false, source: "assumed", rawM3u8Url: null, poster: posterUrl(videoId) };
    }

    state.playbackCtxCache = ctx;
    return ctx;
  }

  function playerHost() {
    return document.querySelector(".block-video .video-holder .player-holder") ||
      document.querySelector(".block-video .video-holder .player-wrap") ||
      document.querySelector(".block-video .video-holder") ||
      document.querySelector(".block-video .player-holder") ||
      document.querySelector("#mse")?.parentElement ||
      document.querySelector("#player.container");
  }

  function prepareHost(host) {
    document.querySelectorAll("video").forEach((video) => {
      try { video.pause(); } catch (_) {}
    });
    host.replaceChildren();
    host.style.position = "relative";
    host.style.width = "100%";
    host.style.height = "0";
    host.style.paddingBottom = "56.25%";
    host.style.background = "transparent";
  }

  function mountElement(host) {
    const element = document.createElement("div");
    element.id = "__avjb_artplayer_mount__";
    element.style.position = "absolute";
    element.style.inset = "0";
    host.appendChild(element);
    return element;
  }

  async function bootstrapPlayer(force = false) {
    if (state.runningBootstrap) return;
    const parsed = parseVideoFromPath(location.pathname);
    if (!parsed) return;
    if (!force && state.mountedVideoId === parsed.videoId && document.querySelector("#__avjb_artplayer_mount__")) return;

    state.runningBootstrap = true;
    try {
      await loadLibraries();
      const ctx = await getPlaybackContext(true);
      const host = playerHost();
      if (!host) throw new Error("player container not found");

      if (state.art) {
        try { state.art.destroy(false); } catch (_) {}
        state.art = null;
      }
      if (state.playlistBlobUrl) URL.revokeObjectURL(state.playlistBlobUrl);
      state.playlistBlobUrl = null;

      prepareHost(host);
      const mount = mountElement(host);
      const url = ctx.rawM3u8Url || URL.createObjectURL(new Blob([buildSyntheticPlaylist(ctx.base, ctx.lastIndex)], { type: "application/vnd.apple.mpegurl" }));
      if (!ctx.rawM3u8Url) state.playlistBlobUrl = url;

      state.art = new window.Artplayer({
        container: mount,
        url,
        type: "m3u8",
        poster: ctx.poster,
        autoplay: false,
        autoSize: true,
        playbackRate: true,
        aspectRatio: true,
        setting: true,
        hotkey: true,
        pip: true,
        fullscreen: true,
        fullscreenWeb: true,
        miniProgressBar: true,
        theme: "#00bcd4",
        moreVideoAttr: { playsinline: true, webkitPlaysinline: true },
        customType: {
          m3u8(video, source, art) {
            if (window.Hls?.isSupported()) {
              art.hls?.destroy();
              const hls = new window.Hls({
                enableWorker: true,
                lowLatencyMode: false,
                maxBufferLength: 600,
                maxMaxBufferLength: 1800,
                backBufferLength: 180,
                maxBufferSize: 1024 * 1024 * 512,
              });
              hls.loadSource(source);
              hls.attachMedia(video);
              art.hls = hls;
              art.on("destroy", () => hls.destroy());
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
              video.src = source;
            } else {
              art.notice.show = "当前浏览器不支持 HLS";
            }
          },
        },
      });
      state.mountedVideoId = ctx.videoId;
      log("player mounted", ctx);
    } catch (error) {
      console.error(`${logPrefix} player bootstrap failed`, error);
      toast(`播放器替换失败：${String(error.message || error)}`, "error", 5000);
    } finally {
      state.runningBootstrap = false;
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(text));
      return;
    }
    const input = document.createElement("textarea");
    input.value = String(text);
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  function ensureProgress(menu) {
    if (state.progressUi?.root?.isConnected) return state.progressUi;
    const row = document.createElement("div");
    row.className = "avjb-qx-progress-row";
    row.innerHTML = `
      <div class="avjb-qx-progress-panel">
        <div class="avjb-qx-progress-head"><span class="percent">0%</span><span class="eta">--:--</span></div>
        <div class="avjb-qx-progress-track"><span class="fill"></span></div>
        <div class="avjb-qx-progress-meta">等待下载</div>
      </div>`;
    (menu.closest(".info-buttons") || menu.parentElement || menu).appendChild(row);
    state.progressUi = {
      row,
      root: row.querySelector(".avjb-qx-progress-panel"),
      percent: row.querySelector(".percent"),
      eta: row.querySelector(".eta"),
      fill: row.querySelector(".fill"),
      meta: row.querySelector(".avjb-qx-progress-meta"),
    };
    return state.progressUi;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const rounded = Math.round(seconds);
    const minutes = Math.floor(rounded / 60);
    const secs = rounded % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function updateProgress(data) {
    const menu = document.querySelector(config.downloadMenuSelector);
    if (!menu) return;
    const ui = ensureProgress(menu);
    const active = data.stage && data.stage !== "idle";
    ui.row.classList.toggle("is-active", active);
    ui.root.classList.toggle("is-indeterminate", !!data.indeterminate);
    const percent = Math.max(0, Math.min(100, Number(data.percent) || 0));
    ui.percent.textContent = `${percent.toFixed(2)}%`;
    ui.eta.textContent = formatTime(data.etaSec);
    ui.fill.style.width = data.indeterminate ? "36%" : `${percent.toFixed(2)}%`;
    ui.meta.textContent = data.meta || "等待下载";
  }

  async function fetchSegment(base, index, strict, signal) {
    const url = segmentUrl(base, index);
    for (let attempt = 1; attempt <= config.downloadRetries; attempt += 1) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), config.downloadRequestTimeoutMs);
      const relay = () => timeout.abort();
      signal?.addEventListener("abort", relay, { once: true });
      try {
        const response = await fetch(url, { method: "GET", cache: "no-store", credentials: "omit", signal: timeout.signal });
        if (response.status === 404 && !strict) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength) throw new Error("empty segment");
        return buffer;
      } catch (error) {
        if (signal?.aborted) throw new Error("download aborted");
        if (attempt >= config.downloadRetries) throw error;
        await sleep(config.downloadRetryDelayMs * attempt);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", relay);
      }
    }
    return null;
  }

  function transmuxToMp4(segments, lastIndex, signal) {
    if (!window.muxjs?.mp4?.Transmuxer) throw new Error("mux.js is not loaded");
    const transmuxer = new window.muxjs.mp4.Transmuxer();
    let initSegment = null;
    const chunks = [];
    transmuxer.on("data", (data) => {
      if (data.initSegment?.byteLength && !initSegment) initSegment = new Uint8Array(data.initSegment);
      if (data.data?.byteLength) chunks.push(new Uint8Array(data.data));
    });
    for (let index = 0; index <= lastIndex; index += 1) {
      if (signal?.aborted) throw new Error("download aborted");
      const segment = segments.get(index);
      if (!segment) throw new Error(`missing segment ${padIndex(index)}`);
      transmuxer.push(new Uint8Array(segment));
      transmuxer.flush();
      segments.delete(index);
    }
    if (!initSegment || !chunks.length) throw new Error("mux.js produced no MP4 data");
    return new Blob([initSegment, ...chunks], { type: "video/mp4" });
  }

  function saveBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function downloadMp4() {
    if (state.runningDownload) {
      toast("已有下载任务正在执行", "warning");
      return;
    }
    const parsed = parseVideoFromPath(location.pathname);
    if (!parsed) throw new Error("当前页面未识别到 videoId");

    await loadLibraries();
    state.runningDownload = true;
    const controller = new AbortController();
    state.abortController = controller;
    const startedAt = performance.now();
    const segments = new Map();
    let completed = 0;

    try {
      const ctx = await getPlaybackContext(true);
      let lastIndex = ctx.exact ? ctx.lastIndex : readLastIndex(parsed.videoId);
      if (!Number.isInteger(lastIndex)) {
        updateProgress({ stage: "probing", indeterminate: true, meta: "正在探测末分片" });
        lastIndex = await probeLastIndex(parsed.videoId, controller.signal);
      }
      const total = lastIndex + 1;
      let next = 0;

      async function worker() {
        while (next <= lastIndex) {
          if (controller.signal.aborted) throw new Error("download aborted");
          const index = next;
          next += 1;
          const buffer = await fetchSegment(ctx.base, index, true, controller.signal);
          segments.set(index, buffer);
          completed += 1;
          const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.001);
          const speed = completed / elapsed;
          updateProgress({
            stage: "downloading",
            percent: completed / total * 100,
            etaSec: speed > 0 ? (total - completed) / speed : null,
            meta: `下载中 ${completed}/${total}，缓存 ${(Array.from(segments.values()).reduce((sum, item) => sum + item.byteLength, 0) / 1048576).toFixed(2)} MB`,
          });
        }
      }

      await Promise.all(Array.from({ length: config.downloadWorkers }, () => worker()));
      updateProgress({ stage: "muxing", percent: 100, etaSec: 0, indeterminate: true, meta: "正在转封装 MP4" });
      const blob = transmuxToMp4(segments, lastIndex, controller.signal);
      const filename = pickVideoTitle(parsed.videoId);
      saveBlob(filename, blob);
      updateProgress({ stage: "completed", percent: 100, etaSec: 0, meta: `已触发浏览器保存：${filename}` });
      toast(`下载完成：<br><b>${filename}</b>`, "success", 5000);
    } catch (error) {
      if (String(error.message || error) === "download aborted") {
        updateProgress({ stage: "cancelled", percent: 0, meta: "下载已取消" });
        toast("下载已取消", "warning");
      } else {
        updateProgress({ stage: "failed", percent: 0, meta: `下载失败：${String(error.message || error)}` });
        toast(`下载失败：${String(error.message || error)}`, "error", 5000);
        throw error;
      }
    } finally {
      state.abortController = null;
      state.runningDownload = false;
    }
  }

  function installStyles() {
    if (document.getElementById("__avjb_qx_style__")) return;
    const style = document.createElement("style");
    style.id = "__avjb_qx_style__";
    style.textContent = `
      li.sort.download.avjb-qx-download { background:#c92536!important; border-radius:6px!important; position:relative!important; overflow:visible!important; }
      li.sort.download.avjb-qx-download > strong { color:#fff!important; background:#c92536!important; border-radius:6px!important; padding:0 10px!important; }
      li.sort.download.avjb-qx-download > i { color:#fff!important; }
      li.sort.download.avjb-qx-download ul { border:1px solid #5a2329!important; border-radius:8px!important; background:rgba(25,25,25,.98)!important; }
      li.sort.download.avjb-qx-download ul a[data-avjb-qx-action] { color:#ffd7dc!important; cursor:pointer!important; }
      li.sort.download.avjb-qx-download ul a[data-avjb-qx-action]:hover { color:#fff!important; }
      .top-ad,.bottom-adv,.sponsor,.ad-item,.spot,a[title='Visit our sponsor'],iframe[src*='xlivrdr.com'],script[src*='cdn.timka.cc'] { display:none!important; visibility:hidden!important; opacity:0!important; pointer-events:none!important; }
      #__avjb_artplayer_mount__,#__avjb_artplayer_mount__ .art-video-player,#__avjb_artplayer_mount__ video { width:100%!important; height:100%!important; }
      #__avjb_artplayer_mount__ video { object-fit:cover!important; background:transparent!important; }
      .avjb-qx-progress-row { display:none!important; flex:0 0 100%!important; width:100%!important; margin:8px 0 0!important; box-sizing:border-box!important; }
      .avjb-qx-progress-row.is-active { display:block!important; }
      .avjb-qx-progress-panel { width:280px!important; max-width:calc(100vw - 48px)!important; min-width:140px!important; padding:8px 10px!important; border-radius:8px!important; border:1px solid #62333a!important; background:rgba(23,20,21,.96)!important; box-sizing:border-box!important; box-shadow:0 8px 22px rgba(0,0,0,.35)!important; }
      .avjb-qx-progress-head { display:flex!important; justify-content:space-between!important; font-size:12px!important; color:#ffe7ea!important; margin-bottom:6px!important; }
      .avjb-qx-progress-track { height:8px!important; border-radius:999px!important; border:1px solid #4b2f33!important; background:#342529!important; overflow:hidden!important; }
      .avjb-qx-progress-track .fill { display:block!important; height:100%!important; width:0%; border-radius:999px!important; background:linear-gradient(90deg,#cf3f4d 0%,#ea7a5b 100%)!important; transition:width .25s ease!important; }
      .avjb-qx-progress-panel.is-indeterminate .fill { width:36%!important; animation:avjbQxProgressSweep 1.25s linear infinite!important; }
      .avjb-qx-progress-meta { margin-top:6px!important; line-height:1.35!important; font-size:11px!important; color:#efc8cd!important; }
      @keyframes avjbQxProgressSweep { 0%{ transform:translateX(-120%); } 100%{ transform:translateX(300%); } }
      #avjb-qx-toast-container { position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:999999; display:flex; flex-direction:column; gap:10px; pointer-events:none; }
      .avjb-qx-toast { background:rgba(25,25,25,.95); color:#fff; padding:12px 24px; border-radius:8px; font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,.3); border:1px solid #444; opacity:0; transform:translateY(-20px); transition:all .3s cubic-bezier(.25,.8,.25,1); pointer-events:auto; text-align:center; }
      .avjb-qx-toast.show { opacity:1; transform:translateY(0); }
      .avjb-qx-toast-success { border-left:4px solid #4caf50; }
      .avjb-qx-toast-error { border-left:4px solid #f44336; }
      .avjb-qx-toast-info { border-left:4px solid #2196f3; }
      .avjb-qx-toast-warning { border-left:4px solid #ff9800; }
    `;
    document.head.appendChild(style);
  }

  function makeAction(label, action) {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = label;
    link.dataset.avjbQxAction = action;
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        if (action === "copy") {
          const ctx = await getPlaybackContext(true);
          const source = ctx.rawM3u8Url || `${ctx.base}/{0000..${padIndex(ctx.lastIndex)}}.jpg`;
          await copyText(source);
          toast("已复制播放源", "success");
        } else if (action === "download") {
          await downloadMp4();
        } else if (action === "cancel") {
          state.abortController?.abort();
        }
      } catch (error) {
        console.error(`${logPrefix} action failed`, error);
        toast(`操作失败：${String(error.message || error)}`, "error", 5000);
      }
    });
    return link;
  }

  function ensureDownloadMenu() {
    const menu = document.querySelector(config.downloadMenuSelector);
    if (!menu || menu.dataset.avjbQxReplaced === "1") {
      if (menu) ensureProgress(menu);
      return;
    }
    menu.dataset.avjbQxReplaced = "1";
    menu.classList.add("avjb-qx-download");
    const strong = menu.querySelector("strong");
    if (strong) {
      strong.textContent = "下载";
      strong.title = "下载 MP4";
    }
    let list = menu.querySelector("ul");
    if (!list) {
      list = document.createElement("ul");
      menu.appendChild(list);
    }
    list.replaceChildren(
      makeAction("复制源", "copy"),
      makeAction("下载MP4", "download"),
      makeAction("取消", "cancel")
    );
    ensureProgress(menu);
    log("download menu replaced");
  }

  function cleanupAds() {
    document.querySelectorAll(".top-ad,.bottom-adv,.sponsor,.ad-item,.spot,a[title='Visit our sponsor'],iframe[src*='xlivrdr.com'],script[src*='cdn.timka.cc']").forEach((node) => node.remove());
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function isExistingAccountText(text) {
    const normalized = normalizeText(text);
    if (!normalized) return false;
    if (/(登录|登入|登錄|login)/i.test(normalized)) return false;
    if (/(已有|已有账号|已有帳號|已有帐号|老用户|老會員|老会员)/.test(normalized) && /(账号|帳號|帐号|账户|帳戶|会员|會員|播放|观看|觀看|进入|進入)/.test(normalized)) {
      return true;
    }
    return /已有(?:账号|帳號|帐号|账户|帳戶)(?:直接)?(?:播放|观看|觀看|进入|進入)/.test(normalized);
  }

  function pickExistingAccountElement(candidates) {
    for (const element of Array.from(candidates || [])) {
      if (!element || element.disabled || element.offsetParent === null) continue;
      const text = element.textContent || element.innerText || element.value || element.getAttribute("title") || element.getAttribute("aria-label") || "";
      if (isExistingAccountText(text)) return element;
    }
    return null;
  }

  function clickExistingAccountIfPresent() {
    const candidates = document.querySelectorAll("a,button,input[type='button'],input[type='submit'],div[role='button'],span[role='button']");
    const target = pickExistingAccountElement(candidates);
    if (!target || target.dataset.avjbQxClickedExistingAccount === "1") return false;
    target.dataset.avjbQxClickedExistingAccount = "1";
    log("click existing-account entry", {
      text: normalizeText(target.textContent || target.value || target.getAttribute("title") || target.getAttribute("aria-label") || ""),
    });
    target.click();
    setTimeout(() => bootstrapPlayer(true), 600);
    return true;
  }

  function getCookieValue(name) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(document.cookie || "").match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function buildSafeCookie(safeid) {
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return `_safe=${String(safeid || "")}; expires=${expiresAt.toGMTString()}; path=/`;
  }

  function ensureSafeCookieAndReload() {
    const safeid = window.safeid || Array.from(document.querySelectorAll("script"))
      .map((script) => script.textContent || "")
      .map((text) => text.match(/safeid\s*=\s*['"]([^'"]+)['"]/)?.[1])
      .find(Boolean);
    if (!safeid || getCookieValue("_safe") === String(safeid)) return false;
    document.cookie = buildSafeCookie(safeid);
    log("set safe cookie and reload", { safeidLength: String(safeid).length });
    setTimeout(() => location.reload(), 80);
    return true;
  }

  function ensureUi() {
    installStyles();
    cleanupAds();
    if (ensureSafeCookieAndReload()) return;
    clickExistingAccountIfPresent();
    if (parseVideoFromPath(location.pathname)) {
      ensureDownloadMenu();
      bootstrapPlayer(false);
    }
  }

  log("page script loaded", location.href);
  ensureUi();
  const observer = new MutationObserver(() => {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(ensureUi, 300);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
