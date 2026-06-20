// When this SPA runs inside an <iframe> (e.g. embedded in a Shopify page) it
// has no idea how tall its host wants it to be, and the host can't read the
// iframe's content height across origins. So we post our measured height up to
// the parent, which resizes the iframe to match — no inner scrollbar, no
// guessed fixed height. No-op when not framed.
//
// The matching listener lives in the Shopify Liquid section (see
// docs/SHOPIFY_EMBED.md). Messages are tagged so the host can ignore unrelated
// postMessage traffic; the host only trusts messages whose event.source is this
// iframe's window, so posting to "*" here only ever leaks a height integer.

const MESSAGE_NAMESPACE = "wsbb-locator";

type HeightMessage = { type: "wsbb-locator:height"; height: number };
type ScrollTopMessage = { type: "wsbb-locator:scroll-to-top" };

function isFramed(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

export function postScrollToTop(): void {
  if (!isFramed()) return;
  const message: ScrollTopMessage = { type: `${MESSAGE_NAMESPACE}:scroll-to-top` };
  window.parent.postMessage(message, "*");
  window.scrollTo(0, 0);
}

// Module-level so both the ResizeObserver and explicit callers (e.g. route
// changes) share the same dedupe state.
let lastSentHeight = -1;

export function postHeight(force = false): void {
  if (!isFramed()) return;
  const height = measureHeight();
  if (!force && height === lastSentHeight) return;
  lastSentHeight = height;
  const message: HeightMessage = { type: `${MESSAGE_NAMESPACE}:height`, height };
  window.parent.postMessage(message, "*");
}

// Call when the SPA navigates to a new route. Order matters: resize the host
// frame to the new page BEFORE asking it to scroll. Otherwise the host starts
// smooth-scrolling toward the (still tall) frame, then the height message
// shrinks the document mid-animation — which clamps/cancels the scroll partway
// and strands the host below the top of the app. The ResizeObserver also only
// fires once as the route mounts, before the new page's avatar image and web
// fonts settle, so we re-measure across the next several frames and re-issue
// the scroll once the height has stabilized.
export function notifyEmbedNavigated(): void {
  if (!isFramed()) return;

  postHeight(true);
  postScrollToTop();

  let frames = 0;
  const tick = (): void => {
    postHeight(true);
    if (++frames < 6) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Catch slower async settles (web fonts swapping, images decoding) and
  // re-scroll once the frame has reached its final height.
  setTimeout(() => {
    postHeight(true);
    postScrollToTop();
  }, 300);
  setTimeout(() => postHeight(true), 600);
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

  // Collapse the viewport-height min-heights while framed. On a standalone page
  // they make content fill the viewport, but inside an iframe `vh` resolves to
  // the frame's *current* height — pinning content as tall as the frame so it
  // can never shrink back down (measureHeight reads that pinned bottom and the
  // frame stays stuck). Every such rule reads these tokens (see tokens.css), so
  // flipping them here neutralizes all of them at once, including any future
  // full-height wrapper that uses the same tokens.
  const root = document.documentElement;
  root.style.setProperty("--app-min-height", "auto");
  root.style.setProperty("--section-min-height", "auto");

  // ResizeObserver catches layout shifts: map tiles loading, filtering the
  // coach grid, route changes, fonts settling, viewport width changes.
  const observer = new ResizeObserver(() => postHeight());
  observer.observe(document.documentElement);
  if (document.body) observer.observe(document.body);

  window.addEventListener("load", () => postHeight());

  // Let the host pull a fresh height on demand (e.g. right after it injects the
  // iframe, before our observers have fired).
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type === `${MESSAGE_NAMESPACE}:request-height`)
      postHeight(true);
  });

  postHeight(true);
}
