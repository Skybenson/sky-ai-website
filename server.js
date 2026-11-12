
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
    routineBuilderEnabled: true,
    universalPlanGeneratorEnabled: true
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
async function askFreeModel(
  messages,
  maxTokens = 1000,
  temperature = 0.65
) {
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

  if (Array.isArray(answer)) {
    answer = answer
      .map(part =>
        typeof part === "string" ? part : part?.text || ""
      )
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
- Your personality is balanced and professional, warm, approachable,
  respectful and confident.
- Communicate naturally and clearly.
- Respect people from different backgrounds, beliefs and cultures.
- Do not promote religious or political viewpoints.

HOW TO HELP
- Answer the user's actual question directly.
- Use clear everyday language.
- Explain difficult subjects in simple steps.
- Be patient and encouraging.
- Help with learning, planning, productivity, writing and problem-solving.

UNIVERSAL PLANNING ASSISTANT
Sky helps users turn goals into practical, organized plans.

Plans can cover almost any reasonable activity, including:
- Singing, vocal training and music practice.
- Learning musical instruments.
- Studying, reading and exam preparation.
- Fitness, exercise and healthy habits.
- Business development and entrepreneurship.
- Dancing, drawing, painting and creative skills.
- Writing, public speaking and communication.
- Personal development and productivity.
- Spiritual practices and personal reflection when requested.
- Work projects, hobbies and learning new skills.

When a user wants a plan:
- Understand what they want to accomplish.
- Suggest practical steps in a sensible order.
- Adapt the plan to the requested timeframe.
- Use daily, weekly, monthly or longer schedules as appropriate.
- Include instructions rather than just activity names.
- Include milestones and ways to measure progress.
- Include breaks or rest when appropriate.
- Adapt to experience level and available time when provided.
- Never assume that every plan should be a workout or daily routine.
- Never force an unrelated activity into someone's plan.
- If the user gives a short request, make reasonable beginner-friendly
  assumptions and help immediately.
- Ask a clarification only when a missing detail is essential.

Do not claim that a plan has been saved unless the website actually saves it.

HONESTY AND PRIVACY
- Never invent facts, actions, sources or capabilities.
- You cannot browse the internet or inspect private accounts.
- Do not claim to have saved, edited or deleted data unless the action
  actually happened.
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
    throw new Error("No valid plan data was returned.");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

// Universal starter plan used if AI generation fails.
function getStarterRoutine(description) {
  const request = description.toLowerCase();

  let title = "My Personal Development Plan";
  let summary = "A practical starter plan for making progress.";
  let items = [];

  if (/sing|singing|vocal|voice training/.test(request)) {
    title = "My Singing Improvement Plan";
    summary = "Build vocal control, confidence, breathing and pitch.";

    items = [
      ["Breathing practice", "Practice gentle diaphragmatic breathing for 5 minutes.", "07:00"],
      ["Vocal warm-up", "Use gentle humming and lip trills. Do not force your voice.", "07:10"],
      ["Pitch practice", "Practice matching comfortable notes with a piano or pitch reference.", "07:20"],
      ["Vocal exercises", "Practice comfortable scales and clear vowel sounds.", "07:35"],
      ["Song practice", "Work on one short section of a song. Focus on accuracy and expression.", "07:50"],
      ["Review and rest", "Record a short practice sample, note improvements and rest your voice.", "08:10"]
    ];

  } else if (/guitar|piano|keyboard|instrument|music practice/.test(request)) {
    title = "My Music Learning Plan";
    summary = "Build musical skills through steady, structured practice.";

    items = [
      ["Warm up", "Prepare your hands and review your posture.", "07:00"],
      ["Technique practice", "Practice basic movements and finger exercises slowly.", "07:10"],
      ["Learn a new skill", "Focus on one chord, scale or technique.", "07:25"],
      ["Song practice", "Practice a simple song section slowly.", "07:45"],
      ["Review", "Repeat difficult parts and note what to improve.", "08:00"]
    ];

  } else if (/dance|dancing|choreograph/.test(request)) {
    title = "My Dance Improvement Plan";
    summary = "Develop coordination, rhythm, technique and confidence.";

    items = [
      ["Warm up", "Gently warm up your body and joints.", "07:00"],
      ["Basic steps", "Practice foundational steps at a comfortable pace.", "07:10"],
      ["Rhythm practice", "Practice moving in time with a song.", "07:25"],
      ["Choreography", "Learn a short section of a dance routine.", "07:40"],
      ["Review and cool down", "Review your movements and stretch gently.", "08:00"]
    ];

  } else if (/study|reading|exam|school|learn/.test(request)) {
    title = "My Study Improvement Plan";
    summary = "Build consistent learning habits and improve understanding.";

    items = [
      ["Set study goals", "Choose the topics you need to understand.", "07:00"],
      ["Study session one", "Study your most important topic and take notes.", "07:15"],
      ["Short break", "Rest your mind away from your study materials.", "08:00"],
      ["Study session two", "Continue with practice questions and examples.", "08:15"],
      ["Recall practice", "Try to explain what you learned without looking at your notes.", "09:00"],
      ["Review", "Record difficult areas and plan what to study next.", "09:15"]
    ];

  } else if (/business|entrepreneur|startup|marketing|sales/.test(request)) {
    title = "My Business Development Plan";
    summary = "Organize business goals into practical actions.";

    items = [
      ["Set a business goal", "Choose one clear result you want your business to achieve.", "08:00"],
      ["Understand your customers", "Identify customer needs and the problem you solve.", "09:00"],
      ["Improve your offer", "Review your product or service and how you present its value.", "10:00"],
      ["Marketing activity", "Prepare useful content or reach out to potential customers.", "12:00"],
      ["Business operations", "Review orders, tasks, expenses or other important operations.", "14:00"],
      ["Review progress", "Record results and choose your next actions.", "17:00"]
    ];

  } else if (/workout|gym|fitness|exercise|muscle|weight loss/.test(request)) {
    title = "My Beginner Fitness Plan";
    summary = "Build a safe and consistent foundation for fitness.";

    items = [
      ["Warm up", "Walk gently and prepare your muscles.", "06:30"],
      ["Main workout", "Complete a suitable beginner-friendly workout.", "06:40"],
      ["Cool down", "Stretch gently and slow your breathing.", "07:15"],
      ["Hydrate and recover", "Drink water and allow your body to recover.", "07:25"]
    ];

  } else if (/morning/.test(request)) {
    title = "My Morning Plan";
    summary = "Start the day with an intentional and organized routine.";

    items = [
      ["Wake up", "Get out of bed and freshen up.", "06:00"],
      ["Quiet time", "Pray, reflect or enjoy a moment of calm.", "06:10"],
      ["Get ready", "Wash up and prepare for the day.", "06:25"],
      ["Movement", "Do some light exercise or take a walk.", "06:40"],
      ["Breakfast", "Have a nourishing breakfast.", "07:15"],
      ["Plan the day", "Review your most important priorities.", "07:40"]
    ];

  } else if (/evening|night/.test(request)) {
    title = "My Evening Plan";
    summary = "Wind down and prepare for tomorrow.";

    items = [
      ["Tidy up", "Organize your space.", "18:00"],
      ["Dinner", "Enjoy your evening meal.", "18:30"],
      ["Personal time", "Relax or enjoy a hobby.", "19:00"],
      ["Prepare for tomorrow", "Organize your clothes and important tasks.", "20:00"],
      ["Wind down", "Reduce screen time and relax.", "21:00"],
      ["Bedtime", "Get ready for sleep.", "22:00"]
    ];

  } else {
    title = "My Personal Goal Plan";
    summary = `A flexible starter plan based on your goal: ${description}`;

    items = [
      ["Define your goal", "Write down exactly what you want to achieve.", "08:00"],
      ["Break it into steps", "Divide your goal into small, manageable actions.", "08:30"],
      ["Learn and prepare", "Gather the knowledge and materials you need.", "09:00"],
      ["Practice or take action", "Work on the most important first step.", "10:00"],
      ["Review your progress", "Identify what went well and what needs improvement.", "17:00"],
      ["Plan the next step", "Choose one action to continue your progress tomorrow.", "17:15"]
    ];
  }

  return {
    title,
    description: summary,
    items: items.map((item, index) => ({
      title: item[0],
      description: item[1],
      scheduled_time: item[2],
      position: index
    }))
  };
}

// Universal AI plan generation endpoint.
app.post("/api/routines/generate", async (req, res) => {
  try {
    await verifyUser(req);

    const description =
      typeof req.body?.description === "string"
        ? req.body.description.trim()
        : "";

    if (!description) {
      return res.status(400).json({
        error: "Tell Sky what you want to achieve and it will create a plan for you."
      });
    }

    if (description.length > 5000) {
      return res.status(413).json({
        error: "Your plan description is too long."
      });
    }

    const planningInstructions = `
You are Sky's Universal Personal Plan Generator.

Your job is to turn the user's goal into a complete, useful and
well-organized plan.

IMPORTANT:
Users can request plans for almost anything, not only fitness or
daily routines.

Examples include:
- Singing and vocal improvement.
- Music and musical instruments.
- Dancing and choreography.
- Studying and exam preparation.
- Reading and learning.
- Business and entrepreneurship.
- Productivity and work projects.
- Drawing, painting and other creative skills.
- Writing and public speaking.
- Personal development.
- Fitness and healthy habits.
- Any other reasonable skill, hobby or personal goal.

UNDERSTAND THE REQUEST
1. Identify exactly what the user wants to achieve.
2. Choose the appropriate type of plan.
3. Understand the requested duration.
4. If no duration is provided, choose a sensible starter duration
   appropriate to the goal.
5. If no experience level is provided, assume beginner level.
6. If no schedule is provided, suggest reasonable times.
7. Do not force a daily workout structure onto unrelated activities.
8. Do not ask for a long description before helping.

PLAN STRUCTURE
Create a plan with:
- A clear, descriptive title.
- A short overview of the goal and approach.
- A sensible duration or timeframe in the description.
- Activities or sessions arranged in a logical order.
- Clear instructions explaining what to do.
- Suggested times when useful.
- Weekly or daily progression when appropriate.
- Milestones or review activities when appropriate.
- Breaks, recovery or rest when appropriate.

MAKE IT PRACTICAL
- Make every activity specific and actionable.
- Avoid vague entries such as "improve yourself".
- Break difficult goals into manageable steps.
- Make the plan realistic and not unnecessarily overwhelming.
- Match the plan to the user's actual request.
- For a multi-day plan, make the day or week clear in the activity title
  or description.
- For a skill plan, include practice, learning and review.
- For a business plan, include practical business actions.
- For a singing plan, include suitable vocal exercises and rest.
- For a study plan, include learning, breaks and recall practice.
- For fitness plans, use appropriate warm-ups, exercises and recovery.
- Never give unsafe or extreme instructions.
- Never invent personal details about the user.

SHORT REQUESTS
If the user writes only a few words, such as "singing plan",
"business plan", "learn guitar" or "study routine", create a useful
beginner-friendly plan immediately.

OUTPUT FORMAT
Return ONLY valid JSON. Do not use Markdown or explanations outside JSON.

Use this exact structure:

{
  "title": "My Singing Improvement Plan",
  "description": "A 30-day beginner plan to improve breathing, pitch, vocal control and confidence. The plan progresses through short daily practice sessions.",
  "items": [
    {
      "title": "Week 1 - Breathing and foundations",
      "description": "Day 1: Practice gentle diaphragmatic breathing for 5 minutes. Day 2: Repeat the exercise and focus on relaxed posture. Continue gradually through the week.",
      "scheduled_time": "07:00",
      "position": 0
    },
    {
      "title": "Week 1 - Vocal warm-ups",
      "description": "Practice gentle humming and lip trills. Stop if your voice feels strained.",
      "scheduled_time": "07:15",
      "position": 1
    }
  ]
}

RULES
- Return between 3 and 20 activities.
- You may return more only when genuinely needed, up to 40.
- Each activity must have a clear title and useful instructions.
- Use 24-hour HH:MM time when a time is useful.
- Use null for scheduled_time when a clock time is not relevant.
- Positions must start at 0 and increase by 1.
- Put the duration, goal and overall structure in the description.
- Do not return extra JSON properties.
- Do not wrap the JSON in Markdown code fences.
`;

    let routine;

    try {
      const answer = await askFreeModel(
        [
          { role: "system", content: planningInstructions },
          { role: "user", content: description }
        ],
        4000,
        0.35
      );

      routine = extractJSON(answer);

    } catch (aiError) {
      console.error(
        "AI plan generation unavailable; using starter plan:",
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
        title:
          typeof item.title === "string" && item.title.trim()
            ? item.title.trim().slice(0, 150)
            : `Activity ${index + 1}`,

        description:
          typeof item.description === "string"
            ? item.description.trim().slice(0, 1500)
            : "",

        scheduled_time: time,
        position: index
      };
    });

    return res.json({
      routine: {
        title: routine.title.trim().slice(0, 120),
        description:
          typeof routine.description === "string"
            ? routine.description.trim().slice(0, 2000)
            : "",
        items
      }
    });

  } catch (error) {
    console.error("Plan generation error:", error);

    return res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : "Sky couldn't create your plan. Please try again."
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
