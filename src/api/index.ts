import http from "node:http";
import { createHeyGenSession } from "./heygen.js";
import { launchRecallBot } from "./recall.js";

const port = 4000;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "POST" && url.pathname === "/api/session") {
      const session = await createHeyGenSession();
      return json(res, 200, session);
    }

    if (req.method === "POST" && url.pathname === "/api/join-meet") {
      const body = await readJsonBody(req);
      const bot = await launchRecallBot(body);
      return json(res, 200, bot);
    }

    return json(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
  } catch (error) {
    console.error(error);
    return json(res, 400, {
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`API server listening on http://localhost:${port}`);
});

async function readJsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function json(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown
) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}
