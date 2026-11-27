import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { brisbaneDayUtcEndExclusive, brisbaneDayUtcStart, CLICK_REPORT_SQL, rowsFromBindingResult } from "./worker.mjs";
import {
  brisbaneDate,
  handleRequest,
  isPreviewBot,
  parseLinks,
  rowsFromAnalytics,
  summarize,
  withCampaignUtm,
} from "./redirect.mjs";

const HOST = "https://go.australianbusinessstartup.com.au";

const NOW = new Date("2026-11-26T01:00:00.000Z");
const LINKS = `
# notes
example https://australianbusinessstartup.com.au/ active
acme https://acme.example/pricing?plan=start active
ended https://old.example/offer retired
spring https://spring.example/sale until 2026-11-26
summer https://summer.example/sale until 2026-11-25
newsletter https://news.example/welcome?utm_medium=newsletter active
`;

function memory() {
  const events = [];
  const pending = [];
  return {
    events,
    pending,
    async loadLinks() {
      return LINKS;
    },
    async record(event) {
      events.push(event);
    },
    async query() {
      return [];
    },
    reportKey: "report-secret",
    now: () => NOW,
    waitUntil(promise) {
      pending.push(promise);
    },
  };
}

async function go(path, options = {}) {
  const deps = options.deps || memory();
  const headers = new Headers(options.headers || {});
  if (options.ua) headers.set("user-agent", options.ua);
  const request = new Request(HOST + path, {
    method: options.method || "GET",
    headers,
  });
  const response = await handleRequest(request, deps);
  await Promise.all(deps.pending);
  return { response, deps };
}

test("Brisbane date rolls over at 00:00 AEST, which is 14:00 UTC", () => {
  assert.equal(brisbaneDate(new Date("2026-11-26T13:59:00.000Z")), "2026-11-26");
  assert.equal(brisbaneDate(new Date("2026-11-26T14:00:00.000Z")), "2026-11-27");
});

test("the link list is a fixed https list, with bad lines skipped", () => {
  const parsed = parseLinks(`
example https://australianbusinessstartup.com.au/ active
example https://second.example/ active
bad http://acme.example/ active
script javascript:alert(1) active
user https://user:pass@acme.example/ active
loop https://go.australianbusinessstartup.com.au/example active
old https://australianbusinessstartup.com.au/go/example active
open https://acme.example/ active extra
weird not-a-url active
spring https://spring.example/ until 2026-02-31
kept https://kept.example/offer?utm_source=partner&ref=1
`, "2026-11-26");
  assert.equal(parsed.links.size, 2);
  assert.equal(parsed.links.get("example").destination, "https://australianbusinessstartup.com.au/");
  assert.equal(parsed.links.get("kept").destination, "https://kept.example/offer?utm_source=partner&ref=1");
  assert.equal(parsed.errors.length, 9);
});

test("a normal click is a 302 to the fixed destination and keeps or adds UTM parameters", async () => {
  const { response, deps } = await go("/acme");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const location = response.headers.get("location");
  assert.equal(
    location,
    "https://acme.example/pricing?plan=start&utm_source=abs&utm_medium=facebook_group&utm_campaign=acme"
  );
  assert.deepEqual(deps.events, [{ slug: "acme", day: "2026-11-26", kind: "click" }]);
});

test("an existing utm on the destination is kept", async () => {
  const { response } = await go("/newsletter");
  const location = new URL(response.headers.get("location"));
  assert.equal(location.searchParams.get("utm_medium"), "newsletter");
  assert.equal(location.searchParams.get("utm_source"), "abs");
  assert.equal(location.searchParams.get("utm_campaign"), "newsletter");
});

test("query parameters on the /go/ link cannot change the destination", async () => {
  const { response, deps } = await go("/example?url=https://evil.example&utm_campaign=hijack&test=2");
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin + location.pathname, "https://australianbusinessstartup.com.au/");
  assert.equal(location.searchParams.get("utm_campaign"), "example");
  assert.equal(location.searchParams.get("url"), null);
  assert.equal(deps.events[0].kind, "click");
});

test("the example link points at the homepage", () => {
  assert.equal(
    withCampaignUtm("https://australianbusinessstartup.com.au/", "example"),
    "https://australianbusinessstartup.com.au/?utm_source=abs&utm_medium=facebook_group&utm_campaign=example"
  );
});

test("preview bots are redirected to the same place and are not counted as clicks", async () => {
  const human = await go("/acme", { ua: "Mozilla/5.0" });
  const bot = await go("/acme", {
    ua: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  });
  assert.equal(bot.response.status, 302);
  assert.equal(bot.response.headers.get("location"), human.response.headers.get("location"));
  assert.equal(bot.deps.events[0].kind, "bot");
  assert.equal(isPreviewBot("Facebot Twitterbot/1.0"), true);
  assert.equal(isPreviewBot("Slackbot-LinkExpanding 1.0"), true);
});

test("the Facebook in-app browser is a real click", async () => {
  const { deps } = await go("/acme", {
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.29.106;]",
  });
  assert.equal(deps.events[0].kind, "click");
});

test("?test=1 and the test cookie are not counted and are not forwarded", async () => {
  const byQuery = await go("/acme?test=1");
  assert.equal(byQuery.deps.events[0].kind, "test");
  assert.equal(new URL(byQuery.response.headers.get("location")).searchParams.get("test"), null);

  const byCookie = await go("/acme", { headers: { cookie: "abs_go_test=1" } });
  assert.equal(byCookie.deps.events[0].kind, "test");

  const on = await go("/_test-on");
  assert.equal(on.response.status, 200);
  assert.match(on.response.headers.get("set-cookie"), /abs_go_test=1/);
  const off = await go("/_test-off");
  assert.match(off.response.headers.get("set-cookie"), /Max-Age=0/);
});

test("prefetch and HEAD requests are redirected and not counted", async () => {
  const prefetch = await go("/acme", { headers: { purpose: "prefetch" } });
  assert.equal(prefetch.response.status, 302);
  assert.equal(prefetch.deps.events[0].kind, "bot");

  const head = await go("/acme", { method: "HEAD" });
  assert.equal(head.response.status, 302);
  assert.equal(head.deps.events.length, 0);
});

test("unknown, retired and ended links go to the homepage", async () => {
  const unknown = await go("/missing");
  assert.equal(unknown.response.headers.get("location"), "https://australianbusinessstartup.com.au/");
  assert.equal(unknown.deps.events.length, 0);

  const retired = await go("/ended");
  assert.equal(retired.response.headers.get("location"), "https://australianbusinessstartup.com.au/");
  assert.equal(retired.deps.events[0].kind, "retired");

  const lastDay = await go("/spring");
  assert.match(lastDay.response.headers.get("location"), /^https:\/\/spring\.example\/sale/);
  assert.equal(lastDay.deps.events[0].kind, "click");

  const endedByDate = await go("/summer");
  assert.equal(endedByDate.response.headers.get("location"), "https://australianbusinessstartup.com.au/");
  assert.equal(endedByDate.deps.events[0].kind, "retired");

  const junk = await go("/not a slug");
  assert.equal(junk.response.headers.get("location"), "https://australianbusinessstartup.com.au/");
});

test("a retired preview is still redirected, and a test of a retired link is not counted", async () => {
  const bot = await go("/ended", { ua: "Twitterbot/1.0" });
  assert.equal(bot.response.status, 302);
  assert.equal(bot.response.headers.get("location"), "https://australianbusinessstartup.com.au/");
  assert.equal(bot.deps.events[0].kind, "bot");

  const trial = await go("/ended?test=1");
  assert.equal(trial.deps.events[0].kind, "test");
});

test("the redirect is returned without waiting for the counter", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const deps = memory();
  deps.record = () => gate;
  const pending = handleRequest(new Request(HOST + "/example"), deps);
  const response = await pending;
  assert.equal(response.status, 302);
  release();
  await Promise.all(deps.pending);
});

test("a failed link-list read sends people home and does not throw", async () => {
  const deps = memory();
  deps.loadLinks = async () => {
    throw new Error("github down");
  };
  const { response } = await go("/example", { deps });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://australianbusinessstartup.com.au/");
});

test("the report shows clicks separately from previews and tests", async () => {
  const deps = memory();
  deps.query = async (from, to) => {
    assert.equal(from, "2026-11-01");
    assert.equal(to, "2026-11-26");
    return [
      { slug: "acme", day: "2026-11-20", kind: "click", n: 4 },
      { slug: "acme", day: "2026-11-21", kind: "click", n: 8 },
      { slug: "acme", day: "2026-11-21", kind: "bot", n: 3 },
      { slug: "acme", day: "2026-11-21", kind: "test", n: 1 },
      { slug: "ended", day: "2026-11-22", kind: "retired", n: 2 },
    ];
  };
  const items = summarize(await deps.query("2026-11-01", "2026-11-26"), parseLinks(LINKS, "2026-11-26").links);
  const acme = items.find((item) => item.slug === "acme");
  assert.equal(acme.clicks, 12);
  assert.equal(acme.bot, 3);
  assert.equal(acme.test, 1);
  assert.equal(acme.days.get("2026-11-20"), 4);

  const denied = await go("/_report");
  assert.equal(denied.response.status, 404);

  const page = await go("/_report?from=2026-11-01&to=2026-11-26", {
    deps,
    headers: { cookie: "abs_report=report-secret" },
  });
  const html = await page.response.text();
  assert.equal(page.response.status, 200);
  assert.match(html, /acme: 12 link clicks/);
  assert.match(html, /<td>12<\/td>/);
  assert.match(html, /Previews not counted/);
  assert.doesNotMatch(html, /report-secret/);

  const text = await go("/_report?from=2026-11-01&to=2026-11-26&format=text", {
    deps,
    headers: { cookie: "abs_report=report-secret" },
  });
  const body = await text.response.text();
  assert.match(body, /acme: 12 link clicks/);
  assert.match(body, /Previews not counted: 3/);
  assert.match(body, /Test clicks not counted: 1/);
  assert.match(body, /ended: 0 link clicks/);
});

test("the report key is stored in a cookie and removed from the address", async () => {
  const first = await go("/_report?key=report-secret&from=2026-11-01&to=2026-11-26");
  assert.equal(first.response.status, 302);
  assert.equal(first.response.headers.get("location"), "/_report?from=2026-11-01&to=2026-11-26");
  assert.match(first.response.headers.get("set-cookie"), /abs_report=report-secret/);
  const wrong = await go("/_report?key=nope");
  assert.equal(wrong.response.status, 404);
});

test("every report query uses the Analytics SQL binding table name", () => {
  const source = readFileSync(new URL("./worker.mjs", import.meta.url), "utf8");
  const fromClauses = [...source.matchAll(/\bFROM\s+(\S+)/g)].map((match) => match[1]);
  assert.deepEqual(fromClauses, ["events.analyticsEngine.abs_link_clicks"]);
  assert.match(CLICK_REPORT_SQL, /FROM events\.analyticsEngine\.abs_link_clicks\b/);
});

test("Brisbane day bounds are UTC instants 24 hours apart", () => {
  assert.equal(brisbaneDayUtcStart("2026-11-26"), "2026-11-25T14:00:00.000Z");
  assert.equal(brisbaneDayUtcEndExclusive("2026-11-26"), "2026-11-26T14:00:00.000Z");
});

test("binding rows map blob columns and the SUM field", () => {
  const rows = rowsFromBindingResult({
    data: [{ blob1: "acme", blob2: "click", blob3: "2026-11-26", "SUM(sampleInterval)": 4 }],
  });
  assert.deepEqual(rows, [{ slug: "acme", kind: "click", day: "2026-11-26", n: 4 }]);
  assert.deepEqual(rowsFromBindingResult({ data: [] }), []);
  assert.deepEqual(rowsFromBindingResult({}), []);
});

test("analytics rows are read from the query result without storing an IP", () => {
  const rows = rowsFromAnalytics({
    data: [{ slug: "acme", kind: "click", day: "2026-11-26", n: "4" }],
  });
  assert.deepEqual(rows, [{ slug: "acme", kind: "click", day: "2026-11-26", n: "4" }]);
  assert.deepEqual(rowsFromAnalytics({ data: [] }), []);
});

test("a real HTTP request returns the 302 with no JavaScript body", async () => {
  const deps = memory();
  const server = createServer(async (req, res) => {
    const request = new Request(HOST + req.url, {
      method: req.method,
      headers: req.headers,
    });
    const response = await handleRequest(request, deps);
    await Promise.all(deps.pending);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/example`, {
      redirect: "manual",
      headers: { "user-agent": "facebookexternalhit/1.1" },
    });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "https://australianbusinessstartup.com.au/?utm_source=abs&utm_medium=facebook_group&utm_campaign=example"
    );
    assert.equal(await response.text(), "");
    assert.equal(deps.events[0].kind, "bot");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
