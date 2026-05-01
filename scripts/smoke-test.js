const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const GameServer = require("../server/authoritative-game");

const ROOT = path.resolve(__dirname, "..");

function checkSyntax(relativePath) {
  execFileSync(process.execPath, ["--check", path.join(ROOT, relativePath)], { stdio: "pipe" });
}

function checkAllSyntax() {
  for (const file of fs.readdirSync(path.join(ROOT, "server"))) {
    if (file.endsWith(".js")) checkSyntax(path.join("server", file));
  }
  for (const file of fs.readdirSync(path.join(ROOT, "js"))) {
    if (file.endsWith(".js")) checkSyntax(path.join("js", file));
  }
}

function checkAuthoritativeRound() {
  const match = GameServer.createMatch({
    id: "test_match",
    label: "Smoke",
    modeKey: "smoke-1-0",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bob"],
    humanPlayers: [
      { clientId: "alice", username: "Alice", seat: 0 },
      { clientId: "bob", username: "Bob", seat: 1 },
    ],
    botSeats: [],
    startSeat: 0,
    config: { startingDice: 5, wildAces: true, calzaEnabled: false },
  });

  assert.equal(match.phase, "bidding");
  assert.equal(match.turnSeat, 0);

  const aliceView = GameServer.viewForClient(match, "alice");
  assert.equal(aliceView.players[0].dice.length, 5);
  assert.ok(aliceView.players[0].dice.every((die) => die >= 1 && die <= 6));
  assert.ok(aliceView.players[1].dice.every((die) => die === 0));
  assert.equal(aliceView.commitment.seedHex, null);

  const bid = GameServer.applyAction(match, 0, { type: "bid", bid: { q: 1, v: 2 } });
  assert.equal(bid.ok, true);
  assert.equal(match.turnSeat, 1);
  assert.equal(match.currentBid.q, 1);
  assert.equal(match.currentBid.v, 2);

  const dudo = GameServer.applyAction(match, 1, { type: "dudo" });
  assert.equal(dudo.ok, true);
  assert.equal(match.revealAll, true);

  const revealView = GameServer.viewForClient(match, "alice");
  assert.ok(revealView.commitment.seedHex);
  assert.ok(revealView.players[1].dice.some((die) => die > 0));
}

checkAllSyntax();
checkAuthoritativeRound();
console.log("Smoke tests passed.");
