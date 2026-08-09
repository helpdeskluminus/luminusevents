// Admin-only: given a poster image (already uploaded to the event-images
// bucket), asks a vision-capable model to extract structured event details
// so the admin doesn't have to retype the name/date/time/venue by hand.
// Uses the Lovable AI Gateway (bundled with every Lovable Cloud project) —
// no separate API key setup needed beyond what Lovable Cloud provisions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const EXTRACT_TOOL = {
  type: "function",
  function: {
    name: "extract_event_details",
    description: "Structured details read off an event/competition poster image.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event or competition title, as printed on the poster." },
        description: { type: "string", description: "One or two sentence summary of what the poster describes (theme, prizes, highlights). Empty string if nothing usable." },
        venue: { type: "string", description: "Venue / location text exactly as printed. Empty string if not shown." },
        date: { type: "string", description: "The event date in YYYY-MM-DD format. Empty string if not shown or not confidently readable. If a date range is shown, use the first date." },
        end_date: { type: "string", description: "End date in YYYY-MM-DD, only if a distinct multi-day range is printed. Empty string otherwise." },
        start_time: { type: "string", description: "Start time in 24-hour HH:MM format. Empty string if not shown." },
        end_time: { type: "string", description: "End time in 24-hour HH:MM format. Empty string if not shown." },
        confidence: { type: "string", enum: ["high", "medium", "low"], description: "Your overall confidence that these fields were read correctly off the image." },
      },
      required: ["name", "description", "venue", "date", "end_date", "start_time", "end_time", "confidence"],
      additionalProperties: false,
    },
  },
};

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
    const imageUrl: string = String(body?.image_url ?? "").trim();
    if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return json({ error: "image_url is required" }, 400);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI extraction isn't configured on this project (LOVABLE_API_KEY missing)" }, 400);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You read event/competition posters and extract structured details. Only report what is actually printed on the poster — never invent a date, time or venue. Leave a field as an empty string if it isn't clearly shown. Always call the extract_event_details tool with your result.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the event details from this poster." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        tools: [EXTRACT_TOOL],
        tool_choice: { type: "function", function: { name: "extract_event_details" } },
      }),
    });

    if (aiRes.status === 429) return json({ error: "Rate limited — try again in a moment" }, 429);
    if (aiRes.status === 402) return json({ error: "AI usage limit reached for this workspace" }, 402);
    if (!aiRes.ok) {
      console.error("AI gateway error", aiRes.status, await aiRes.text());
      return json({ error: "Could not read the poster right now" }, 502);
    }

    const aiJson = await aiRes.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) return json({ error: "Could not extract details from this image" }, 422);

    let extracted: Record<string, string>;
    try {
      extracted = JSON.parse(call.function.arguments);
    } catch {
      return json({ error: "Could not parse extraction result" }, 422);
    }

    return json({ success: true, extracted });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected error" }, 500);
  }
});
