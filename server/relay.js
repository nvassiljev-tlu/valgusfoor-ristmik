// Väike sõnumirelee mitme arvuti jaoks, kui ntfy.sh-d kasutada ei saa (nt ilma internetita, kõik
// arvutid ühes WiFi-s või telefoni levialas). Toetab ntfy.sh API osa, mida leht kasutab, ja annab
// kellaaja, et kõik arvutid kasutaksid sama kella.
//
// Käivitamine:  node server/relay.js [port]      (vaikimisi 8090)
// Lehel väljale „Relee“: http://<selle arvuti IP>:8090

"use strict";
const http = require("http");
const os = require("os");

const PORT = process.argv[2] === undefined ? 8090 : Number(process.argv[2]);
const KEEP_MS = 12 * 3600 * 1000;
const MAX_BODY = 4096;
const topics = new Map();
let counter = 0;

function topic(name) {
  if (!topics.has(name)) topics.set(name, { messages: [], clients: new Set() });
  return topics.get(name);
}

const newId = () => (Date.now().toString(36) + (counter++).toString(36)).slice(-12);
const now = () => Math.floor(Date.now() / 1000);

function since(messages, spec) {
  if (spec === "all") return messages;
  const duration = /^(\d+)([smhd])$/.exec(spec || "");
  if (duration) {
    const unit = { s: 1, m: 60, h: 3600, d: 86400 }[duration[2]];
    return messages.filter((m) => m.time >= now() - Number(duration[1]) * unit);
  }
  if (/^\d+$/.test(spec || "")) return messages.filter((m) => m.time >= Number(spec));
  const i = messages.findIndex((m) => m.id === spec);
  return i >= 0 ? messages.slice(i + 1) : messages;
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, "http://relee");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && parts.join("/") === "aeg") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(String(Date.now()));
    return;
  }
  if (!parts.length || !/^[-_A-Za-z0-9]{1,64}$/.test(parts[0])) {
    res.writeHead(404);
    res.end();
    return;
  }
  const name = parts[0];

  if (req.method === "POST" && parts.length === 1) {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on("end", () => {
      const msg = { id: newId(), time: now(), event: "message", topic: name, message: body };
      const t = topic(name);
      t.messages.push(msg);
      for (const client of t.clients) client.write(`data: ${JSON.stringify(msg)}\n\n`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(msg));
    });
    return;
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "json" && url.searchParams.get("poll") === "1") {
    const list = since(topic(name).messages, url.searchParams.get("since") || "all");
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(list.map((m) => JSON.stringify(m) + "\n").join(""));
    return;
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "sse") {
    const t = topic(name);
    const info = (event) => JSON.stringify({ id: newId(), time: now(), event, topic: name });
    res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
    res.write(`event: open\ndata: ${info("open")}\n\n`);
    const spec = url.searchParams.get("since");
    if (spec) for (const m of since(t.messages, spec)) res.write(`data: ${JSON.stringify(m)}\n\n`);
    t.clients.add(res);
    const keepalive = setInterval(() => res.write(`event: keepalive\ndata: ${info("keepalive")}\n\n`), 25000);
    req.on("close", () => {
      clearInterval(keepalive);
      t.clients.delete(res);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

setInterval(() => {
  for (const [name, t] of topics) {
    t.messages = t.messages.filter((m) => m.time * 1000 >= Date.now() - KEEP_MS);
    if (!t.messages.length && !t.clients.size) topics.delete(name);
  }
}, 60000).unref();

server.listen(PORT, () => {
  const port = server.address().port;
  console.log(`Relee töötab pordil ${port}. Kirjuta lehel väljale „Relee“ üks neist aadressidest:`);
  console.log(`  http://localhost:${port}   (samas arvutis)`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === "IPv4" || a.family === 4) && !a.internal) console.log(`  http://${a.address}:${port}`);
    }
  }
});
