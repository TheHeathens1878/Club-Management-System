"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile, isBarManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireBarManager() {
  const session = await getSessionProfile();
  if (!session || !isBarManager(session.profile?.role)) throw new Error("Not authorised");
  return session;
}

export async function saveFaq(id: string | null, question: string, answer: string): Promise<{ error?: string }> {
  await requireBarManager();
  const admin = createAdminClient();
  const q = question.trim();
  const a = answer.trim();
  if (!q || !a) return { error: "Question and answer are required." };

  if (id) {
    const { error } = await admin.from("faqs").update({ question: q, answer: a }).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { data: last } = await admin.from("faqs").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const nextSort = ((last?.[0]?.sort_order as number) ?? 0) + 10;
    const { error } = await admin.from("faqs").insert({ question: q, answer: a, sort_order: nextSort, active: true });
    if (error) return { error: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/bar");
  revalidatePath("/book");
  return {};
}

export async function deleteFaq(id: string): Promise<{ error?: string }> {
  await requireBarManager();
  const admin = createAdminClient();
  const { error } = await admin.from("faqs").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/bar");
  revalidatePath("/book");
  return {};
}
