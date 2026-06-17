// Tiny stand-in for the Obsidian notify listener. Logs every POST /notify body
// so we can confirm the Zotero side actually dispatches events.

import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 9091);

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/notify") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      console.log(`[${new Date().toISOString()}] ${body}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`capture server listening on http://127.0.0.1:${PORT}/notify`);
});
