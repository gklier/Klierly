"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { moveStudy, startStudy, studyView } from "@/lib/study/service";
import type { ActionState } from "@/components/forms";
const uuid = z.string().uuid();
const moveSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("reveal") }), z.object({ kind: z.literal("next") }),
  z.object({ kind: z.literal("answer"), choice: z.number().int().min(0).max(3).optional(), value: z.string().max(40).optional(), rating: z.enum(["again", "remembered"]).optional() })]);
export async function startStudyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z.object({ courseId: uuid, mode: z.enum(["mix", "cards"]), count: z.coerce.number().int().min(1).max(6), topicIds: z.array(uuid).max(400), moduleIds: z.array(uuid).max(100) }).safeParse({ courseId: fd.get("courseId"), mode: fd.get("mode"), count: fd.get("count"), topicIds: fd.getAll("topicIds"), moduleIds: fd.getAll("moduleIds") });
  if (!parsed.success) return { error: "Choose a course, a study mode and a round length." };
  if (!rateLimit(`study-start:${user.id}`, 30, 3600_000).ok) return { error: "Many rounds started recently. Resume a saved round, or try again later." };
  const { courseId, mode, count, topicIds, moduleIds } = parsed.data;
  const result = await startStudy(user.id, courseId, mode, count, topicIds, moduleIds);
  if (result.error) return { error: result.error };
  redirect(`/courses/${courseId}/study/${result.id}`);
}
export async function studyMoveAction(sessionId: string, taskKey: string, input: unknown) {
  const user = await requireUser();
  const move = moveSchema.safeParse(input);
  if (!uuid.safeParse(sessionId).success || typeof taskKey !== "string" || taskKey.length > 180 || !move.success) return { error: "Invalid study request." };
  if (!rateLimit(`study-turn:${user.id}`, 180, 60_000).ok) return { error: "Too many requests. Wait a moment and try again." };
  const result = await moveStudy(user.id, sessionId, taskKey, move.data);
  if (!result.ok) return { error: result.message ?? "That could not be saved." };
  const view = await studyView(user.id, sessionId);
  return view ? { view } : { error: "This round is no longer available." };
}
