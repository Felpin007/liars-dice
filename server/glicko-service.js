const TAU = 0.5;
const EPSILON = 0.000001;
const SCALE = 173.7178;
const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;
const DEFAULT_VOLATILITY = 0.06;

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function e(mu, muJ, phiJ) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function toGlicko2(profile = {}) {
  return {
    rating: Number(profile.rating ?? DEFAULT_RATING),
    rd: Number(profile.ratingDeviation ?? profile.rating_deviation ?? DEFAULT_RD),
    volatility: Number(profile.ratingVolatility ?? profile.rating_volatility ?? DEFAULT_VOLATILITY),
  };
}

function fromGlicko2(mu, phi, volatility) {
  return {
    rating: Math.round(DEFAULT_RATING + SCALE * mu),
    ratingDeviation: Math.round(Math.max(30, Math.min(350, SCALE * phi))),
    ratingVolatility: Math.max(0.01, Math.min(0.2, volatility)),
  };
}

function f(x, delta, phi, v, a) {
  const exp = Math.exp(x);
  const numerator = exp * (delta * delta - phi * phi - v - exp);
  const denominator = 2 * Math.pow(phi * phi + v + exp, 2);
  return (numerator / denominator) - ((x - a) / (TAU * TAU));
}

function newVolatility(phi, delta, v, sigma) {
  const a = Math.log(sigma * sigma);
  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU, delta, phi, v, a) < 0) k += 1;
    B = a - k * TAU;
  }

  let fA = f(A, delta, phi, v, a);
  let fB = f(B, delta, phi, v, a);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C, delta, phi, v, a);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

function updatePlayer(player, games) {
  const current = toGlicko2(player);
  if (!games.length) {
    const phi = Math.sqrt(Math.pow(current.rd / SCALE, 2) + current.volatility * current.volatility);
    return fromGlicko2((current.rating - DEFAULT_RATING) / SCALE, phi, current.volatility);
  }

  const mu = (current.rating - DEFAULT_RATING) / SCALE;
  const phi = current.rd / SCALE;
  const sigma = current.volatility;
  let vInv = 0;
  let deltaSum = 0;
  for (const game of games) {
    const opponent = toGlicko2(game.opponent);
    const muJ = (opponent.rating - DEFAULT_RATING) / SCALE;
    const phiJ = opponent.rd / SCALE;
    const gPhi = g(phiJ);
    const expected = e(mu, muJ, phiJ);
    vInv += gPhi * gPhi * expected * (1 - expected);
    deltaSum += gPhi * (game.score - expected);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;
  const sigmaPrime = newVolatility(phi, delta, v, sigma);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt((1 / (phiStar * phiStar)) + (1 / v));
  const muPrime = mu + phiPrime * phiPrime * deltaSum;
  return fromGlicko2(muPrime, phiPrime, sigmaPrime);
}

function scoreFor(resultA, resultB) {
  if (resultA === "win" && resultB === "loss") return 1;
  if (resultA === "loss" && resultB === "win") return 0;
  return 0.5;
}

function updateMatchRatings(players) {
  const byId = new Map(players.map((player) => [player.id, player]));
  const updates = new Map();
  for (const player of players) {
    const games = players
      .filter((opponent) => opponent.id !== player.id)
      .map((opponent) => ({
        opponent,
        score: scoreFor(player.result, opponent.result),
      }));
    updates.set(player.id, updatePlayer(player, games));
  }
  return Array.from(updates.entries()).map(([id, update]) => ({
    id,
    before: toGlicko2(byId.get(id)),
    after: update,
  }));
}

module.exports = {
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOLATILITY,
  updateMatchRatings,
  updatePlayer,
};
