import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function hmacSign(
  data: string,
  secret: string
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ status: "error", message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the caller
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(
        JSON.stringify({ status: "error", message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check user role
    const { data: profile } = await supabase
      .from("users")
      .select("role, approval_status, assigned_event_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.approval_status !== "approved") {
      return new Response(
        JSON.stringify({ status: "error", message: "Not approved" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { pid, eid, token, sig } = await req.json();

    if (!pid || !eid || !token) {
      return new Response(
        JSON.stringify({ status: "error", message: "Invalid QR Code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify HMAC signature if provided
    const hmacSecret = Deno.env.get("QR_HMAC_SECRET");
    if (sig && hmacSecret) {
      const expected = await hmacSign(`${pid}:${eid}:${token}`, hmacSecret);
      if (sig !== expected) {
        return new Response(
          JSON.stringify({ status: "error", message: "Invalid or Tampered QR" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check coordinator is assigned to this event
    if (profile.role === "coordinator" && profile.assigned_event_id !== eid) {
      return new Response(
        JSON.stringify({ status: "error", message: "Not assigned to this event" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up participant by qr_token (indexed, fast)
    const { data: participant, error: fetchErr } = await supabase
      .from("participants")
      .select("id, event_id, qr_token, name, phone, checked_in")
      .eq("qr_token", token)
      .single();

    if (fetchErr || !participant) {
      return new Response(
        JSON.stringify({ status: "error", message: "Invalid QR Code" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify pid and eid match
    if (participant.id !== pid || participant.event_id !== eid) {
      return new Response(
        JSON.stringify({ status: "error", message: "Invalid or Tampered QR" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (participant.checked_in) {
      return new Response(
        JSON.stringify({
          status: "duplicate",
          message: "Participant Already Checked In",
          name: participant.name,
          phone: participant.phone,
          participantId: participant.id,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atomic check-in: only updates if checked_in = false
    const { data: updated, error: updateErr } = await supabase
      .from("participants")
      .update({ checked_in: true, checked_in_at: new Date().toISOString() })
      .eq("id", pid)
      .eq("qr_token", token)
      .eq("checked_in", false)
      .select("id, name, phone")
      .single();

    if (updateErr || !updated) {
      return new Response(
        JSON.stringify({ status: "duplicate", message: "Already checked in (race condition)" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log checkin
    await supabase.from("checkins").insert({
      participant_id: pid,
      event_id: eid,
      scanned_by: user.id,
    });

    return new Response(
      JSON.stringify({
        status: "success",
        message: "Check-in Successful!",
        name: updated.name,
        phone: updated.phone,
        participantId: updated.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
