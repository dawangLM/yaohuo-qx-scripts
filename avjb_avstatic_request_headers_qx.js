function withAvstaticRequestHeaders(headers) {
  const next = Object.assign({}, headers || {});
  next.Referer = "https://avjb.cc/";
  next.referer = "https://avjb.cc/";
  next.Origin = "https://avjb.cc";
  next.origin = "https://avjb.cc";
  return next;
}

if (typeof $request !== "undefined") {
  $done({ headers: withAvstaticRequestHeaders($request.headers || {}) });
}

if (typeof module !== "undefined") {
  module.exports = { withAvstaticRequestHeaders };
}
