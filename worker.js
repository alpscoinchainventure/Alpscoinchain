
const VERCEL_ORIGIN =
  "https://alpscoinchain-alpscoinchaininvestmentventures.vercel.app";

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const upstreamUrl = new URL(incomingUrl);

    upstreamUrl.hostname = new URL(VERCEL_ORIGIN).hostname;
    upstreamUrl.protocol = "https:";
    upstreamUrl.port = "";

    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", incomingUrl.hostname);
    headers.set(
      "X-Forwarded-Proto",
      incomingUrl.protocol.slice(0, -1)
    );

    return fetch(
      new Request(upstreamUrl, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
        redirect: "manual"
      })
    );
  }
};
