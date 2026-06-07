function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function isVisibleElement(element) {
  if (!element || element.disabled) return false;
  if (element.offsetParent === null) return false;
  return true;
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

function buildSafeCookie(safeid, now) {
  const expiresAt = new Date((now || new Date()).getTime() + 365 * 24 * 60 * 60 * 1000);
  return `_safe=${String(safeid || "")}; expires=${expiresAt.toGMTString()}; path=/`;
}

function pickExistingAccountElement(candidates) {
  for (const element of Array.from(candidates || [])) {
    if (!isVisibleElement(element)) continue;
    const text = element.textContent || element.innerText || element.value || element.getAttribute?.("title") || element.getAttribute?.("aria-label") || "";
    if (isExistingAccountText(text)) return element;
  }
  return null;
}

if (typeof module !== "undefined") {
  module.exports = {
    normalizeText,
    isExistingAccountText,
    pickExistingAccountElement,
    buildSafeCookie,
  };
}
