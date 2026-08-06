// Admin-only creation and approval of staff accounts (admin / disciplinary / event_oc)
// using the service role key. Public self-signup (see Auth.tsx "Create account") only
// ever creates an auth user + profile row with no role — a role is granted here, by an
// admin, via the 'approve' action. There is no way for a client to grant itself a role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/qr.ts";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const VALID_ROLES = ["admin", "disciplinary", "event_oc"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    if (!isAdmin) return json({ error: "Admins only" }, 403);

    const body = await req.json();
    const action = ["assign", "delete", "approve", "reject", "pending"].includes(body?.action) ? body.action : "create";

    if (action === "pending") {
      // Signed-up accounts with a profile but no role yet, awaiting admin approval.
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        admin.from("profiles").select("id, full_name, email, created_at"),
        admin.from("user_roles").select("user_id"),
      ]);
      const roled = new Set((roles ?? []).map((r) => r.user_id));
      const pending = (profiles ?? []).filter((p) => !roled.has(p.id));
      return json({ pending });
    }

    if (action === "approve") {
      const userId: string = body?.user_id ?? "";
      const role: string = body?.role ?? "";
      const competitionId: string | null = body?.competition_id ?? null;
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "user_id required" }, 400);
      if (!VALID_ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
      if (role === "event_oc" && !/^[0-9a-f-]{36}$/i.test(competitionId ?? "")) {
        return json({ error: "Event OC accounts need a competition" }, 400);
      }
      const { error } = await admin.from("user_roles").insert({
        user_id: userId,
        role,
        competition_id: role === "event_oc" ? competitionId : null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "reject") {
      // Rejecting a pending (roleless) signup — remove the account entirely.
      const userId: string = body?.user_id ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "user_id required" }, 400);
      if (userId === callerId) return json({ error: "You cannot reject your own account" }, 400);
      const { data: existingRoles } = await admin.from("user_roles").select("id").eq("user_id", userId).limit(1);
      if (existingRoles && existingRoles.length > 0) {
        return json({ error: "This account already has a role — use delete instead" }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "assign") {
      const userId: string = body?.user_id ?? "";
      const competitionId: string | null = body?.competition_id ?? null;
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "user_id required" }, 400);
      const { error } = await admin
        .from("user_roles")
        .update({ competition_id: competitionId })
        .eq("user_id", userId)
        .eq("role", "event_oc");
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "delete") {
      const userId: string = body?.user_id ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "user_id required" }, 400);
      if (userId === callerId) return json({ error: "You cannot delete your own account" }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    const fullName = String(body?.full_name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const role = String(body?.role ?? "");
    const competitionId: string | null = body?.competition_id ?? null;

    const errors: string[] = [];
    if (fullName.length < 2 || fullName.length > 120) errors.push("Name must be 2-120 characters");
    if (!isEmail(email)) errors.push("A valid email is required");
    if (password.length < 10) errors.push("Password must be at least 10 characters");
    if (!["admin", "disciplinary", "event_oc"].includes(role)) errors.push("Invalid role");
    if (role === "event_oc" && !/^[0-9a-f-]{36}$/i.test(competitionId ?? "")) errors.push("Event OC accounts need a competition");
    if (errors.length) return json({ error: errors.join(". ") }, 400);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr || !created?.user) return json({ error: createErr?.message ?? "Could not create user" }, 400);

    const newUserId = created.user.id;
    await admin.from("profiles").upsert({ id: newUserId, full_name: fullName, email });
    const { error: roleErr } = await admin.from("user_roles").insert({
      user_id: newUserId,
      role,
      competition_id: role === "event_oc" ? competitionId : null,
    });
    if (roleErr) {
      await admin.auth.admin.deleteUser(newUserId);
      return json({ error: roleErr.message }, 400);
    }

    return json({ success: true, user_id: newUserId });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected error" }, 500);
  }
});
