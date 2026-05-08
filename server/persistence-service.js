const {
  SUPABASE_ANON_KEY,
  SUPABASE_AVATAR_BUCKET,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} = require("./config");
const Glicko = require("./glicko-service");
const moderation = require("./moderation-service");
const progression = require("./progression-service");
const { httpError } = require("./utils");

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

function restUrl(path, query = "") {
  return `${SUPABASE_URL}/rest/v1/${path}${query ? `?${query}` : ""}`;
}

function authUrl(path) {
  return `${SUPABASE_URL}/auth/v1/${path}`;
}

function storageUrl(path) {
  return `${SUPABASE_URL}/storage/v1/${path}`;
}

function serviceHeaders(extra = {}) {
  return {
    ...JSON_HEADERS,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function publicCodeForSupabaseError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("duplicate key") || message.includes("profiles_username")) return "username_taken";
  if (message.includes("bucket not found")) return "avatar_bucket_missing";
  if (message.includes("permission denied") || message.includes("violates row-level security")) return "supabase_permission_denied";
  if (message.includes("relation") && message.includes("does not exist")) return "supabase_schema_missing";
  return null;
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
    error.publicCode = publicCodeForSupabaseError(error);
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
    rating: row.rating ?? Glicko.DEFAULT_RATING,
    ratingDeviation: row.rating_deviation ?? Glicko.DEFAULT_RD,
    ratingVolatility: row.rating_volatility ?? Glicko.DEFAULT_VOLATILITY,
    ratingUpdatedAt: row.rating_updated_at || null,
    xp: row.xp ?? 0,
    level: row.level ?? progression.levelForXp(row.xp ?? 0),
    gamesPlayed: row.games_played ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    currentStreak: row.current_streak ?? 0,
    bestStreak: row.best_streak ?? 0,
  };
}

function safeSlug(value, fallback) {
  const slug = String(value || fallback || "player")
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 32)
    .toLowerCase() || fallback;
  if (moderation.hasProfanity(slug)) throw httpError(400, "profile_text_blocked");
  return slug;
}

const BLOCKED_PROFILE_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\b(discord\.gg|t\.me|bit\.ly|tinyurl\.com)\b/i,
];

function sanitizeProfileText(value, maxLength, fallback = "") {
  const validation = moderation.validateText(value, { field: "profile_text", maxLength, allowEmpty: true });
  if (!validation.ok) {
    if (fallback) return fallback;
    throw httpError(400, validation.error || "profile_text_blocked");
  }
  let text = validation.text || fallback;
  for (const pattern of BLOCKED_PROFILE_PATTERNS) text = text.replace(pattern, "");
  return (text || fallback).slice(0, maxLength);
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
  const fallbackUsername = `player-${user.id.slice(0, 6)}`;
  let username = fallbackUsername;
  try {
    username = safeSlug(preferredUsername || fallbackName, fallbackUsername);
  } catch {
    username = fallbackUsername;
  }
  const displayName = sanitizeProfileText(metadata.full_name || metadata.name || preferredUsername || username, 60, username);
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
    `id=eq.${encodeURIComponent(profileId)}&select=id,username,display_name,avatar_url,bio,rating,rating_deviation,rating_volatility,rating_updated_at,xp,level,games_played,wins,losses,current_streak,best_streak`
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
  if (patch.displayName != null) payload.display_name = sanitizeProfileText(patch.displayName, 60);
  if (patch.bio != null) payload.bio = sanitizeProfileText(patch.bio, 240);
  if (patch.avatarUrl != null) payload.avatar_url = String(patch.avatarUrl).trim().slice(0, 500);

  const rows = await supabaseFetch(restUrl("profiles", `id=eq.${encodeURIComponent(profileId)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  return normalizeProfile(rows?.[0]);
}

async function safeStatus(fn) {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

async function healthStatus() {
  const configured = isConfigured();
  if (!configured) {
    return {
      configured: false,
      profilesTable: false,
      matchesTables: false,
      avatarBucket: false,
    };
  }

  const [
    profilesTable,
    matchesTable,
    matchPlayersTable,
    matchActionsTable,
    avatarBucket,
    friendRequestsTable,
    friendshipsTable,
    notificationsTable,
  ] = await Promise.all([
    safeStatus(() => supabaseFetch(restUrl("profiles", "select=id&limit=1"), { headers: serviceHeaders() })),
    safeStatus(() => supabaseFetch(restUrl("matches", "select=id&limit=1"), { headers: serviceHeaders() })),
    safeStatus(() => supabaseFetch(restUrl("match_players", "select=id&limit=1"), { headers: serviceHeaders() })),
    safeStatus(() => supabaseFetch(restUrl("match_actions", "select=id&limit=1"), { headers: serviceHeaders() })),
    safeStatus(() => supabaseFetch(storageUrl(`bucket/${encodeURIComponent(SUPABASE_AVATAR_BUCKET)}`), { headers: serviceHeaders() })),
    safeStatus(() => supabaseFetch(restUrl("friend_requests", "select=id&limit=1"), { headers: serviceHeaders() })),
    safeStatus(() => supabaseFetch(restUrl("friendships", "select=pair_key&limit=1"), { headers: serviceHeaders() })),
    safeStatus(() => supabaseFetch(restUrl("notifications", "select=id&limit=1"), { headers: serviceHeaders() })),
  ]);

  return {
    configured: true,
    profilesTable,
    matchesTables: matchesTable && matchPlayersTable && matchActionsTable,
    socialTables: friendRequestsTable && friendshipsTable && notificationsTable,
    avatarBucket,
  };
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

async function persistFinishedMatch(match) {
  if (!isConfigured() || !match || match.phase !== "ended" || match.persistedAt) return false;
  match.persistedAt = Date.now();

  const botCount = match.players.filter((player) => player.isBot).length;
  const humanRows = match.players.filter((player) => !player.isBot);
  const isRankedEligible = match.matchType === "ranqueada"
    && botCount === 0
    && humanRows.length >= 2
    && humanRows.every((player) => player.supabaseUserId);
  const humanPlayers = match.players.filter((player) => !player.isBot && player.supabaseUserId);
  const profilesById = new Map();
  for (const player of humanPlayers) {
    if (!profilesById.has(player.supabaseUserId)) {
      profilesById.set(player.supabaseUserId, await getProfile(player.supabaseUserId));
    }
  }
  const ratingUpdates = new Map();
  if (isRankedEligible) {
    const rankedPlayers = humanPlayers.map((player) => {
      const profile = profilesById.get(player.supabaseUserId) || {};
      return {
        id: player.supabaseUserId,
        result: resultForPlayer(match, player),
        rating: profile.rating ?? Glicko.DEFAULT_RATING,
        ratingDeviation: profile.ratingDeviation ?? Glicko.DEFAULT_RD,
        ratingVolatility: profile.ratingVolatility ?? Glicko.DEFAULT_VOLATILITY,
      };
    });
    for (const update of Glicko.updateMatchRatings(rankedPlayers)) {
      ratingUpdates.set(update.id, update);
    }
  }
  const profileRows = [];
  const playerRows = [];

  for (const player of match.players) {
    const result = resultForPlayer(match, player);
    let ratingBefore = null;
    let ratingAfter = null;

    if (player.supabaseUserId) {
      const profile = profilesById.get(player.supabaseUserId) || {};
      const ratingUpdate = ratingUpdates.get(player.supabaseUserId);
      if (ratingUpdate) {
        ratingBefore = Math.round(ratingUpdate.before.rating);
        ratingAfter = Math.round(ratingUpdate.after.rating);
      }
      const wins = result === "win" ? 1 : 0;
      const losses = result === "loss" ? 1 : 0;
      const currentStreak = result === "win" ? (profile?.currentStreak || 0) + 1 : 0;
      const nextXp = (profile?.xp || 0) + progression.xpAwardForMatch(match, result, isRankedEligible, currentStreak);
      const profilePatch = {
        id: player.supabaseUserId,
        xp: nextXp,
        level: progression.levelForXp(nextXp),
        games_played: (profile?.gamesPlayed || 0) + 1,
        wins: (profile?.wins || 0) + wins,
        losses: (profile?.losses || 0) + losses,
        current_streak: currentStreak,
        best_streak: Math.max(profile?.bestStreak || 0, currentStreak),
        updated_at: new Date().toISOString(),
      };
      if (ratingUpdate) {
        profilePatch.rating = ratingAfter;
        profilePatch.rating_deviation = ratingUpdate.after.ratingDeviation;
        profilePatch.rating_volatility = ratingUpdate.after.ratingVolatility;
        profilePatch.rating_updated_at = new Date().toISOString();
      }
      profileRows.push({
        ...profilePatch,
        notification: {
          result,
          ranked: Boolean(ratingUpdate),
          ratingBefore,
          ratingAfter,
          xp: nextXp,
        },
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
      bot_count: botCount,
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
    const notification = row.notification;
    delete row.notification;
    await supabaseFetch(restUrl("profiles", `id=eq.${encodeURIComponent(row.id)}`), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
    if (notification?.ranked) {
      try {
        const social = require("./social-service");
        await social.createNotification(
          row.id,
          "ranked_finished",
          notification.result === "win" ? "Vitória ranqueada" : "Partida ranqueada finalizada",
          `Rating ${notification.ratingBefore} -> ${notification.ratingAfter}.`,
          { matchId: match.id, ratingBefore: notification.ratingBefore, ratingAfter: notification.ratingAfter }
        );
      } catch (error) {
        console.warn("[notifications] ranked notification failed", error.message);
      }
    }
  }

  return true;
}

function avatarPathFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${SUPABASE_AVATAR_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return "";
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return "";
  }
}

async function storageObjectPathsForProfile(profileId, profile = null) {
  const paths = new Set();
  const avatarPath = avatarPathFromUrl(profile?.avatarUrl);
  if (avatarPath) paths.add(avatarPath);

  try {
    const rows = await supabaseFetch(storageUrl(`object/list/${encodeURIComponent(SUPABASE_AVATAR_BUCKET)}`), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        prefix: `${profileId}/`,
        limit: 1000,
        offset: 0,
      }),
    });
    for (const row of rows || []) {
      if (!row?.name) continue;
      const name = String(row.name);
      paths.add(name.startsWith(`${profileId}/`) ? name : `${profileId}/${name}`);
    }
  } catch {}

  return Array.from(paths);
}

async function deleteStorageObjects(paths) {
  if (!paths.length) return;
  await supabaseFetch(storageUrl(`object/${encodeURIComponent(SUPABASE_AVATAR_BUCKET)}`), {
    method: "DELETE",
    headers: serviceHeaders(),
    body: JSON.stringify({ prefixes: paths }),
  });
}

function sanitizeDeletedPlayerRows(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    player_name: "Conta excluída",
    profile_id: null,
  }));
}

function sanitizeFinalSnapshot(snapshot, seats = [], names = []) {
  if (!snapshot || typeof snapshot !== "object") return snapshot || {};
  const copy = JSON.parse(JSON.stringify(snapshot));
  const seatSet = new Set(seats.map(Number));
  if (Array.isArray(copy.players)) {
    for (const player of copy.players) {
      if (seatSet.has(Number(player.seat))) {
        player.name = "Conta excluída";
        delete player.supabaseUserId;
        delete player.profileId;
      }
    }
  }
  if (Array.isArray(copy.log)) {
    const namesToReplace = names.filter(Boolean).map(String);
    for (const entry of copy.log) {
      if (!entry || typeof entry.text !== "string") continue;
      for (const name of namesToReplace) {
        entry.text = entry.text.split(name).join("Conta excluída");
      }
    }
  }
  return copy;
}

async function anonymizeAccountData(profileId) {
  const rows = await supabaseFetch(restUrl(
    "match_players",
    `profile_id=eq.${encodeURIComponent(profileId)}&select=id,match_id,seat,player_name`
  ), {
    headers: serviceHeaders(),
  });
  const playerRows = sanitizeDeletedPlayerRows(rows);
  for (const row of playerRows) {
    await supabaseFetch(restUrl("match_players", `id=eq.${encodeURIComponent(row.id)}`), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        player_name: row.player_name,
        profile_id: row.profile_id,
      }),
    });
  }

  const matchIds = [...new Set((rows || []).map((row) => row.match_id).filter(Boolean))];
  for (const matchId of matchIds) {
    const seats = (rows || [])
      .filter((row) => row.match_id === matchId)
      .map((row) => row.seat);
    const names = (rows || [])
      .filter((row) => row.match_id === matchId)
      .map((row) => row.player_name);
    const matches = await supabaseFetch(restUrl(
      "matches",
      `id=eq.${encodeURIComponent(matchId)}&select=id,winner_profile_id,final_snapshot`
    ), {
      headers: serviceHeaders(),
    });
    const match = matches?.[0];
    if (!match) continue;
    const patch = {
      final_snapshot: sanitizeFinalSnapshot(match.final_snapshot, seats, names),
    };
    if (match.winner_profile_id === profileId) patch.winner_profile_id = null;
    await supabaseFetch(restUrl("matches", `id=eq.${encodeURIComponent(matchId)}`), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
  }
}

async function deleteAuthUser(profileId) {
  await supabaseFetch(authUrl(`admin/users/${encodeURIComponent(profileId)}`), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
}

async function deleteAccount(profileId) {
  if (!isConfigured() || !profileId) return false;
  const profile = await getProfile(profileId);
  await anonymizeAccountData(profileId);
  try {
    await deleteStorageObjects(await storageObjectPathsForProfile(profileId, profile));
  } catch (error) {
    console.warn("[persistence] avatar cleanup failed", error.message);
  }
  await deleteAuthUser(profileId);
  await supabaseFetch(restUrl("profiles", `id=eq.${encodeURIComponent(profileId)}`), {
    method: "DELETE",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
  });
  return true;
}

module.exports = {
  isConfigured,
  restUrl,
  storageUrl,
  serviceHeaders,
  supabaseFetch,
  verifyAccessToken,
  ensureProfileFromUser,
  getProfileBundle,
  getProfile,
  updateProfile,
  healthStatus,
  deleteAccount,
  persistFinishedMatch,
};
