function withCorsHeaders(headers) {
  const next = Object.assign({}, headers || {});
  next["Access-Control-Allow-Origin"] = "*";
  next["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
  next["Access-Control-Allow-Headers"] = "*";
  next["Access-Control-Expose-Headers"] = "*";
  next["Timing-Allow-Origin"] = "*";
  return next;
}

if (typeof $response !== "undefined") {
  $done({ headers: withCorsHeaders($response.headers || {}) });
}

if (typeof module !== "undefined") {
  module.exports = { withCorsHeaders };
}
