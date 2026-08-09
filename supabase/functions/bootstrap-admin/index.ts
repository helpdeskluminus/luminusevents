// TEMPORARY one-shot bootstrap: creates the very first admin account.
// Refuses to run if any user_roles row already exists. Deleted after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/qr.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { count } = await admin.from("user_roles").select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) return json({ error: "Already bootstrapped" }, 409);

    const { email, password, full_name } = await req.json();
    if (typeof email !== "string" || typeof password !== "string") return json({ error: "email/password required" }, 400);

    let userId: string | null = null;
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (found) {
      userId = found.id;
      await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: full_name ?? "Admin" },
      });
      if (error || !created?.user) return json({ error: error?.message ?? "create failed" }, 400);
      userId = created.user.id;
    }

    await admin.from("profiles").upsert({ id: userId, full_name: full_name ?? "Admin", email });
    const { error: rErr } = await admin.from("user_roles").insert({ user_id: userId, role: "admin" });
    if (rErr) return json({ error: rErr.message }, 400);

    return json({ success: true, user_id: userId, existed: !!found });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
