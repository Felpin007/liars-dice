const http = require("node:http");
const { PORT, handleRequest } = require("./app");
const { cleanupState } = require("./lobby-service");

if (!process.env.SESSION_SECRET) {
  console.warn("[security] SESSION_SECRET ausente; sessoes serao invalidadas a cada reinicio do servidor.");
}

const server = http.createServer(handleRequest);

setInterval(cleanupState, 10_000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Liar's Dice Arena server on http://localhost:${PORT}`);
});
