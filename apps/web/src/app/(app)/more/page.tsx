import { redirect } from "next/navigation";

/**
 * The phone's "More" tab is gone (P7.2): its contents are the Club and Me
 * hubs, which are tabs of their own. A bookmark or an old push notification
 * that still says /more lands on Me — the person-shaped half of what More
 * used to hold, and the one with the sign-out.
 */
export default function MorePage() {
  redirect("/me");
}
