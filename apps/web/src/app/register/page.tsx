import { redirect } from "next/navigation";

/**
 * `/register` — kept as a doorway, no longer a door.
 *
 * This was "just create an account": the Neon app's self-registration form,
 * rebuilt for gap 4. Adam retired it on 2026-09-01 when joining became four
 * steps, because the account is now the FIRST of those steps and this page
 * asked a subset of the same questions with none of the context — a person
 * arrived, got a login, and the club learned nothing about who they were or
 * who they were bringing.
 *
 * The route survives because links do: the address is in old emails, in
 * browsers' histories and on at least one printed sheet. It sends them where
 * the form went rather than showing them a 404 and letting them give up.
 *
 * `?as=referee` needs no special handling — refereeing is a tick on the first
 * step of the wizard now (20260901160000 closed the side door in the database
 * at the same time).
 */

export const dynamic = "force-static";

export default function RegisterPage() {
  redirect("/join");
}
