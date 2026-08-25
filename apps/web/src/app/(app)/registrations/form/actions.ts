"use server";

/**
 * The registration form builder's four writes.
 *
 * Everything goes through the caller's own client. `registration_questions`
 * has an admin-only insert/update policy and a guard trigger that refuses to
 * let a built-in question change its key or type, or a locked one (photo
 * permissions, GDPR, terms) be archived or made optional. None of that is
 * re-implemented here: the messages below are the database's, shown as it
 * wrote them, and the screen simply hides the controls it knows will be
 * refused so an administrator is not invited to try.
 *
 * Reordering is one RPC with the WHOLE list, not a swap: `set_registration_question_order`
 * renumbers 1..n, so two questions can never end up sharing a position and a
 * half-applied drag cannot leave the form in an order nobody chose.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isValidQuestionKey, slugifyQuestionKey } from "@/lib/registration-questions";

const PATH = "/registrations/form";

export type BuilderState = { error?: string; notice?: string };

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** The database's own words where it has any; a plain sentence where it does not. */
function refusal(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === "P0001") return error.message;
  if (error.code === "42501") return fallback;
  if (error.code === "23505") return "There is already a question with that key.";
  return error.message;
}

export async function saveQuestionOrder(
  _prev: BuilderState,
  formData: FormData,
): Promise<BuilderState> {
  const ids = formData
    .getAll("question_id")
    .map((value) => String(value))
    .filter(Boolean);
  if (ids.length === 0) return { error: "Nothing to reorder." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_registration_question_order", { p_ids: ids });
  if (error) {
    return { error: refusal(error, "Only a club administrator can change the registration form.") };
  }

  revalidatePath(PATH);
  return { notice: "Saved — that is the order families will see." };
}

export async function updateQuestion(
  _prev: BuilderState,
  formData: FormData,
): Promise<BuilderState> {
  const id = text(formData, "question_id");
  const label = text(formData, "label");
  const help = text(formData, "help_text");
  const required = formData.get("required") === "yes";
  const options = text(formData, "options")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!id) return { error: "Missing the question." };
  if (!label) return { error: "A question needs a label." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registration_questions")
    .update({
      label,
      help_text: help || null,
      required,
      options,
    })
    .eq("id", id)
    .select("id");

  if (error) {
    return { error: refusal(error, "Only a club administrator can change the registration form.") };
  }
  if ((data ?? []).length === 0) {
    return { error: "Only a club administrator can change the registration form." };
  }

  revalidatePath(PATH);
  return { notice: `“${label}” saved.` };
}

export async function setQuestionArchived(
  _prev: BuilderState,
  formData: FormData,
): Promise<BuilderState> {
  const id = text(formData, "question_id");
  const archived = formData.get("archived") === "yes";
  if (!id) return { error: "Missing the question." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registration_questions")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");

  if (error) {
    return { error: refusal(error, "Only a club administrator can change the registration form.") };
  }
  if ((data ?? []).length === 0) {
    return { error: "Only a club administrator can change the registration form." };
  }

  revalidatePath(PATH);
  return { notice: archived ? "Question retired." : "Question put back on the form." };
}

export async function addQuestion(
  _prev: BuilderState,
  formData: FormData,
): Promise<BuilderState> {
  const label = text(formData, "label");
  const qtype = text(formData, "qtype");
  const help = text(formData, "help_text");
  const required = formData.get("required") === "yes";
  const options = text(formData, "options")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!label) return { error: "Give the question a label." };
  if (!qtype) return { error: "Choose what sort of answer you want." };
  if (qtype === "select" && options.length === 0) {
    return { error: "A “choose one” question needs at least one option." };
  }

  const qkey = slugifyQuestionKey(label);
  if (!isValidQuestionKey(qkey)) {
    return { error: "That label does not make a usable key — try wording it with some letters." };
  }

  const supabase = await createClient();

  // New questions go on the end. The order is then whatever the administrator
  // drags it to; nothing here guesses where it belongs.
  const { data: last } = await supabase
    .from("registration_questions")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("registration_questions").insert({
    qkey,
    label,
    help_text: help || null,
    qtype,
    options,
    required,
    position: (last?.position ?? 0) + 1,
  });

  if (error) {
    return { error: refusal(error, "Only a club administrator can add a question.") };
  }

  revalidatePath(PATH);
  return { notice: `“${label}” added to the end of the form.` };
}
