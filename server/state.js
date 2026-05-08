module.exports = {
  clients: new Map(),
  rooms: new Map(),
  queue: [],
  matches: new Map(),
  matchTimers: new Map(),
  rateLimits: new Map(),
  sessions: new Map(),
  friendRequests: new Map(),
  friendships: new Map(),
  notifications: new Map(),
  auditLog: [],
};
