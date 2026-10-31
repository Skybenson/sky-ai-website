
import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

app.get("/api/config", (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ""
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "openrouter-free",
    aiEnabled: Boolean(process.env.OPENROUTER_API_KEY),
    routineBuilderEnabled: Boolean(process.env.OPENROUTER_API_KEY)
  });
});

// Verify the signed-in Supabase user.
async function verifyUser(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase sign-in service is not configured.");
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!accessToken) {
    const error = new Error("Please sign in again to use Sky.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    const error = new Error(
      "Your session has expired. Please sign in again."
    );
    error.status = 401;
    throw error;
  }

  return response.json();
}

// Shared OpenRouter request.
async function askFreeModel(messages, maxTokens = 1000, temperature = 0.65) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    const error = new Error(
      "Sky's AI connection is not configured yet."
    );
    error.status = 503;
    throw error;
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.SITE_URL ||
        "https://sky-ai-website.onrender.com",
      "X-Title": "Sky AI"
    },
    body: JSON.stringify({
      model: "openrouter/free",
      messages,
      max_tokens: maxTokens,
      temperature
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      response.status === 429
        ? "Sky has reached the free model's request limit. Please try again later."
        : data?.error?.message ||
          "The free AI service is temporarily unavailable."
    );

    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }

  const answer = data?.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    const error = new Error(
      "The AI model returned an empty answer. Please try again."
    );
    error.status = 502;
    throw error;
  }

  return answer.trim();
}

// Existing AI CHAT endpoint.
app.post("/api/chat", async (req, res) => {
  try {
    await verifyUser(req);

    const prompt =
      typeof req.body?.prompt === "string"
        ? req.body.prompt.trim()
        : "";

    if (!prompt) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (prompt.length > 8000) {
      return res.status(413).json({
        error: "That message is too long. Please shorten it."
      });
    }

    const prior = Array.isArray(req.body?.history)
      ? req.body.history
      : [];

    const safeHistory = prior
      .filter(
        message =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string"
      )
      .slice(-10)
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 8000)
      }));

    const skyInstructions = `
You are Sky, a personal AI assistant.

IDENTITY AND PERSONALITY
- Your name is Sky.
- Your personality is balanced and professional, warm, approachable, respectful and confident.
- Communicate naturally and clearly.
- Be welcoming to people from different backgrounds, beliefs and cultures.
- Do not promote religious or political viewpoints.

HOW TO HELP
- Answer the user's actual question directly.
- Use clear everyday language.
- Explain difficult subjects in simple steps.
- Be patient and encouraging.
- Help with daily planning, learning, productivity, writing and problem-solving.

SKY ROUTINE BUILDER
- Sky helps people create personalized daily routines.
- When users discuss their routines, help them organize activities, times, rest, study, work and personal priorities.
- Users should be able to change their routines whenever they want.
- Do not claim a routine has been saved unless it has actually been saved through the website.
- If a user wants a structured routine, explain that they can use the Routine Builder workspace.

HONESTY AND PRIVACY
- Never invent facts, actions, sources or capabilities.
- You cannot browse the internet or inspect private accounts.
- Do not claim to have saved, edited or deleted data unless the action actually happened.
- Never request passwords, API keys or verification codes.
- Do not claim to remember users across separate chats.

RESPONSE STYLE
- Start with the useful answer.
- Avoid unnecessary introductions.
- Be concise when appropriate and thorough when needed.
- Use headings and numbered steps when helpful.
`;

    const answer = await askFreeModel([
      { role: "system", content: skyInstructions },
      ...safeHistory,
      { role: "user", content: prompt }
    ]);

    return res.json({
      reply: answer,
      model: "openrouter/free"
    });

  } catch (error) {
    console.error("Chat API error:", error);

    return res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : "Something went wrong while Sky was preparing a reply. Please try again."
    });
  }
});

// Extract JSON safely from the AI response.
function extractJSON(text) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Sky couldn't create a valid routine. Please try again.");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

// NEW: AI ROUTINE GENERATION endpoint.
app.post("/api/routines/generate", async (req, res) => {
  try {
    await verifyUser(req);

    const description =
      typeof req.body?.description === "string"
        ? req.body.description.trim()
        : "";

    if (!description) {
      return res.status(400).json({
        error: "Please describe the routine you want Sky to create."
      });
    }

    if (description.length > 5000) {
      return res.status(413).json({
        error: "Your routine description is too long."
      });
    }

    const routineInstructions = `
You are Sky's Personal Routine Builder.

Your task is to transform a person's daily-life requirements into a practical, realistic and personalized routine.

RULES:
- Respect the user's requested wake-up time, bedtime and fixed commitments.
- Include requested activities.
- Make the schedule realistic, with reasonable breaks and transition time.
- Do not schedule two activities at the same time.
- Do not invent important personal commitments.
- If the user does not specify exact times, propose sensible times.
- Use 24-hour time in HH:MM format.
- Return between 1 and 40 activities.
- Give each activity a short, useful title.
- Descriptions should be brief and helpful.
- Keep the routine balanced and avoid unrealistic schedules.

OUTPUT:
Return ONLY valid JSON.
Do not use Markdown code fences.
Do not add explanations outside the JSON.

Use exactly this structure:

{
  "title": "My Daily Routine",
  "description": "A short description of the routine",
  "items": [
    {
      "title": "Wake up",
      "description": "Get out of bed and freshen up",
      "scheduled_time": "05:30",
      "position": 0
    }
  ]
}

IMPORTANT:
- Every item must have a title.
- scheduled_time must be HH:MM in 24-hour format, or null if no reasonable time can be assigned.
- position must start at 0 and increase by 1.
- Return JSON only.
`;

    const answer = await askFreeModel(
      [
        {
          role: "system",
          content: routineInstructions
        },
        {
          role: "user",
          content: description
        }
      ],
      1800,
      0.4
    );

    let routine;

    try {
      routine = extractJSON(answer);
    } catch {
      return res.status(502).json({
        error: "Sky couldn't format the routine correctly. Please try generating it again."
      });
    }

    if (
      !routine ||
      typeof routine.title !== "string" ||
      !Array.isArray(routine.items) ||
      routine.items.length === 0 ||
      routine.items.length > 40
    ) {
      return res.status(502).json({
        error: "Sky returned an incomplete routine. Please try again."
      });
    }

    const items = routine.items.map((item, index) => {
      const time =
        typeof item.scheduled_time === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(item.scheduled_time)
          ? item.scheduled_time
          : null;

      return {
        title:
          typeof item.title === "string"
            ? item.title.slice(0, 150)
            : `Activity ${index + 1}`,
        description:
          typeof item.description === "string"
            ? item.description.slice(0, 500)
            : "",
        scheduled_time: time,
        position: index
      };
    });

    return res.json({
      routine: {
        title: routine.title.slice(0, 120),
        description:
          typeof routine.description === "string"
            ? routine.description.slice(0, 500)
            : "",
        items
      }
    });

  } catch (error) {
    console.error("Routine generation error:", error);

    return res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : "Sky couldn't generate your routine. Please try again."
    });
  }
});

// Website fallback.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API route not found."
    });
  }

  res.sendFile(
    path.join(__dirname, "public", "index.html"),
    err => err && next(err)
  );
});

app.listen(PORT, () => {
  console.log(`Sky website running on port ${PORT}`);
});
