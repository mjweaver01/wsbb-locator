// When this SPA runs inside an <iframe> (e.g. embedded in a Shopify page) it
// has no idea how tall its host wants it to be, and the host can't read the
// iframe's content height across origins. So we post our measured height up to
// the parent, which resizes the iframe to match — no inner scrollbar, no
// guessed fixed height. No-op when not framed.
//
// The matching listener lives in the Shopify Liquid section (see
// docs/SHOPIFY_EMBED.md). Messages are tagged so the host can ignore unrelated
// postMessage traffic; the host verifies event.origin, so posting to "*" here
// only ever leaks a height integer.

const MESSAGE_NAMESPACE = "wsbb-locator";

type HeightMessage = { type: "wsbb-locator:height"; height: number };
type ScrollTopMessage = { type: "wsbb-locator:scroll-to-top" };

export function postScrollToTop(): void {
  if (typeof window === "undefined" || window.parent === window) return;
  const message: ScrollTopMessage = { type: `${MESSAGE_NAMESPACE}:scroll-to-top` };
  window.parent.postMessage(message, "*");
  window.scrollTo(0, 0);
}

function measureHeight(): number {
  const body = document.body;
  if (!body) return Math.ceil(document.documentElement.scrollHeight);
  // Measure the actual bottom of the rendered content rather than
  // documentElement/body scrollHeight. Inside an iframe the host sizes the
  // frame to whatever height we report, which makes `100vh`-based layouts (and
  // therefore scrollHeight) fill the frame — so scrollHeight can only ever grow
  // and never reports that the content got shorter. The bounding-box bottom of
  // the content reflects the true height regardless of the frame's size.
  // `bottom` is viewport-relative; add scroll offset to get the document-space
  // height so a scrolled frame doesn't under-report.
  return Math.ceil(body.getBoundingClientRect().bottom + window.scrollY);
}

export function initEmbedAutoResize(): void {
  if (typeof window === "undefined") return;
  // Only meaningful inside an iframe with a different-origin (or any) parent.
  if (window.parent === window) return;

  // Neutralize the `min-height: 100vh` rules (see base.css) while framed. They
  // make the footer stick to the bottom on short standalone pages, but inside
  // an iframe `100vh` resolves to the frame's current height, pinning the
  // content tall and preventing it from ever shrinking back down.
  const style = document.createElement("style");
  style.textContent = "body, #root { min-height: 0 !important; }";
  document.head.appendChild(style);

  let lastSent = -1;
  const post = (): void => {
    const height = measureHeight();
    if (height === lastSent) return;
    lastSent = height;
    const message: HeightMessage = {
      type: `${MESSAGE_NAMESPACE}:height`,
      height,
    };
    window.parent.postMessage(message, "*");
  };

  // ResizeObserver catches layout shifts: map tiles loading, filtering the
  // coach grid, route changes, fonts settling, viewport width changes.
  const observer = new ResizeObserver(() => post());
  observer.observe(document.documentElement);
  if (document.body) observer.observe(document.body);

  window.addEventListener("load", post);

  // Let the host pull a fresh height on demand (e.g. right after it injects the
  // iframe, before our observers have fired).
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type === `${MESSAGE_NAMESPACE}:request-height`) post();
  });

  post();
}
