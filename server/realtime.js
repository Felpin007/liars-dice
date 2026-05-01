const state = require("./state");

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function pushToClient(clientId, event, payload) {
  const client = state.clients.get(clientId);
  if (!client) return;
  for (const stream of client.streams) {
    sendSse(stream, event, payload);
  }
}

function broadcast(event, payload) {
  for (const client of state.clients.values()) {
    for (const stream of client.streams) {
      sendSse(stream, event, payload);
    }
  }
}

module.exports = {
  sendSse,
  pushToClient,
  broadcast,
};
