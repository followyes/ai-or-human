export const STREAK_MILESTONES = Object.freeze([3, 10]);

/** Counts consecutive correct answers within a single game session. */
export function advanceAnswerStreak(streak, outcome) {
  if (!Number.isInteger(streak) || streak < 0) throw new RangeError("streak must be a non-negative integer");
  const next = outcome === "correct" ? streak + 1 : 0;
  return Object.freeze({ streak: next, milestone: STREAK_MILESTONES.includes(next) ? next : null });
}
