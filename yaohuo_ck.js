const HOST = "yaohuo.me";
const COOKIE_KEY = "yaohuo_cookie";

if ($request && $request.headers) {
  const headers = $request.headers;
  const cookie = headers.Cookie || headers.cookie;

  if (cookie && $request.url.includes(HOST)) {
    $persistentStore.write(cookie, COOKIE_KEY);
    $notify("妖火 CK 已更新", "", "Cookie 已保存到本机 Quantumult X");
  }
}

$done({});
