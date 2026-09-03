/** Browser `resize` subscription with idempotent cleanup. */
export function subscribeBrowserResize(callback: () => void): () => void {
  const handler = () => {
    callback();
  };
  window.addEventListener('resize', handler);
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener('resize', handler);
  };
}
