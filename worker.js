
const VERCEL_ORIGIN =
  "https://alpscoinchain-fzvb1lpcm-alpscoinchaininvestmentventures.vercel.app";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    url.hostname = new URL(VERCEL_ORIGIN).hostname;
    url.protocol = "https:";
    url.port = "";

    return fetch(new Request(url, request));
  }
};
