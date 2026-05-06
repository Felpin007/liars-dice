const {
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} = require("./config");

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

function restUrl(path, query = "") {
  return `${SUPABASE_URL}/rest/v1/${path}${query ? `?${query}` : ""}`;
}

function serviceHeaders(extra = {}) {
  return {
    ...JSON_HEADERS,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function supabaseFetch(url, options = {}) {
  if (!isConfigured()) return null;
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Supabase request failed: ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || "",
    avatarUrl: row.avatar_url || "",
    bio: row.bio || "",
    rating: row.rating ?? 1000,
    gamesPlayed: row.games_played ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    currentStreak: row.current_streak ?? 0,
    bestStreak: row.best_streak ?? 0,
  };
}

function safeSlug(value, fallback) {
  return String(value || fallback || "player")
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 32)
    .toLowerCase() || fallback;
}

async function verifyAccessToken(accessToken) {
  if (!isConfigured() || !accessToken) return null;
  const user = await supabaseFetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return user;
}

async function ensureProfileFromUser(user, preferredUsername = "") {
  if (!isConfigured() || !user?.id) return null;
  const metadata = user.user_metadata || {};
  const fallbackName = metadata.full_name || metadata.name || user.email?.split("@")[0] || preferredUsername;
  const username = safeSlug(preferredUsername || fallbackName, `player-${user.id.slice(0, 6)}`);
  const displayName = String(metadata.full_name || metadata.name || preferredUsername || username).trim().slice(0, 60);
  const avatarUrl = String(metadata.avatar_url || metadata.picture || "").slice(0, 500);

  const rows = await supabaseFetch(restUrl("profiles", "on_conflict=id"), {
    method: "POST",
    headers: serviceHeaders({
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify([{
      id: user.id,
      username,
      display_name: displayName,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    }]),
  });
  return normalizeProfile(Array.isArray(rows) ? rows[0] : rows);
}

async function getProfile(profileId) {
  if (!isConfigured() || !profileId) return null;
  const rows = await supabaseFetch(restUrl(
    "profiles",
    `id=eq.${encodeURIComponent(profileId)}&select=id,username,display_name,avatar_url,bio,rating,games_played,wins,losses,current_streak,best_streak`
  ), {
    headers: serviceHeaders(),
  });
  return normalizeProfile(rows?.[0]);
}

async function updateProfile(profileId, patch) {
  if (!isConfigured() || !profileId) return null;
  const payload = {
    updated_at: new Date().toISOString(),
  };
  if (patch.username != null) payload.username = safeSlug(patch.username, `player-${profileId.slice(0, 6)}`);
  if (patch.displayName != null) payload.display_name = String(patch.displayName).trim().slice(0, 60);
  if (patch.bio != null) payload.bio = String(patch.bio).trim().slice(0, 240);
  if (patch.avatarUrl != null) payload.avatar_url = String(patch.avatarUrl).trim().slice(0, 500);

  const rows = await supabaseFetch(restUrl("profiles", `id=eq.${encodeURIComponent(profileId)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  return normalizeProfile(rows?.[0]);
}

async function getProfileBundle(profileId) {
  const profile = await getProfile(profileId);
  if (!profile) return null;
  const history = await supabaseFetch(restUrl(
    "match_players",
    [
      `profile_id=eq.${encodeURIComponent(profileId)}`,
      "select=match_id,seat,result,rating_before,rating_after,matches(id,label,mode_key,ended_at,round_count,player_count,bot_count)",
      "order=created_at.desc",
      "limit=12",
    ].join("&")
  ), {
    headers: serviceHeaders(),
  });
  return {
    profile,
    history: (history || []).map((row) => ({
      matchId: row.match_id,
      seat: row.seat,
      result: row.result,
      ratingBefore: row.rating_before,
      ratingAfter: row.rating_after,
      match: row.matches,
    })),
  };
}

function resultForPlayer(match, player) {
  if (player.isBot) return "bot";
  if (match.winnerSeat == null) return "draw";
  return player.seat === match.winnerSeat ? "win" : "loss";
}

function ratingDelta(result, humanCount) {
  if (result === "win") return Math.max(12, 20 + (humanCount - 2) * 4);
  if (result === "loss") return -12;
  return 0;
}

async function persistFinishedMatch(match) {
  if (!isConfigured() || !match || match.phase !== "ended" || match.persistedAt) return false;
  match.persistedAt = Date.now();

  const humanPlayers = match.players.filter((player) => !player.isBot && player.supabaseUserId);
  const humanCount = Math.max(1, humanPlayers.length);
  const profileRows = [];
  const playerRows = [];

  for (const player of match.players) {
    const result = resultForPlayer(match, player);
    let ratingBefore = null;
    let ratingAfter = null;

    if (player.supabaseUserId) {
      const profile = await getProfile(player.supabaseUserId);
      ratingBefore = profile?.rating ?? 1000;
      ratingAfter = Math.max(100, ratingBefore + ratingDelta(result, humanCount));
      const wins = result === "win" ? 1 : 0;
      const losses = result === "loss" ? 1 : 0;
      const currentStreak = result === "win" ? (profile?.currentStreak || 0) + 1 : 0;
      profileRows.push({
        id: player.supabaseUserId,
        rating: ratingAfter,
        games_played: (profile?.gamesPlayed || 0) + 1,
        wins: (profile?.wins || 0) + wins,
        losses: (profile?.losses || 0) + losses,
        current_streak: currentStreak,
        best_streak: Math.max(profile?.bestStreak || 0, currentStreak),
        updated_at: new Date().toISOString(),
      });
    }

    playerRows.push({
      match_id: match.id,
      profile_id: player.supabaseUserId || null,
      player_name: player.name,
      seat: player.seat,
      is_bot: player.isBot,
      result,
      rating_before: ratingBefore,
      rating_after: ratingAfter,
      dice_left: player.diceCount,
      created_at: new Date().toISOString(),
    });
  }

  await supabaseFetch(restUrl("matches", "on_conflict=id"), {
    method: "POST",
    headers: serviceHeaders({
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify([{
      id: match.id,
      label: match.label,
      mode_key: match.modeKey,
      started_at: new Date(match.createdAt).toISOString(),
      ended_at: new Date(match.updatedAt || Date.now()).toISOString(),
      winner_seat: match.winnerSeat,
      winner_profile_id: match.players[match.winnerSeat]?.supabaseUserId || null,
      player_count: match.players.length,
      bot_count: match.players.filter((player) => player.isBot).length,
      round_count: match.round,
      config: match.config,
      final_snapshot: {
        players: match.players.map((player) => ({
          seat: player.seat,
          name: player.name,
          isBot: player.isBot,
          alive: player.alive,
          diceCount: player.diceCount,
        })),
        rounds: match.rounds,
        log: match.log,
      },
    }]),
  });

  if (playerRows.length) {
    await supabaseFetch(restUrl("match_players"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(playerRows),
    });
  }

  const actionRows = [];
  for (const round of match.rounds || []) {
    for (const action of round.bids || []) {
      actionRows.push({
        match_id: match.id,
        round_number: round.number,
        seat: action.seat,
        action_type: action.type,
        quantity: action.q || null,
        face: action.v || null,
        time_left_ms: action.timeLeftMs || null,
      });
    }
  }
  if (actionRows.length) {
    await supabaseFetch(restUrl("match_actions"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(actionRows),
    });
  }

  for (const row of profileRows) {
    await supabaseFetch(restUrl("profiles", `id=eq.${encodeURIComponent(row.id)}`), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
  }

  return true;
}

module.exports = {
  isConfigured,
  verifyAccessToken,
  ensureProfileFromUser,
  getProfileBundle,
  updateProfile,
  persistFinishedMatch,
};
