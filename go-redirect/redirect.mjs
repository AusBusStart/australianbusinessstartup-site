export const HOME = "https://australianbusinessstartup.com.au/";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Link-preview and unfurl clients. Real visitors, including Facebook's in-app
// browser (FBAN / FBAV), are not in this list.
const PREVIEW_BOTS = [
  "facebookexternalhit",
  "facebot",
  "facebookbot",
  "meta-externalagent",
  "meta-externalfetcher",
  "twitterbot",
  "slackbot",
  "slack-imgproxy",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "discordbot",
  "pinterestbot",
  "redditbot",
  "applebot",
  "embedly",
  "iframely",
  "vkshare",
  "skypeuripreview",
  "bingpreview",
  "microsoftpreview",
  "safelinks",
  "google-pagerenderer",
  "quora link preview",
  "outbrain",
  "w3c_validator",
  "ia_archiver",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function brisbaneDate(now = new Date()) {
  return new Date(now.getTime() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isRealDay(iso) {
  if (!DAY.test(iso)) return false;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addDays(iso, amount) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function friendlyDay(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function isPreviewBot(userAgent) {
  const haystack = String(userAgent || "").toLowerCase();
  return PREVIEW_BOTS.some((token) => haystack.includes(token));
}

function isPrefetch(request) {
  const purpose = [
    request.headers.get("purpose"),
    request.headers.get("sec-purpose"),
    request.headers.get("x-purpose"),
    request.headers.get("x-moz"),
  ].join(" ").toLowerCase();
  return purpose.includes("prefetch") || purpose.includes("preview");
}

function readCookie(header, name) {
  const parts = String(header || "").split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch (err) {
      return raw;
    }
  }
  return "";
}

function hasParam(url, name) {
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase() === name) return true;
  }
  return false;
}

export function withCampaignUtm(destination, slug) {
  const url = new URL(destination);
  if (!hasParam(url, "utm_source")) url.searchParams.set("utm_source", "abs");
  if (!hasParam(url, "utm_medium")) url.searchParams.set("utm_medium", "facebook_group");
  if (!hasParam(url, "utm_campaign")) url.searchParams.set("utm_campaign", slug);
  return url.toString();
}

function checkedDestination(raw) {
  if (typeof raw !== "string" || raw.length > 2000 || /\s/.test(raw)) return "";
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    return "";
  }
  if (url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  if (!url.hostname) return "";
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (host === "go.australianbusinessstartup.com.au") return "";
  if ((host === "australianbusinessstartup.com.au" || host === "www.australianbusinessstartup.com.au") && (path === "/go" || path.startsWith("/go/"))) {
    return "";
  }
  return url.toString();
}

export function parseLinks(text, today) {
  const links = new Map();
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const lineNo = index + 1;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2 || parts.length > 4) {
      errors.push(`Line ${lineNo} was skipped. Use: slug https://destination/ active`);
      return;
    }
    const slug = parts[0].toLowerCase();
    if (!SLUG.test(slug) || slug.length > 64) {
      errors.push(`Line ${lineNo} was skipped. The slug must be lowercase letters, numbers and hyphens.`);
      return;
    }
    if (links.has(slug)) {
      errors.push(`Line ${lineNo} was skipped. ${slug} is already in the list, and the first one is used.`);
      return;
    }
    const destination = checkedDestination(parts[1]);
    if (!destination) {
      errors.push(`Line ${lineNo} was skipped. The destination must be a normal https:// address, and it cannot point at go.australianbusinessstartup.com.au.`);
      return;
    }
    const status = parts.slice(2).map((word) => word.toLowerCase());
    let state = "active";
    let until = "";
    if (status.length === 0 || (status.length === 1 && status[0] === "active")) {
      state = "active";
    } else if (status.length === 1 && status[0] === "retired") {
      state = "retired";
    } else if (status.length === 2 && status[0] === "until" && isRealDay(status[1])) {
      until = status[1];
      state = today <= until ? "active" : "retired";
    } else {
      errors.push(`Line ${lineNo} was skipped. End it with active, retired, or until YYYY-MM-DD.`);
      return;
    }
    links.set(slug, { slug, destination, state, until });
  });
  return { links, errors };
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0 && left.length > 0;
}

function note(deps, event) {
  if (!event || typeof deps.record !== "function") return;
  const pending = Promise.resolve()
    .then(() => deps.record(event))
    .catch(() => {});
  if (typeof deps.waitUntil === "function") deps.waitUntil(pending);
}

function redirect(location) {
  // 302, not 301. A 301 can be cached, which would keep sending people to an
  // old destination after the link is retired.
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

function htmlResponse(body, extraHeaders) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[char]));
}

export function dateRange(params, today) {
  const fallbackTo = today;
  const fallbackFrom = addDays(today, -29);
  let from = params.get("from") || "";
  let to = params.get("to") || "";
  if (!isRealDay(from) || !isRealDay(to)) {
    from = fallbackFrom;
    to = fallbackTo;
  }
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (from < addDays(to, -365)) from = addDays(to, -365);
  return { from, to };
}

export function rowsFromAnalytics(result) {
  const data = Array.isArray(result) ? result : (result && Array.isArray(result.data) ? result.data : []);
  return data.map((row) => ({
    slug: row.slug,
    kind: row.kind,
    day: String(row.day || "").slice(0, 10),
    n: row.n,
  }));
}

export function summarize(rows, links) {
  const bySlug = new Map();
  function ensure(slug) {
    if (!bySlug.has(slug)) {
      const link = links.get(slug);
      bySlug.set(slug, {
        slug,
        destination: link ? link.destination : "",
        state: link ? link.state : "missing",
        until: link ? link.until : "",
        clicks: 0,
        bot: 0,
        test: 0,
        retired: 0,
        days: new Map(),
      });
    }
    return bySlug.get(slug);
  }
  for (const link of links.values()) ensure(link.slug);
  for (const row of rows || []) {
    if (!row || !SLUG.test(String(row.slug || ""))) continue;
    const item = ensure(row.slug);
    const count = Number(row.n) || 0;
    if (row.kind === "click") {
      item.clicks += count;
      if (count) item.days.set(row.day, (item.days.get(row.day) || 0) + count);
    } else if (row.kind === "bot") item.bot += count;
    else if (row.kind === "test") item.test += count;
    else if (row.kind === "retired") item.retired += count;
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function statusLabel(item) {
  if (item.state === "missing") return "Not in go-redirect/links.txt";
  if (item.state === "retired" && item.until) return `Retired (ended ${item.until})`;
  if (item.state === "retired") return "Retired";
  if (item.until) return `Active until ${item.until}`;
  return "Active";
}

export function renderReportText(summary, errors) {
  const lines = [
    `Link clicks from ${friendlyDay(summary.from)} to ${friendlyDay(summary.to)} (Brisbane time).`,
    "The click number is the one to email. Previews, test clicks and retired visits are not included. Counts are kept for 3 months.",
    "",
  ];
  if (!summary.items.length) lines.push("No links in this date range.");
  for (const item of summary.items) {
    lines.push(`${item.slug}: ${item.clicks} link clicks`);
    const days = [...item.days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [day, count] of days) lines.push(`  ${friendlyDay(day)}: ${count}`);
    lines.push(`  Previews not counted: ${item.bot}`);
    lines.push(`  Test clicks not counted: ${item.test}`);
    if (item.retired) lines.push(`  Retired visits not counted: ${item.retired}`);
    lines.push(`  Status: ${statusLabel(item)}`);
    lines.push("");
  }
  if (errors.length) {
    lines.push("Lines to fix in go-redirect/links.txt:");
    for (const error of errors) lines.push(`- ${error}`);
  }
  return lines.join("\n").trim() + "\n";
}

function renderReportHtml(summary, errors, queryError) {
    const rows = summary.items.map((item) => {
    const days = [...item.days.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => `${escapeHtml(friendlyDay(day))}: ${count}`)
      .join("<br>") || "—";
    const retiredNote = item.retired ? ` · ${item.retired} sent home, not counted` : "";
    return `<tr>
      <td>${escapeHtml(item.slug)}</td>
      <td>${item.clicks}</td>
      <td>${escapeHtml(days)}</td>
      <td>${item.bot}</td>
      <td>${item.test}</td>
      <td>${escapeHtml(statusLabel(item))}${escapeHtml(retiredNote)}</td>
    </tr>`;
  }).join("");
  const copy = summary.items.map((item) => `${escapeHtml(item.slug)}: ${item.clicks} link clicks`).join("\n") || "No links in this date range.";
  const problems = errors.length
    ? `<div class="note"><p><strong>Lines to fix in go-redirect/links.txt</strong></p><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></div>`
    : "";
  const readError = queryError ? `<div class="note"><p>${escapeHtml(queryError)}</p></div>` : "";
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Link clicks | Australian Business Startup</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#1d2731;background:#f4f7f9;line-height:1.5}
  main{max-width:920px;margin:0 auto;padding:28px 18px 48px}
  h1{font-size:1.7rem;margin:0 0 8px}
  p{margin:0 0 12px}
  a{color:#0b4f6c}
  form{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:16px 0}
  label{font-weight:600;font-size:.92rem;display:block}
  input{font:inherit;padding:8px 10px;border:1px solid #c5d2db;border-radius:8px}
  button{font:inherit;font-weight:700;background:#f2a541;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dfe6eb}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #dfe6eb;vertical-align:top}
  th{background:#0b4f6c;color:#fff;font-weight:600}
  pre{background:#fff;border:1px solid #dfe6eb;border-radius:10px;padding:14px 16px;white-space:pre-wrap}
  .note{background:#fff4e2;border-left:5px solid #f2a541;padding:12px 16px;margin:14px 0}
  .muted{color:#55636f}
</style>
</head>
<body>
<main>
  <h1>Link clicks</h1>
  <p>From ${escapeHtml(friendlyDay(summary.from))} to ${escapeHtml(friendlyDay(summary.to))}, Brisbane time. <strong>Clicks</strong> is the number to email the advertiser.</p>
  <p class="muted">Previews, test clicks and retired visits are not included in Clicks. Counts are kept for 3 months. The referrer on the advertiser's site will usually show facebook.com, because Facebook sends the click through its own system.</p>
  ${readError}
  ${problems}
  <form method="get" action="/_report">
    <div><label for="from">From</label><input id="from" name="from" type="date" value="${escapeHtml(summary.from)}" required></div>
    <div><label for="to">To</label><input id="to" name="to" type="date" value="${escapeHtml(summary.to)}" required></div>
    <button type="submit">Show these dates</button>
  </form>
  <h2>Copy into the report email</h2>
  <pre>${copy}</pre>
  <table>
    <thead><tr><th>Link</th><th>Clicks</th><th>Clicks by day</th><th>Previews not counted</th><th>Tests not counted</th><th>Status</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6">No links in this date range.</td></tr>`}</tbody>
  </table>
</main>
</body>
</html>`;
}

function adminPage(title, message, cookie) {
  const body = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d2731;max-width:640px;margin:40px auto;padding:0 18px;line-height:1.5">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</body>
</html>`;
  const headers = {};
  if (cookie) headers["Set-Cookie"] = cookie;
  return htmlResponse(body, headers);
}

function classify(request, url) {
  const method = request.method.toUpperCase();
  const test = url.searchParams.get("test") === "1" || readCookie(request.headers.get("cookie"), "abs_go_test") === "1";
  const preview = isPreviewBot(request.headers.get("user-agent")) || isPrefetch(request);
  if (method !== "GET") return { kind: "", test, preview };
  if (preview) return { kind: "bot", test, preview };
  if (test) return { kind: "test", test, preview };
  return { kind: "click", test, preview };
}

function routeOf(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export async function handleRequest(request, deps) {
  const now = typeof deps.now === "function" ? deps.now() : new Date();
  const today = brisbaneDate(now);
  const url = new URL(request.url);
  const path = routeOf(url.pathname);

  if (path === "/_test-on") {
    return adminPage(
      "Test clicks are on",
      "Test clicks are on for this browser. Clicks you make on tracked links are not counted. Visitors are not affected. Open /_test-off when you are finished.",
      "abs_go_test=1; Path=/; Max-Age=15552000; Secure; HttpOnly; SameSite=Lax"
    );
  }
  if (path === "/_test-off") {
    return adminPage(
      "Test clicks are off",
      "Test clicks are off for this browser. Your next clicks on tracked links are counted.",
      "abs_go_test=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax"
    );
  }

  if (path === "/_report") {
    const configured = String(deps.reportKey || "");
    if (!configured) return notFound();
    const presented = url.searchParams.get("key") || readCookie(request.headers.get("cookie"), "abs_report");
    if (!safeEqual(presented, configured)) return notFound();
    if (url.searchParams.has("key")) {
      url.searchParams.delete("key");
      const location = url.pathname + url.search;
      return new Response(null, {
        status: 302,
        headers: {
          Location: location,
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex",
          "Set-Cookie": `abs_report=${encodeURIComponent(configured)}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`,
        },
      });
    }
    let text = "";
    try {
      text = await deps.loadLinks();
    } catch (err) {
      text = "";
    }
    const parsed = parseLinks(text, today);
    const range = dateRange(url.searchParams, today);
    let rows = [];
    let queryError = "";
    try {
      rows = await deps.query(range.from, range.to);
    } catch (err) {
      console.error("click report query failed", err && err.message, err);
      queryError = "The click count could not be read. Try again in a minute. Redirects still work.";
    }
    const summary = { from: range.from, to: range.to, items: summarize(rows, parsed.links) };
    if (!text.trim()) parsed.errors.unshift("go-redirect/links.txt was empty or could not be read. New clicks are being sent to the homepage.");
    if (url.searchParams.get("format") === "text") {
      const prefix = queryError ? `${queryError}\n\n` : "";
      return new Response(prefix + renderReportText(summary, parsed.errors), {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex",
        },
      });
    }
    return htmlResponse(renderReportHtml(summary, parsed.errors, queryError));
  }

  let text = "";
  try {
    text = await deps.loadLinks();
  } catch (err) {
    text = "";
  }
  if (path === "/links.txt") {
    return new Response(text, {
      status: text ? 200 : 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const match = path.match(/^\/([^/]+)$/);
  if (!match) return redirect(HOME);
  let slug = "";
  try {
    slug = decodeURIComponent(match[1]).toLowerCase();
  } catch (err) {
    return redirect(HOME);
  }
  if (!SLUG.test(slug) || slug.length > 64) return redirect(HOME);

  const parsed = parseLinks(text, today);
  const link = parsed.links.get(slug);
  if (!link) return redirect(HOME);

  const { kind } = classify(request, url);
  if (link.state !== "active") {
    if (kind === "click") note(deps, { slug, day: today, kind: "retired" });
    else if (kind) note(deps, { slug, day: today, kind });
    return redirect(HOME);
  }

  if (kind) note(deps, { slug, day: today, kind });
  return redirect(withCampaignUtm(link.destination, slug));
}
