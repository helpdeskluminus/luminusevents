// Marks a registration as "exited" - a manual action by gate staff, not a
// second QR scan. This is what turns cumulative gate entries into real,
// decrementable occupancy. Same authorisation as main-gate scanning:
// admin, disciplinary, or gate_staff.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/qr.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const registrationId: string = typeof body?.registration_id === "string" ? body.registration_id.trim() : "";
    // 'exit' marks someone as having left; 'reentry' undoes a mis-tap without
    // requiring another gate scan.
    const action: string = body?.action === "reentry" ? "reentry" : "exit";
    if (!/^[0-9a-f-]{36}$/i.test(registrationId)) return json({ error: "Invalid registration" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const roleList = (roles ?? []) as { role: string }[];
    const authorised = roleList.some((r) => ["admin", "disciplinary", "gate_staff"].includes(r.role));
    if (!authorised) return json({ error: "Not authorised for the main gate" }, 403);

    const { data: reg } = await admin
      .from("registrations")
      .select("id, currently_inside, participants(name)")
      .eq("id", registrationId)
      .maybeSingle();
    if (!reg) return json({ error: "Registration not found" }, 404);

    if (action === "exit") {
      if (!reg.currently_inside) return json({ error: "This ticket isn't currently marked as inside" }, 409);
      const { error } = await admin
        .from("registrations")
        .update({ currently_inside: false, last_exit_at: new Date().toISOString(), last_exit_by: userId })
        .eq("id", registrationId);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true, currently_inside: false });
    }

    // reentry: allow undoing an accidental exit mark without another gate scan
    const { error } = await admin
      .from("registrations")
      .update({ currently_inside: true, last_entry_at: new Date().toISOString() })
      .eq("id", registrationId);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true, currently_inside: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected error" }, 500);
  }
});
