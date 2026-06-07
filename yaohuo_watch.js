const COOKIE_KEY = "yaohuo_cookie";
const cookie = $persistentStore.read(COOKIE_KEY);

const watchUrls = [
  "https://yaohuo.me/",
  // Replace this with the real bounty/list page you want to monitor.
  // "https://yaohuo.me/your-bounty-page",
];

const keywords = [
  "免费悬赏",
  "悬赏妖火",
  "领取悬赏",
  "无门槛",
];

if (!cookie) {
  $notify("妖火悬赏提醒", "未获取 CK", "先用 Safari 或内置浏览器登录 yaohuo.me");
  $done();
}

function fetchPage(url) {
  return new Promise((resolve) => {
    $task.fetch({
      url,
      method: "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
      },
    }).then(
      (resp) => resolve({ url, body: resp.body || "" }),
      (err) => resolve({ url, error: String(err) })
    );
  });
}

(async () => {
  const hits = [];

  for (const url of watchUrls) {
    const result = await fetchPage(url);
    if (result.error) {
      continue;
    }

    const matched = keywords.filter((keyword) => result.body.includes(keyword));
    if (matched.length) {
      hits.push(`${result.url}\n关键词：${matched.join(", ")}`);
    }
  }

  if (hits.length) {
    $notify("发现疑似妖火悬赏", "请手动打开确认", hits[0]);
  }

  $done();
})();
