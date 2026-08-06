// Admin-only creation of staff accounts (disciplinary / event_oc) using the service role key.
// There is no public signup for staff roles.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/qr.ts";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

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
    const action = body?.action === "delete" ? "delete" : body?.action === "assign" ? "assign" : "create";

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
