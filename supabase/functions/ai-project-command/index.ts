import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a project management assistant for a cabinet takeoff application.
You receive the user's natural language command and the current project state.
You must return a JSON array of actions to perform.

Available actions:

1. ADD_UNIT: { "action": "ADD_UNIT", "unitNumber": "101", "type": "Studio", "bldg": "A", "floor": "1", "notes": "" }
2. REMOVE_UNIT: { "action": "REMOVE_UNIT", "unitNumber": "101" }
3. UPDATE_UNIT: { "action": "UPDATE_UNIT", "unitNumber": "101", "updates": { "type": "1BHK", "floor": "2", "bldg": "B" } }
4. ADD_CABINET: { "action": "ADD_CABINET", "unitNumber": "101", "sku": "W3030", "type": "Wall", "room": "Kitchen", "quantity": 1, "width": 30, "height": 30, "depth": 12 }
5. REMOVE_CABINET: { "action": "REMOVE_CABINET", "unitNumber": "101", "sku": "W3030", "room": "Kitchen" }
6. UPDATE_CABINET: { "action": "UPDATE_CABINET", "unitNumber": "101", "sku": "W3030", "room": "Kitchen", "updates": { "quantity": 3 } }
7. ADD_ACCESSORY: { "action": "ADD_ACCESSORY", "unitNumber": "101", "type": "Filler", "description": "3in filler", "quantity": 1 }
8. REMOVE_ACCESSORY: { "action": "REMOVE_ACCESSORY", "unitNumber": "101", "description": "3in filler" }
9. ADD_COUNTERTOP: { "action": "ADD_COUNTERTOP", "unitNumber": "101", "label": "Main run", "length": 96, "depth": 25.5, "isIsland": false }
10. REMOVE_COUNTERTOP: { "action": "REMOVE_COUNTERTOP", "unitNumber": "101", "label": "Main run" }
11. UPDATE_PROJECT: { "action": "UPDATE_PROJECT", "updates": { "name": "New name", "notes": "some notes" } }
12. CLEAR_UNITS: { "action": "CLEAR_UNITS" }
13. MESSAGE: { "action": "MESSAGE", "text": "Here's what I found..." }

RULES:
- Always return valid JSON array of actions.
- If the user asks a question or you need to provide info, use MESSAGE action.
- If ambiguous, ask for clarification via MESSAGE.
- Unit types: Studio, 1BHK, 2BHK, 3BHK, 4BHK, Townhouse, Condo, Other, or any custom string.
- Cabinet types: Base, Wall, Tall, Vanity.
- Rooms: Kitchen, Pantry, Laundry, Bath, Other.
- Accessory types: Filler, Finished Panel, Toe Kick, Crown Molding, Light Rail, Hardware, Other.
- Match units by unitNumber (case-insensitive).
- When removing cabinets, match by SKU and room within the specified unit.
- You can return multiple actions at once.
- Always include a MESSAGE action at the end summarizing what you did.

Return ONLY valid JSON array. No markdown, no explanation outside the JSON.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const { command, projectState } = await req.json();

    if (!command || typeof command !== "string") {
      return new Response(JSON.stringify({ error: "command is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build a compact project summary for context
    const unitsSummary = (projectState?.units || []).map((u: any) => ({
      unitNumber: u.unitNumber,
      type: u.type,
      bldg: u.bldg,
      floor: u.floor,
      cabinets: (u.cabinets || []).length,
      cabinetList: (u.cabinets || []).map((c: any) => `${c.sku}x${c.quantity} (${c.room})`),
      accessories: (u.accessories || []).length,
      countertops: (u.countertops || []).length,
    }));

    const userMessage = `Project: "${projectState?.name || "Untitled"}"
Units (${unitsSummary.length}):
${JSON.stringify(unitsSummary, null, 1)}

User command: "${command}"`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n" + userMessage }] },
          ],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
      }
    );

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI error: ${response.status}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content ?? "[]";

    // Parse the JSON array from AI response
    let actions: any[] = [];
    try {
      let cleaned = content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      if (start >= 0 && end > start) {
        cleaned = cleaned.slice(start, end + 1);
      }
      actions = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content.slice(0, 500));
      actions = [{ action: "MESSAGE", text: "Sorry, I couldn't understand that command. Please try rephrasing." }];
    }

    if (!Array.isArray(actions)) {
      actions = [{ action: "MESSAGE", text: "Sorry, I couldn't process that. Please try again." }];
    }

    return new Response(JSON.stringify({ actions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-project-command error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
