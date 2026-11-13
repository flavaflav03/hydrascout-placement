# Security notes

Last review: 2026-11-13 (code of this repository, Logger Overview's login and `/api/devices`, deploy setup).
The VPS itself is checked with [`security-check.sh`](security-check.sh), which only reads settings and changes nothing:

```sh
ssh hostinger 'sudo bash -s' < deploy/security-check.sh > security-report.txt
```

## How the app is exposed

- The placement app is static files (HTML, CSS, JS): no server code, no database, no API key. Everything a user
  enters stays in their browser (`localStorage`, keys starting with `hs.`).
- It calls public data services straight from the browser (Open-Meteo, SoilGrids, IGN Géoplateforme, Earth Search /
  Sentinel-2, Nominatim, map tiles). None needs a key.
- On `placement.coccinelia.com`, Caddy also passes `/login` and `/api/devices` to HSTI Logger Overview. So this site
  holds the Logger Overview login cookie (`dl_session`, HttpOnly, Secure, SameSite=Lax), and any script running on
  the page could read the fleet's device list through it. That is why the page only runs its own scripts and pinned
  copies of its libraries (below).

## What protects the page

- **Content-Security-Policy** (meta tag in `index.html`): scripts only from this site and `cdn.jsdelivr.net`; no inline
  scripts or `eval`; no plugins; forms and `<base>` limited to this site. Network calls (`connect-src`) and images stay
  open to any `https:` service, because the app reads many public data services.
- **Subresource Integrity**: Leaflet, proj4, geotiff.js and three.js load from jsDelivr with an `integrity` hash, so a
  changed file on the CDN is refused instead of run. To upgrade a library, change the version and its hash together:
  `curl -s https://cdn.jsdelivr.net/npm/<pkg>@<ver>/<file> | openssl dgst -sha512 -binary | base64`.
- All text from users, imported files and data services is escaped before it goes into the page (`escapeHtml`).
- CSV exports put an apostrophe before cells starting with `= + - @`, so a probe or block name taken from a customer's
  file can't run as a spreadsheet formula.
- The device lookup accepts `postMessage` replies only from the Logger Overview origin, and only numbers for positions.

## Headers to set in Caddy

A `<meta>` tag can't block framing or force HTTPS: those need response headers. Recommended for both sites
(`placement.coccinelia.com` and `logger.coccinelia.com`):

```caddy
(security_headers) {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Content-Security-Policy "frame-ancestors 'none'"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), payment=(), usb=()"
		-Server
	}
}

placement.coccinelia.com {
	import security_headers
	@private path /.git /.git/* /deploy/*
	respond @private 404
	# ... existing file_server and reverse_proxy lines ...
}
```

After editing: `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy` (or the Docker equivalent),
then run `security-check.sh` again. The Content-Security-Policy header above only adds `frame-ancestors`; browsers
apply it together with the page's own meta policy.

## Open items (Logger Overview, Bitbucket)

| Severity | Item | Suggested fix |
|---|---|---|
| Low | `POST /login` has no Origin check, so another site could log a visitor into an account of the attacker's choosing (login CSRF). | Refuse the POST when `Origin` is present and its host isn't the request's host, as `isSameOriginJson` does for the JSON routes. |
| Low | `TRUST_PROXY=1` takes the first `X-Forwarded-For` entry as the client IP. Caddy 2.5+ drops this header from clients, but if a proxy in front passes it through, anyone can dodge the 10-attempt login lock. | `security-check.sh` tests it; if the logger log shows the spoofed IP, take the last entry instead (the one Caddy adds). |
| Low | Unexpected errors return `e.message` to the browser. | Log the message and return a generic "Server error". |
| Info | The placement app downloads the whole device list to find one device. Every logged-in user can see that list in Logger Overview anyway. | Optional: a `/api/devices/lookup?id=` route that returns one device's position. |
