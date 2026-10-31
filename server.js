
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
    routineBuilderEnabled: true
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
    const error = new Error("Sky's AI connection is not configured yet.");
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
        ? "Sky has reached the free AI request limit. Please try again later."
        : data?.error?.message ||
          "The free AI service is temporarily unavailable."
    );

    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }

  let answer = data?.choices?.[0]?.message?.content;

  // Some models return content as an array instead of plain text.
  if (Array.isArray(answer)) {
    answer = answer
      .map(part => typeof part === "string" ? part : part?.text || "")
      .join("");
  }

  if (typeof answer !== "string" || !answer.trim()) {
    const error = new Error("The AI returned an empty response.");
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
- Users can make a routine by typing a short request such as "workout routine", "morning routine", "study plan" or "daily routine".
- Never demand a long description before helping.
- When users discuss their routines, help organize activities, times, rest, study, work and personal priorities.
- Users can change their routines in the Routine Builder workspace.
- Do not claim a routine has been saved unless it has actually been saved through the website.

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
    throw new Error("No valid routine data was returned.");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

// Simple starter routines for when the free AI model is unavailable.
function getStarterRoutine(description) {
  const request = description.toLowerCase();

  let title = "My Daily Routine";
  let items = [];

  if (/workout|gym|fitness|exercise|muscle|weight loss/.test(request)) {
    title = "My Workout Routine";
    items = [
      ["Warm up", "Walk gently and prepare your muscles.", "06:30"],
      ["Main workout", "Complete a suitable beginner-friendly workout.", "06:40"],
      ["Cool down", "Stretch gently and slow your breathing.", "07:15"],
      ["Hydrate", "Drink water and rest.", "07:25"]
    ];
  } else if (/study|reading|exam|school|learn/.test(request)) {
    title = "My Study Routine";
    items = [
      ["Morning preparation", "Get ready and organize your study materials.", "07:00"],
      ["Study session 1", "Focus on your most important subject.", "08:00"],
      ["Short break", "Rest your mind.", "09:00"],
      ["Study session 2", "Continue learning and taking notes.", "09:15"],
      ["Review", "Go over what you have learned.", "10:15"]
    ];
  } else if (/morning/.test(request)) {
    title = "My Morning Routine";
    items = [
      ["Wake up", "Get out of bed and freshen up.", "06:00"],
      ["Prayer or quiet time", "Take a moment for reflection.", "06:10"],
      ["Wash up", "Brush your teeth and wash your face.", "06:25"],
      ["Exercise", "Move your body with light exercise.", "06:40"],
      ["Breakfast", "Have a nourishing breakfast.", "07:15"],
      ["Plan the day", "Review your priorities.", "07:40"]
    ];
  } else if (/evening|night/.test(request)) {
    title = "My Evening Routine";
    items = [
      ["Tidy up", "Put away things and prepare your space.", "18:00"],
      ["Dinner", "Enjoy your evening meal.", "18:30"],
      ["Personal time", "Relax or enjoy a hobby.", "19:00"],
      ["Prepare for tomorrow", "Organize clothes and important tasks.", "20:00"],
      ["Wind down", "Reduce screen time and relax.", "21:00"],
      ["Bedtime", "Get ready for sleep.", "22:00"]
    ];
  } else {
    items = [
      ["Wake up", "Get up and freshen up.", "06:30"],
      ["Personal time", "Pray, reflect, or enjoy a quiet moment.", "06:45"],
      ["Exercise", "Move your body and stay active.", "07:00"],
      ["Breakfast", "Have a nourishing breakfast.", "07:45"],
      ["Main priorities", "Work on your most important tasks.", "08:30"],
      ["Break", "Take time to rest.", "10:30"],
      ["Afternoon tasks", "Continue with your daily responsibilities.", "12:00"],
      ["Relax", "Make time for yourself.", "17:00"],
      ["Prepare for tomorrow", "Organize your plans for the next day.", "20:00"],
      ["Bedtime", "Wind down and get enough sleep.", "22:00"]
    ];
  }

  return {
    title,
    description: `A simple starter plan based on your request: ${description}`,
    items: items.map((item, index) => ({
      title: item[0],
      description: item[1],
      scheduled_time: item[2],
      position: index
    }))
  };
}

// Routine generation endpoint.
app.post("/api/routines/generate", async (req, res) => {
  try {
    await verifyUser(req);

    const description =
      typeof req.body?.description === "string"
        ? req.body.description.trim()
        : "";

    if (!description) {
      return res.status(400).json({
        error: "Tell Sky what kind of routine you want, for example: Workout routine."
      });
    }

    if (description.length > 5000) {
      return res.status(413).json({
        error: "Your routine description is too long."
      });
    }

    const routineInstructions = `
You are Sky's simple and helpful Personal Routine Builder.

The user may give you only two or three words, such as:
- Workout routine
- Morning routine
- Study plan
- Evening routine
- Fitness plan
- Daily routine

IMPORTANT:
- Do not ask the user to provide more details.
- Do not demand a long description.
- Understand the short request and create a useful starter routine immediately.
- If the user does not specify times, choose sensible suggested times.
- If the user does not specify their experience level, make the plan beginner-friendly.
- Keep activities practical, clear and realistic.
- Include short breaks where appropriate.
- Do not create an unnecessarily long routine.
- Respect any specific times or activities the user mentions.
- For workouts, include a warm-up, suitable exercises, a cool-down and rest.
- Avoid extreme exercise or unsafe instructions.

Return ONLY valid JSON, without Markdown or explanations.

Use exactly this structure:

{
  "title": "My Workout Routine",
  "description": "A short description",
  "items": [
    {
      "title": "Warm up",
      "description": "Prepare your body for exercise",
      "scheduled_time": "06:30",
      "position": 0
    }
  ]
}

Return between 3 and 12 activities.
Use 24-hour time in HH:MM format.
Use null for a time only if no reasonable time can be suggested.
Positions must start at 0 and increase by 1.
`;

    let routine;

    try {
      const answer = await askFreeModel(
        [
          { role: "system", content: routineInstructions },
          { role: "user", content: description }
        ],
        2000,
        0.3
      );

      routine = extractJSON(answer);

    } catch (aiError) {
      console.error(
        "AI routine generation unavailable; using starter routine:",
        aiError.message
      );

      routine = getStarterRoutine(description);
    }

    if (
      !routine ||
      typeof routine.title !== "string" ||
      !Array.isArray(routine.items) ||
      routine.items.length === 0
    ) {
      routine = getStarterRoutine(description);
    }

    const items = routine.items.slice(0, 40).map((item, index) => {
      const time =
        typeof item.scheduled_time === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(item.scheduled_time)
          ? item.scheduled_time
          : null;

      return {
        title: typeof item.title === "string"
          ? item.title.slice(0, 150)
          : `Activity ${index + 1}`,
        description: typeof item.description === "string"
          ? item.description.slice(0, 500)
          : "",
        scheduled_time: time,
        position: index
      };
    });

    return res.json({
      routine: {
        title: routine.title.slice(0, 120),
        description: typeof routine.description === "string"
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
        : "Sky couldn't create your routine. Please try again."
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
