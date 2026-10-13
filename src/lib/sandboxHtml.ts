/** 사용자 HTML을 앱 DOM과 분리해 렌더링할 문서로 감싼다. */
export function sandboxHtmlDocument(
  source: string,
  options: { allowScripts?: boolean; allowRemoteImages?: boolean; allowRemoteMedia?: boolean } = {},
): string {
  const scriptSource = options.allowScripts ? "'unsafe-inline' 'unsafe-eval'" : "'none'";
  const imageSource = options.allowRemoteImages ? 'data: blob: https:' : 'data: blob:';
  const mediaSource = options.allowRemoteMedia ? 'data: blob: https:' : 'data: blob:';
  const policy = [
    "default-src 'none'",
    `script-src ${scriptSource}`,
    "style-src 'unsafe-inline' data: blob: https:",
    `img-src ${imageSource}`,
    'font-src data: blob: https:',
    `media-src ${mediaSource}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "navigate-to 'none'",
  ].join('; ');
  const securityMeta = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const html = source.trim();

  if (!html) return `<!doctype html><html><head>${securityMeta}</head><body></body></html>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, head => `${head}${securityMeta}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, root => `${root}<head>${securityMeta}</head>`);
  }
  return `<!doctype html><html><head>${securityMeta}</head><body>${html}</body></html>`;
}
