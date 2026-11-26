import { handleRequest, rowsFromAnalytics } from "./redirect.mjs";

const DEFAULT_LINKS_URL =
  "https://raw.githubusercontent.com/AusBusStart/australianbusinessstartup-site/main/go-redirect/links.txt";

// Short memory cache so a new line in links.txt is picked up quickly,
// and a brief GitHub outage still uses the last good copy.
let linkCache = { text: "", at: 0 };

async function loadLinks(env) {
  const now = Date.now();
  if (linkCache.text && now - linkCache.at < 60_000) return linkCache.text;
  const base = env.LINKS_URL || DEFAULT_LINKS_URL;
  const fresh = new URL(base);
  fresh.searchParams.set("abs", String(Math.floor(now / 60_000)));
  try {
    const res = await fetch(fresh, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    linkCache = { text, at: now };
    return text;
  } catch (err) {
    if (linkCache.text) return linkCache.text;
    return "";
  }
}

function recordClick(env, event) {
  // One tally only: link name, Brisbane date, and click / preview / test / retired.
  // No IP address, name, email or browser string.
  env.CLICKS.writeDataPoint({
    indexes: [event.slug],
    blobs: [event.slug, event.kind, event.day],
    doubles: [1],
  });
}

// The table name is the dataset on its own. A dotted name is rejected.
export const CLICK_REPORT_SQL = `
  SELECT blob1 AS slug, blob2 AS kind, blob3 AS day, SUM(_sample_interval) AS n
  FROM abs_link_clicks
  WHERE blob3 >= $from AND blob3 <= $to
  GROUP BY slug, kind, day
  ORDER BY slug, day, kind
`;

async function queryClicks(env, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("bad range");
  }
  const result = await env.ANALYTICS_SQL.query({
    query: CLICK_REPORT_SQL,
    params: { from, to },
  });
  return rowsFromAnalytics(result);
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, {
      loadLinks: () => loadLinks(env),
      record(event) {
        recordClick(env, event);
      },
      query(from, to) {
        return queryClicks(env, from, to);
      },
      reportKey: env.REPORT_KEY || "",
      waitUntil(promise) {
        ctx.waitUntil(promise);
      },
    });
  },
};
