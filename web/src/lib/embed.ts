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

function measureHeight(): number {
  const doc = document.documentElement;
  const body = document.body;
  // Take the largest of the usual suspects — different layouts (absolute map,
  // flex columns) put the true content height in different places.
  return Math.ceil(
    Math.max(
      doc.scrollHeight,
      doc.offsetHeight,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
    ),
  );
}

export function initEmbedAutoResize(): void {
  if (typeof window === "undefined") return;
  // Only meaningful inside an iframe with a different-origin (or any) parent.
  if (window.parent === window) return;

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
