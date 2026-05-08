const state = require("./state");
const { randomId } = require("./utils");
const persistence = require("./persistence-service");

const FRIEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function useMemory() {
  return process.env.LDA_FORCE_MEMORY_SOCIAL === "1" || !persistence.isConfigured();
}

function nowIso() {
  return new Date().toISOString();
}

function pairKey(left, right) {
  return [left, right].sort().join("|");
}

function normalizeNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body || "",
    data: row.data || {},
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

function normalizeRequest(row) {
  return {
    id: row.id,
    requesterProfileId: row.requester_profile_id,
    targetProfileId: row.target_profile_id,
    requesterUsername: row.requester_username,
    targetUsername: row.target_username,
    status: row.status,
    cooldownUntil: row.cooldown_until || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeFriendship(row, selfProfileId) {
  const other = row.user_a_profile_id === selfProfileId ? "b" : "a";
  return {
    profileId: row[`user_${other}_profile_id`],
    username: row[`user_${other}_username`],
    createdAt: row.created_at,
  };
}

async function findProfileByUsername(username) {
  const rows = await persistence.supabaseFetch(persistence.restUrl(
    "profiles",
    `username=eq.${encodeURIComponent(username)}&select=id,username,display_name,avatar_url,rating,xp,level&limit=1`
  ), { headers: persistence.serviceHeaders() });
  return rows?.[0] || null;
}

async function createNotification(profileId, type, title, body = "", data = {}) {
  if (!profileId) return null;
  if (useMemory()) {
    const notification = {
      id: randomId("n_"),
      profile_id: profileId,
      type,
      title,
      body,
      data,
      read_at: null,
      created_at: nowIso(),
    };
    state.notifications.set(notification.id, notification);
    return normalizeNotification(notification);
  }
  const rows = await persistence.supabaseFetch(persistence.restUrl("notifications"), {
    method: "POST",
    headers: persistence.serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify([{
      profile_id: profileId,
      type,
      title,
      body,
      data,
    }]),
  });
  return normalizeNotification(rows?.[0]);
}

async function listNotifications(profileId) {
  if (useMemory()) {
    return Array.from(state.notifications.values())
      .filter((row) => row.profile_id === profileId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(normalizeNotification);
  }
  const rows = await persistence.supabaseFetch(persistence.restUrl(
    "notifications",
    `profile_id=eq.${encodeURIComponent(profileId)}&select=*&order=created_at.desc&limit=50`
  ), { headers: persistence.serviceHeaders() });
  return (rows || []).map(normalizeNotification);
}

async function markNotificationRead(profileId, id) {
  if (useMemory()) {
    const row = state.notifications.get(id);
    if (row && row.profile_id === profileId) row.read_at = nowIso();
    return true;
  }
  await persistence.supabaseFetch(persistence.restUrl(
    "notifications",
    `id=eq.${encodeURIComponent(id)}&profile_id=eq.${encodeURIComponent(profileId)}`
  ), {
    method: "PATCH",
    headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ read_at: nowIso() }),
  });
  return true;
}

async function markAllNotificationsRead(profileId) {
  if (useMemory()) {
    for (const row of state.notifications.values()) {
      if (row.profile_id === profileId) row.read_at = row.read_at || nowIso();
    }
    return true;
  }
  await persistence.supabaseFetch(persistence.restUrl(
    "notifications",
    `profile_id=eq.${encodeURIComponent(profileId)}&read_at=is.null`
  ), {
    method: "PATCH",
    headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ read_at: nowIso() }),
  });
  return true;
}

async function memoryProfile(username) {
  const client = Array.from(state.clients.values()).find((item) => item.username === username || item.supabaseUserId === username);
  if (!client?.supabaseUserId) return null;
  return { id: client.supabaseUserId, username: client.username };
}

async function sendFriendRequest(requesterProfile, targetUsername) {
  if (!requesterProfile?.id) return { error: "login_required" };
  const target = useMemory() ? await memoryProfile(targetUsername) : await findProfileByUsername(targetUsername);
  if (!target) return { error: "profile_not_found" };
  if (target.id === requesterProfile.id) return { error: "friend_self" };

  const key = pairKey(requesterProfile.id, target.id);
  const now = Date.now();
  if (useMemory()) {
    if (state.friendships.has(key)) return { error: "already_friends" };
    const existing = Array.from(state.friendRequests.values()).find((row) => row.pair_key === key && row.status !== "accepted");
    if (existing?.status === "pending") return { error: "request_pending" };
    if (existing?.status === "declined" && Date.parse(existing.cooldown_until || "") > now) return { error: "friend_cooldown" };
    const request = {
      id: randomId("fr_"),
      pair_key: key,
      requester_profile_id: requesterProfile.id,
      target_profile_id: target.id,
      requester_username: requesterProfile.username,
      target_username: target.username,
      status: "pending",
      cooldown_until: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    state.friendRequests.set(request.id, request);
    await createNotification(target.id, "friend_request", "Novo pedido de amizade", `${requesterProfile.username} quer adicionar você.`, { requestId: request.id });
    return { request: normalizeRequest(request) };
  }

  const existingFriend = await persistence.supabaseFetch(persistence.restUrl(
    "friendships",
    `pair_key=eq.${encodeURIComponent(key)}&select=pair_key&limit=1`
  ), { headers: persistence.serviceHeaders() });
  if (existingFriend?.length) return { error: "already_friends" };

  const existing = await persistence.supabaseFetch(persistence.restUrl(
    "friend_requests",
    `pair_key=eq.${encodeURIComponent(key)}&status=neq.accepted&select=*&order=created_at.desc&limit=1`
  ), { headers: persistence.serviceHeaders() });
  const latest = existing?.[0];
  if (latest?.status === "pending") return { error: "request_pending" };
  if (latest?.status === "declined" && Date.parse(latest.cooldown_until || "") > now) return { error: "friend_cooldown" };

  const rows = await persistence.supabaseFetch(persistence.restUrl("friend_requests"), {
    method: "POST",
    headers: persistence.serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify([{
      pair_key: key,
      requester_profile_id: requesterProfile.id,
      target_profile_id: target.id,
      requester_username: requesterProfile.username,
      target_username: target.username,
      status: "pending",
    }]),
  });
  const request = normalizeRequest(rows?.[0]);
  await createNotification(target.id, "friend_request", "Novo pedido de amizade", `${requesterProfile.username} quer adicionar você.`, { requestId: request.id });
  return { request };
}

async function respondFriendRequest(profile, requestId, response) {
  const accepted = response === "accept";
  if (useMemory()) {
    const row = state.friendRequests.get(requestId);
    if (!row || row.target_profile_id !== profile.id || row.status !== "pending") return { error: "request_not_found" };
    row.status = accepted ? "accepted" : "declined";
    row.cooldown_until = accepted ? null : new Date(Date.now() + FRIEND_COOLDOWN_MS).toISOString();
    row.updated_at = nowIso();
    if (accepted) {
      state.friendships.set(row.pair_key, {
        pair_key: row.pair_key,
        user_a_profile_id: [row.requester_profile_id, row.target_profile_id].sort()[0],
        user_b_profile_id: [row.requester_profile_id, row.target_profile_id].sort()[1],
        user_a_username: row.requester_profile_id < row.target_profile_id ? row.requester_username : row.target_username,
        user_b_username: row.requester_profile_id < row.target_profile_id ? row.target_username : row.requester_username,
        created_at: nowIso(),
      });
    }
    await createNotification(row.requester_profile_id, accepted ? "friend_accepted" : "friend_declined", accepted ? "Pedido aceito" : "Pedido recusado", `${profile.username} ${accepted ? "aceitou" : "recusou"} seu pedido.`, { requestId });
    return { request: normalizeRequest(row) };
  }

  const rows = await persistence.supabaseFetch(persistence.restUrl(
    "friend_requests",
    `id=eq.${encodeURIComponent(requestId)}&target_profile_id=eq.${encodeURIComponent(profile.id)}&status=eq.pending&select=*`
  ), { headers: persistence.serviceHeaders() });
  const row = rows?.[0];
  if (!row) return { error: "request_not_found" };
  const patch = {
    status: accepted ? "accepted" : "declined",
    cooldown_until: accepted ? null : new Date(Date.now() + FRIEND_COOLDOWN_MS).toISOString(),
    updated_at: nowIso(),
    responded_at: nowIso(),
  };
  const updated = await persistence.supabaseFetch(persistence.restUrl("friend_requests", `id=eq.${encodeURIComponent(requestId)}`), {
    method: "PATCH",
    headers: persistence.serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (accepted) {
    const ids = [row.requester_profile_id, row.target_profile_id].sort();
    const names = row.requester_profile_id === ids[0]
      ? [row.requester_username, row.target_username]
      : [row.target_username, row.requester_username];
    await persistence.supabaseFetch(persistence.restUrl("friendships", "on_conflict=pair_key"), {
      method: "POST",
      headers: persistence.serviceHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify([{
        pair_key: row.pair_key,
        user_a_profile_id: ids[0],
        user_b_profile_id: ids[1],
        user_a_username: names[0],
        user_b_username: names[1],
      }]),
    });
  }
  await createNotification(row.requester_profile_id, accepted ? "friend_accepted" : "friend_declined", accepted ? "Pedido aceito" : "Pedido recusado", `${profile.username} ${accepted ? "aceitou" : "recusou"} seu pedido.`, { requestId });
  return { request: normalizeRequest(updated?.[0]) };
}

async function listFriends(profileId) {
  if (useMemory()) {
    const friends = Array.from(state.friendships.values())
      .filter((row) => row.user_a_profile_id === profileId || row.user_b_profile_id === profileId)
      .map((row) => normalizeFriendship(row, profileId));
    const requests = Array.from(state.friendRequests.values())
      .filter((row) => row.requester_profile_id === profileId || row.target_profile_id === profileId)
      .map(normalizeRequest);
    return { friends, requests };
  }
  const [friendRows, requestRows] = await Promise.all([
    persistence.supabaseFetch(persistence.restUrl(
      "friendships",
      `or=(user_a_profile_id.eq.${encodeURIComponent(profileId)},user_b_profile_id.eq.${encodeURIComponent(profileId)})&select=*&order=created_at.desc`
    ), { headers: persistence.serviceHeaders() }),
    persistence.supabaseFetch(persistence.restUrl(
      "friend_requests",
      `or=(requester_profile_id.eq.${encodeURIComponent(profileId)},target_profile_id.eq.${encodeURIComponent(profileId)})&select=*&order=created_at.desc&limit=50`
    ), { headers: persistence.serviceHeaders() }),
  ]);
  return {
    friends: (friendRows || []).map((row) => normalizeFriendship(row, profileId)),
    requests: (requestRows || []).map(normalizeRequest),
  };
}

async function removeFriend(profileId, otherProfileId) {
  const key = pairKey(profileId, otherProfileId);
  if (useMemory()) {
    state.friendships.delete(key);
    return true;
  }
  await persistence.supabaseFetch(persistence.restUrl("friendships", `pair_key=eq.${encodeURIComponent(key)}`), {
    method: "DELETE",
    headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
  });
  return true;
}

module.exports = {
  FRIEND_COOLDOWN_MS,
  createNotification,
  listFriends,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
};
