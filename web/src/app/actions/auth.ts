"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth";
import type { ActionState } from "@/components/forms";

export async function registrationMode(): Promise<"closed"> { return "closed"; }

// Keep these exports so older browser tabs cannot reach a legacy password path.
export async function register(_state: ActionState, _form: FormData): Promise<ActionState> {
  return { error: "Request an account by emailing gabriel.klier@ufl.edu." };
}
export async function login(_state: ActionState, _form: FormData): Promise<ActionState> {
  return { error: "Use your passkey to sign in." };
}
export async function logout() {
  await destroySession();
  redirect("/login");
}
