import { createReadStream } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4173);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(ROOT, "../public");

const staticFiles = new Map<string, { fileName: string; contentType: string }>([
  ["/", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/index.html", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/app.js", { fileName: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { fileName: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/bootstrap.min.css", { fileName: "bootstrap.min.css", contentType: "text/css; charset=utf-8" }],
]);

function sendText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(text);
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    return sendText(response, 405, "Método no permitido");
  }

  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  const asset = staticFiles.get(url.pathname);
  if (!asset) return sendText(response, 404, "No encontrado");

  const stream = createReadStream(path.join(PUBLIC_DIR, asset.fileName));
  stream.on("error", () => {
    if (!response.headersSent) sendText(response, 404, "No encontrado");
    else response.destroy();
  });
  stream.on("open", () => {
    response.writeHead(200, {
      "Content-Type": asset.contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else stream.pipe(response);
  });
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`No se pudo iniciar FolderLens: el puerto ${PORT} ya está ocupado.`);
  } else {
    console.error("No se pudo iniciar FolderLens:", error.message);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Comparador disponible en http://${HOST}:${PORT}`);
});
