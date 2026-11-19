/** Study review is separate from exam grades: free recall is honestly self-assessed. */
export const ANGLES = ["recall", "identify", "explain", "apply"] as const;
export type StudyAngle = typeof ANGLES[number];
export type StudyMode = "mix" | "cards";
export type StudyTask = { key: string; topicId: string; angle: StudyAngle; questionId?: string; repeat: boolean };
export type StudyOutcome = { key: string; topicId: string; angle: StudyAngle; correct: boolean; selfRated: boolean };
export type StudyState = { scopeTopicIds?: string[]; queue: StudyTask[]; position: number; revealed: boolean; outcomes: StudyOutcome[] };
export type StudyCandidate = { id: string; questionIds: string[] };

export function shuffle<T>(values: T[], rng: () => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function buildStudyState(topics: StudyCandidate[], mode: StudyMode, rng: () => number): StudyState {
  const selected = shuffle(topics, rng);
  const angles: StudyAngle[] = mode === "cards" ? ["recall", "explain"] : [...ANGLES];
  const queue: StudyTask[] = [];
  // Interleave concepts so the reverse prompt doesn't immediately disclose itself.
  for (const angle of angles) for (const topic of selected) {
    if (angle === "apply" && !topic.questionIds.length) continue;
    queue.push({ key: `${topic.id}:${angle}:${queue.length}`, topicId: topic.id, angle,
      ...(angle === "apply" ? { questionId: shuffle(topic.questionIds, rng)[0] } : {}), repeat: false });
  }
  return { queue, position: 0, revealed: false, outcomes: [] };
}

/** At most four extra turns; never ask for the same wording immediately again. */
export function addReviewTurn(state: StudyState, task: StudyTask, topic: StudyCandidate): StudyTask[] {
  if (task.repeat || state.queue.filter((t) => t.repeat).length >= 4 || state.queue.length - state.position < 3) return state.queue;
  let angle: StudyAngle = task.angle === "recall" ? "explain" : task.angle === "identify" ? "recall" : task.angle === "explain" ? "identify" : "apply";
  const alternative = topic.questionIds.find((id) => id !== task.questionId);
  if (angle === "apply" && !alternative) angle = "explain";
  return [...state.queue, { key: `${task.key}:review`, topicId: task.topicId, angle, repeat: true,
    ...(angle === "apply" ? { questionId: alternative } : {}) }];
}

export function angleCoverage(outcomes: StudyOutcome[]): Map<string, Set<StudyAngle>> {
  const result = new Map<string, Set<StudyAngle>>();
  for (const o of outcomes) {
    if (!result.has(o.topicId)) result.set(o.topicId, new Set());
    if (o.correct) result.get(o.topicId)!.add(o.angle);
    else result.get(o.topicId)!.delete(o.angle);
  }
  return result;
}

export function stableSeed(key: string): number {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function topicsNeedingReview(outcomes: StudyOutcome[]): Set<string> {
  const latest = new Map<string, StudyOutcome>();
  for (const o of outcomes) latest.set(o.topicId + ":" + o.angle, o);
  return new Set([...latest.values()].filter(o => !o.correct).map(o => o.topicId));
}
