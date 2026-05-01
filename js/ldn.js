// Liar's Dice Notation (plan §13) — exporter
const LDN = (() => {

  function letter(seat) {
    // A B C D E F G H
    return String.fromCharCode(65 + seat);
  }

  function render(match, log) {
    const L = [];
    const pad = (k, v) => L.push(`[${k} "${v}"]`);
    pad("Event", "Casual Match");
    pad("Site", "liarsdicearena.local");
    pad("Date", new Date().toISOString().slice(0, 10).replace(/-/g, "."));
    pad("Round", "1");
    match.players.forEach((p, i) => {
      pad(i === 0 ? "White" : `P${i}`, p.name);
    });
    const winner = match.winnerSeat != null ? match.players[match.winnerSeat].name : "—";
    pad("Result", winner);
    pad("TimeControl", "casual");
    pad("Variant", "Classic");
    pad("Wildcard", match.config.wildAces ? "Aces" : "Off");
    pad("Calza", match.config.calzaEnabled ? "On" : "Off");
    if (match.commitment) {
      pad("ServerSeedHash", "sha256:" + match.commitment.hashHex);
      pad("ServerSeedReveal", match.commitment.seedHex || "");
      pad("ClientSeeds", (match.commitment.clientSeeds || []).join(","));
      pad("PhysicsSeed", "0x" + (match.commitment.physicsSeed || 0).toString(16));
    }
    L.push("");

    for (const r of match.rounds) {
      const handStr = r.hands
        .filter(h => h.alive || r.startedAlive.includes(h.seat))
        .map(h => `${letter(h.seat)}:[${h.dice.join(",")}]`)
        .join(" ");
      L.push(`${r.number}. R { ${handStr} }`);
      const bidStr = r.bids.map(b => {
        if (b.type === "bid") return `${letter(b.seat)} ${b.q}x${b.v}`;
        if (b.type === "dudo") return `${letter(b.seat)} dudo!`;
        if (b.type === "calza") return `${letter(b.seat)} calza!`;
        if (b.type === "timeout") return `${letter(b.seat)} timeout!`;
        return "";
      }).join(" ; ");
      L.push(`   ${bidStr}`);
      const o = r.outcome;
      if (o) {
        if (o.type === "dudo_resolved") {
          L.push(`   => real=${o.real}, claim=${o.bid.q} → ${o.claimTrue ? "verdadeiro" : "falso"} → ${letter(o.loserSeat)} -1d`);
        } else if (o.type === "calza_resolved") {
          L.push(`   => real=${o.real}, claim=${o.bid.q} → ${o.exact ? "exato" : "errado"} → ${letter(o.callerSeat)} ${o.exact ? "+1d" : "-1d"}`);
        } else if (o.type === "timeout_resolved") {
          L.push(`   => timeout → ${letter(o.loserSeat)} -1d`);
        }
      }
      L.push("");
    }
    L.push(`{MatchEnd: ${winner}}`);
    return L.join("\n");
  }

  return { render };
})();
