# Tracked links

Sponsored posts and newsletter mentions use a link on our own hostname, for example:

https://go.australianbusinessstartup.com.au/example

That address is a real server redirect (HTTP 302). It sends the person to the advertiser's site and counts the click. The main website stays on GitHub Pages. GitHub Pages cannot do this redirect, and this folder does not add a meta-refresh or JavaScript redirect page there. Facebook gets the same 302 as a person, including when it builds a link preview, so the preview is the advertiser's page. Preview checks are not counted.

The example link above goes to the Australian Business Startup homepage. It is there so the redirect can be tried before a real campaign.

## Add a link

Open `go-redirect/links.txt` and add one line:

```
acme-co https://acme.example/ active
```

Use lowercase letters, numbers and hyphens for the name. The link you post is:

https://go.australianbusinessstartup.com.au/acme-co

Do not change the destination after the link has been posted. If the offer ends, retire the link instead of editing the address. Change `active` to `retired`, or set a last day:

```
acme-co https://acme.example/ retired
acme-co https://acme.example/ until 2026-12-31
```

`until 2026-12-31` still works on that date in Brisbane time. The next day it sends people to the homepage and does not count them. An unknown name also goes to the homepage.

Commit the line to the `main` branch. The redirect reads that file from GitHub. A new line starts working within a few minutes. You do not deploy again just to add or retire a link.

The destination must start with `https://`. Anything else on the line is ignored, and that name sends people to the homepage. The destination cannot be chosen in the link you post. There is no open redirect.

If the destination already has UTM parameters, they are kept. If it does not, the redirect adds `utm_source=abs`, `utm_medium=facebook_group` and `utm_campaign=` plus the link name. For a newsletter-only link, put the medium on the destination so it is kept, for example `https://acme.example/?utm_medium=newsletter`.

## Read the clicks

After the one-time setup below, open:

https://go.australianbusinessstartup.com.au/_report?key=YOUR_KEY

Choose the From and To dates and press Show these dates. Dates are Brisbane time and include both days. **Clicks** is the number to email the advertiser. Previews, test clicks and retired visits are listed separately and are not included.

For a plain-text version you can paste into an email, add `&format=text`:

https://go.australianbusinessstartup.com.au/_report?key=YOUR_KEY&from=2026-11-01&to=2026-11-26&format=text

The first visit stores the key in a cookie and takes it out of the address bar. Bookmark the page after that. Counts are kept for 3 months.

To try a link without counting it, add `?test=1`:

https://go.australianbusinessstartup.com.au/example?test=1

Or open https://go.australianbusinessstartup.com.au/_test-on once in your own browser. Your clicks are then tests until you open https://go.australianbusinessstartup.com.au/_test-off. Visitors are not affected.

The advertiser's own analytics will usually show the referrer as facebook.com. Facebook sends the click out through its own system (often l.facebook.com or lm.facebook.com), so the referrer is Facebook rather than this site. The UTM parameters are how the advertiser can recognise the visit.

The count stores the link name, the Brisbane date, and whether it was a real click, a preview, a test, or a retired visit. It does not store a name, an email address, or an IP address.

## One-time setup

This needs a free Cloudflare account. It does not need a paid plan, a card to be charged, or an API key in this repo. Nothing here has been deployed.

Cost, on Cloudflare's published free allowances:

- The Workers Free plan includes 100,000 requests a day. Each click is one request. Opening the report is another. This is $0.
- Workers Analytics Engine on that free plan includes 100,000 click records written a day and 10,000 report reads a day. This is $0. Cloudflare's pricing page says Analytics Engine is not being billed yet. The allowance above is the free plan's published limit. The published rate after that allowance, for when billing starts, is $0.25 USD per extra million writes and $1 USD per extra million reads.
- The Workers Paid plan is $5 USD a month. You do not need it. If a day ever goes past the free request limit, redirects or counting can fail until the next day (the limit resets at 00:00 UTC) unless you choose the paid plan.
- Counts are kept for 3 months, then they drop off. Copy a figure into the advertiser's email when you send the report. There is no separate database to pay for.

Why Analytics Engine, not Workers KV: KV's free plan allows 1,000 writes a day, and only one write per second to the same link. A busy post would drop clicks. Analytics Engine appends one record per click, so the total is a sum and a burst does not wipe a count.

Netlify would also need a new free account and a DNS change, and the site would still be on GitHub Pages. It is not simpler.

### 1. Open a free Cloudflare account

Create an account at https://dash.cloudflare.com/sign-up and choose the Free plan. Do not start a Workers Paid subscription.

### 2. Add the domain

In Cloudflare, choose Add a site and enter `australianbusinessstartup.com.au`. Pick the Free plan. Cloudflare will scan the current DNS. Wait until it shows you two nameservers of its own.

### 3. Check the imported DNS before you switch

These records have to survive the move. The website records must stay **DNS only** (grey cloud), not proxied (orange cloud). The main site keeps being served by GitHub Pages. Only the `go` hostname is the new redirect, and Cloudflare creates that record in step 6.

- `A` record for the root, four addresses, all DNS only: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- `CNAME` `www` pointing at `ausbusstart.github.io`, DNS only
- `MX` for the root, priority `1`, pointing at `smtp.google.com`
- `TXT` for the root: `v=spf1 include:_spf.google.com include:sendersrv.com ~all`
- `TXT` for the root: `google-site-verification=M0puvgOUiEyZOYysHWzH3qyq3niNnh7EZVCzDj2ftFo`
- `TXT` for the root: `google-site-verification=qSNRYJbkEe_AdcUN9f6BaVd6tLQKx0CZz6JCQTlQcs4`
- `TXT` for `_dmarc`: `v=DMARC1; p=none;`

If Cloudflare's scan missed any of these, add them back before changing nameservers. Do not delete other records it found. Do not turn the orange cloud on for the root or for `www`.

### 4. Change the nameservers

The nameservers today are `ns1.nameserver.net.au`, `ns2.nameserver.net.au` and `ns3.nameserver.net.au`. At the registrar (the company where the domain is renewed), replace them with the two nameservers Cloudflare shows in step 2. This is the only DNS change you type in yourself. Cloudflare will add the `go` record later.

Wait until Cloudflare says the zone is Active. Then open https://australianbusinessstartup.com.au/ and send a test email to and from `admin@australianbusinessstartup.com.au`. Both should behave as they do today. If the site does not load, the root `A` records are missing or were switched to proxied. Set them back to the four GitHub addresses, DNS only.

### 5. Deploy once from this branch, before you merge

Merging publishes the new advertise-page and terms wording ("reach, engagement and link clicks"). Do this deploy first, and do not merge until the example link works.

On a computer with Node.js 18 or newer, in a copy of this branch (`cursor/go-link-clicks-d635`):

```
cd go-redirect
npx --yes wrangler@4 login
npx --yes wrangler@4 secret put REPORT_KEY
npx --yes wrangler@4 deploy
```

`wrangler login` opens Cloudflare in the browser. Approve it.

`REPORT_KEY` is a long password you invent (letters and numbers). It is not a Cloudflare API token. Wrangler stores it on the Worker. It is not written into this repo. You will need it to open the click report. Wrangler must be 4.145.0 or newer so the report can read the counts without an API token. `wrangler@4` installs that line.

Before the first deploy, the link list is not on `main` yet. In your local copy of `go-redirect/wrangler.toml`, temporarily set `LINKS_URL` to this branch. Do not commit that temporary address:

```
LINKS_URL = "https://raw.githubusercontent.com/AusBusStart/australianbusinessstartup-site/cursor/go-link-clicks-d635/go-redirect/links.txt"
```

Deploy that. Wrangler prints a `workers.dev` address. That address is only for a private test. Do not put it in a Facebook post. The public link is the `go` subdomain. Deploy also attaches `go.australianbusinessstartup.com.au` to the Worker and creates its DNS record and certificate. Certificate setup can take a few minutes.

### 6. Confirm the redirect

Open:

https://go.australianbusinessstartup.com.au/example?test=1

You should land on https://australianbusinessstartup.com.au/ with `utm_source=abs`, `utm_medium=facebook_group` and `utm_campaign=example` in the address. The `?test=1` means this visit is not counted.

Then open the report with your key. The example row should be there. A test click is under Tests, not under Clicks.

### 7. Point the link list at main, then merge

In `wrangler.toml`, set `LINKS_URL` back to:

```
LINKS_URL = "https://raw.githubusercontent.com/AusBusStart/australianbusinessstartup-site/main/go-redirect/links.txt"
```

Merge the pull request. As soon as `main` has `go-redirect/links.txt`, run `npx --yes wrangler@4 deploy` once more from the `go-redirect` folder on `main`.

Until that second deploy, the Worker is still reading the branch file. After it, adding a link is only the one line in `links.txt` on `main`.

Do not merge before step 6 succeeds. The merge is what publishes the updated advertise page, advertising terms, and the other pages that say we report reach, engagement and link clicks.

## Check the redirect logic on a computer

From `go-redirect`:

```
node --test redirect.test.mjs
```

That does not call Cloudflare. It checks the 302, the fixed destination list, preview bots, test clicks, retired links, and the report totals.
