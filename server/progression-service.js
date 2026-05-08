const BASE_XP = 40;
const WIN_XP = 35;
const RANKED_XP = 20;
const STREAK_XP = 10;
const FULL_TABLE_XP = 20;

function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1;
}

function xpForLevel(level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  return Math.pow(safeLevel - 1, 2) * 100;
}

function progressForXp(xp) {
  const currentXp = Math.max(0, Number(xp) || 0);
  const level = levelForXp(currentXp);
  const start = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const progress = next > start ? (currentXp - start) / (next - start) : 0;
  return {
    xp: currentXp,
    level,
    currentLevelXp: start,
    nextLevelXp: next,
    progress: Math.max(0, Math.min(1, progress)),
  };
}

function xpAwardForMatch(match, result, isRankedEligible, currentStreak = 0) {
  let xp = BASE_XP;
  if (result === "win") xp += WIN_XP;
  if (isRankedEligible) xp += RANKED_XP;
  if (result === "win" && currentStreak >= 2) xp += STREAK_XP;
  if ((match.players || []).length >= 4) xp += FULL_TABLE_XP;
  return xp;
}

module.exports = {
  levelForXp,
  progressForXp,
  xpAwardForMatch,
  xpForLevel,
};
