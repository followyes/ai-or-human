/** Consecutive correct answers; only explicit achievements trigger a reward. */
export function isStreakMilestone(streak) {
  return streak === 3 || (streak >= 10 && streak % 10 === 0);
}
export function advanceAnswerStreak(streak, outcome) {
  if (!Number.isInteger(streak) || streak < 0) throw new RangeError("streak must be a non-negative integer");
  const next = outcome === "correct" ? streak + 1 : 0;
  return Object.freeze({ streak: next, milestone: isStreakMilestone(next) ? next : null });
}
