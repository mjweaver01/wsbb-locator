# Embedding the locator in a Shopify page

The locator is a standalone SPA served by the API at
`https://wsbb-coaches.up.railway.app/`. To put it inside a Shopify theme page we
embed it in an `<iframe>` and let the app report its height so the frame
auto-sizes (no inner scrollbar).

The app already allows framing: `api/src/app.ts` disables the default
`X-Frame-Options: SAMEORIGIN` header (which would otherwise block Shopify from
embedding it). Nothing to configure — just deploy and add the section below.

You can confirm the header is gone after deploy:

```bash
curl -sI https://wsbb-coaches.up.railway.app/ | grep -i x-frame-options
# expect: no output (header not present)
```

## Add the section to your Shopify theme

1. Shopify admin → **Online Store → Themes → ⋯ → Edit code**.
2. Under **Sections**, **Add a new section**, name it `wsbb-locator`.
3. Replace the generated file's contents with
   [`docs/shopify/wsbb-locator.liquid`](./shopify/wsbb-locator.liquid).
4. Add it to a page:
   - **Theme editor route:** create/open a page that uses a template you can
     edit (e.g. `page.locator.json`), then **Add section → WSBB Locator**; or
   - **Custom Liquid:** drop `{% section 'wsbb-locator' %}` into a template or a
     "Custom Liquid" block on the page.
5. In the section settings, the **App URL** defaults to the Railway URL and the
   **Initial height** is the placeholder height shown until the app reports its
   real size.

## How auto-resize works

- `web/src/lib/embed.ts` runs only when the app is inside an iframe. A
  `ResizeObserver` posts `{ type: "wsbb-locator:height", height }` to the parent
  whenever the content height changes (map tiles, filtering, route changes).
- The Liquid section listens for that message, **verifies `event.origin`**
  matches the iframe's URL, and sets the iframe height. On `load` it also posts
  `wsbb-locator:request-height` so the app re-sends in case the listener
  attached late.

## Troubleshooting

- **Blank frame / "refused to connect" in console** — the deploy still sends
  `X-Frame-Options: SAMEORIGIN` (confirm with the `curl` above); redeploy so the
  updated `api/src/app.ts` is live.
- **Frame loads but stays at the initial height** — the height message isn't
  reaching the listener: confirm the App URL origin exactly matches what the app
  is served from (scheme + host, no trailing path), and that you're on a build
  that includes `initEmbedAutoResize()`.
- **Geolocation prompt missing** — the iframe forwards it via `allow="geolocation"`;
  the Shopify page itself must also be HTTPS (it always is).
