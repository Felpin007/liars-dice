const state = require("./state");
const {
  CLIENT_TTL_MS,
  IS_VERCEL,
  MATCH_TTL_MS,
  NODE_ENV,
  ROOM_TTL_MS,
  SESSION_TTL_MS,
} = require("./config");
const persistence = require("./persistence-service");

const TABLES = {
  sessions: "sessions",
  presence: "presence",
  rooms: "rooms",
  queue: "queue_entries",
  matches: "active_matches",
  reports: "reports",
};
let dirty = false;

function isEnabled() {
  return Boolean((IS_VERCEL || process.env.LDA_RUNTIME_STATE === "supabase") && persistence.isConfigured());
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function fromIso(value, fallback = Date.now()) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : fallback;
}

function clearRuntimeMemory() {
  state.clients.clear();
  state.rooms.clear();
  state.queue = [];
  state.matches.clear();
  state.sessions.clear();
}

async function readTable(table, query) {
  return persistence.supabaseFetch(persistence.restUrl(table, query), {
    headers: persistence.serviceHeaders(),
  }) || [];
}

async function hydrateState() {
  if (!isEnabled()) return false;
  dirty = false;
  const now = Date.now();
  clearRuntimeMemory();

  const [sessions, presence, rooms, queueEntries, matches] = await Promise.all([
    readTable(TABLES.sessions, `expires_at=gt.${encodeURIComponent(toIso(now))}&select=*`),
    readTable(TABLES.presence, `last_seen_at=gt.${encodeURIComponent(toIso(now - CLIENT_TTL_MS))}&select=*`),
    readTable(TABLES.rooms, `expires_at=gt.${encodeURIComponent(toIso(now))}&select=*`),
    readTable(TABLES.queue, "select=*"),
    readTable(TABLES.matches, `expires_at=gt.${encodeURIComponent(toIso(now))}&select=*`),
  ]);

  for (const row of presence) {
    state.clients.set(row.client_id, {
      id: row.client_id,
      username: row.username,
      displayName: row.display_name || "",
      avatarUrl: row.avatar_url || "",
      supabaseUserId: row.supabase_user_id || null,
      rating: row.data?.rating || 1500,
      ratingDeviation: row.data?.ratingDeviation || 350,
      level: row.data?.level || 1,
      xp: row.data?.xp || 0,
      lastSeenAt: fromIso(row.last_seen_at, now),
      streams: new Set(),
      currentRoomCode: row.current_room_code || null,
      queueEntryId: row.queue_entry_id || null,
      activeMatchId: row.active_match_id || null,
      notifications: row.data?.notifications || [],
    });
  }

  for (const row of sessions) {
    state.sessions.set(row.id, {
      id: row.id,
      clientId: row.client_id,
      csrfToken: row.csrf_token,
      createdAt: fromIso(row.created_at, now),
      lastSeenAt: fromIso(row.updated_at, now),
      expiresAt: fromIso(row.expires_at, now + SESSION_TTL_MS),
    });
  }

  for (const row of rooms) {
    if (row.data?.code) state.rooms.set(row.code, row.data);
  }
  state.queue = queueEntries.map((row) => row.data).filter(Boolean);
  for (const row of matches) {
    if (row.data?.id) state.matches.set(row.id, row.data);
  }
  return true;
}

function markDirty() {
  dirty = true;
}

function isDirty() {
  return dirty;
}

function rowsForState() {
  const now = Date.now();
  const sessions = Array.from(state.sessions.values()).map((session) => ({
    id: session.id,
    client_id: session.clientId,
    csrf_token: session.csrfToken,
    data: {},
    created_at: toIso(session.createdAt || now),
    updated_at: toIso(session.lastSeenAt || now),
    expires_at: toIso(session.expiresAt || now + SESSION_TTL_MS),
  }));
  const presence = Array.from(state.clients.values()).map((client) => ({
    client_id: client.id,
    username: client.username,
    display_name: client.displayName || "",
    avatar_url: client.avatarUrl || "",
    supabase_user_id: client.supabaseUserId || null,
    current_room_code: client.currentRoomCode || null,
    queue_entry_id: client.queueEntryId || null,
    active_match_id: client.activeMatchId || null,
    last_seen_at: toIso(client.lastSeenAt || now),
    data: {
      notifications: client.notifications || [],
      rating: client.rating || 1500,
      ratingDeviation: client.ratingDeviation || 350,
      level: client.level || 1,
      xp: client.xp || 0,
    },
  }));
  const rooms = Array.from(state.rooms.values()).map((room) => ({
    code: room.code,
    visibility: room.visibility,
    status: room.status,
    data: room,
    updated_at: toIso(room.updatedAt || now),
    expires_at: toIso((room.updatedAt || room.createdAt || now) + ROOM_TTL_MS),
  }));
  const queue = state.queue.map((entry) => ({
    id: entry.id,
    client_id: entry.clientId,
    mode_key: entry.modeKey,
    data: entry,
    joined_at: toIso(entry.joinedAt || now),
  }));
  const matches = Array.from(state.matches.values()).map((match) => ({
    id: match.id,
    phase: match.phase,
    data: match,
    updated_at: toIso(match.updatedAt || now),
    expires_at: toIso((match.createdAt || now) + MATCH_TTL_MS),
    persisted_at: match.persistedAt ? toIso(match.persistedAt) : null,
  }));
  return { sessions, presence, rooms, queue, matches };
}

async function replaceTable(table, rows, conflictTarget, deleteQuery) {
  await persistence.supabaseFetch(persistence.restUrl(table, deleteQuery), {
    method: "DELETE",
    headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
  });
  if (!rows.length) return;
  await persistence.supabaseFetch(persistence.restUrl(table, `on_conflict=${conflictTarget}`), {
    method: "POST",
    headers: persistence.serviceHeaders({
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rows),
  });
}

async function persistState() {
  if (!isEnabled()) return false;
  dirty = false;
  const rows = rowsForState();
  await Promise.all([
    replaceTable(TABLES.sessions, rows.sessions, "id", "id=not.is.null"),
    replaceTable(TABLES.presence, rows.presence, "client_id", "client_id=not.is.null"),
    replaceTable(TABLES.rooms, rows.rooms, "code", "code=not.is.null"),
    replaceTable(TABLES.queue, rows.queue, "id", "id=not.is.null"),
    replaceTable(TABLES.matches, rows.matches, "id", "id=not.is.null"),
  ]);
  return true;
}

async function cleanupRuntimeTables() {
  if (!isEnabled()) return { enabled: false };
  const now = toIso(Date.now());
  const stalePresence = toIso(Date.now() - CLIENT_TTL_MS);
  const deletions = [
    persistence.supabaseFetch(persistence.restUrl(TABLES.sessions, `expires_at=lt.${encodeURIComponent(now)}`), {
      method: "DELETE",
      headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
    }),
    persistence.supabaseFetch(persistence.restUrl(TABLES.presence, `last_seen_at=lt.${encodeURIComponent(stalePresence)}`), {
      method: "DELETE",
      headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
    }),
    persistence.supabaseFetch(persistence.restUrl(TABLES.rooms, `expires_at=lt.${encodeURIComponent(now)}`), {
      method: "DELETE",
      headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
    }),
    persistence.supabaseFetch(persistence.restUrl(TABLES.matches, `expires_at=lt.${encodeURIComponent(now)}`), {
      method: "DELETE",
      headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
    }),
  ];
  await Promise.all(deletions);
  return { enabled: true, cleanedAt: new Date().toISOString() };
}

async function createReport(report) {
  if (!isEnabled()) {
    state.auditLog.push({ at: new Date().toISOString(), type: "report", ...report });
    return { stored: false };
  }
  await persistence.supabaseFetch(persistence.restUrl(TABLES.reports), {
    method: "POST",
    headers: persistence.serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify([{
      reporter_client_id: report.reporterClientId,
      reporter_profile_id: report.reporterProfileId || null,
      target_username: report.targetUsername,
      target_client_id: report.targetClientId || null,
      match_id: report.matchId || null,
      reason: report.reason,
      details: report.details || "",
    }]),
  });
  return { stored: true };
}

async function tableExists(table) {
  try {
    await readTable(table, "select=*&limit=1");
    return true;
  } catch {
    return false;
  }
}

async function healthStatus() {
  const configured = persistence.isConfigured();
  const enabled = isEnabled();
  const runtimeTables = {};
  if (configured) {
    const tableNames = Object.values(TABLES);
    const checks = await Promise.all(tableNames.map((table) => tableExists(table)));
    tableNames.forEach((table, index) => {
      runtimeTables[table] = checks[index];
    });
  }
  const productionReady = NODE_ENV === "production"
    ? configured && Object.values(runtimeTables).every(Boolean) && Boolean(process.env.SESSION_SECRET)
    : configured ? Object.values(runtimeTables).every(Boolean) : false;
  return {
    enabled,
    runtime: IS_VERCEL ? "vercel" : "node",
    tables: runtimeTables,
    productionReady,
  };
}

module.exports = {
  isEnabled,
  markDirty,
  isDirty,
  hydrateState,
  persistState,
  cleanupRuntimeTables,
  createReport,
  healthStatus,
};
