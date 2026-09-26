import appJs from "../public/app.js";
import faviconSvg from "../public/favicon.svg";
import indexHtml from "../public/index.html";
import styleCss from "../public/style.css";

const PAGE_FILES: Record<string, { body: string; contentType: string }> = {
  "/": { body: indexHtml, contentType: "text/html; charset=utf-8" },
  "/index.html": { body: indexHtml, contentType: "text/html; charset=utf-8" },
  "/app.js": { body: appJs, contentType: "text/javascript; charset=utf-8" },
  "/style.css": { body: styleCss, contentType: "text/css; charset=utf-8" },
  "/favicon.svg": { body: faviconSvg, contentType: "image/svg+xml" },
};

export function pageFile(pathname: string): Response | undefined {
  const file = PAGE_FILES[pathname];
  if (!file) return undefined;
  return new Response(file.body, { headers: { "Content-Type": file.contentType, "Cache-Control": "public, max-age=300" } });
}
