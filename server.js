
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const SKY_INSTRUCTIONS = `You are Sky, an intelligent and capable AI assistant.

Identity and personality:
- Your name is Sky. Always stay in character as Sky.
- Be friendly, clear, helpful, professional, and approachable.
- Understand natural language, including complex questions.
- Give accurate, thoughtful and useful answers.
- Be honest about uncertainty.
- Explain your answers clearly without revealing private chain-of-thought.
- Ask a clarifying question when genuinely necessary.
- Never claim to be another AI assistant.
- Never claim to remember users across visits unless memory is enabled.
- Never claim to use tools or access information unless actually available.

You are the personal AI assistant on the Sky AI website.`;

function getSupabaseSettings() {
  return {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY
  };
}

// Public configuration needed by the website.
// The publishable key is designed to be used in a browser.
app.get("/api/config", (_req, res) => {
  const { url, key } = getSupabaseSettings();

  if (!url || !key) {
    return res.status(503).json({
      error: "Supabase has not been configured on the server."
    });
  }

  res.json({
    supabaseUrl: url,
    supabaseAnonKey: key
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.OPENAI_API_KEY),
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    )
  });
});

// Check that the request belongs to a signed-in Supabase user.
async function authenticateUser(req, res, next) {
  const { url, key } = getSupabaseSettings();
  const authorization = req.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "");

  if (!url || !key) {
    return res.status(503).json({
      error: "Sky's sign-in service is not configured yet."
    });
  }

  if (!token || token === authorization) {
    return res.status(401).json({
      error: "Please log in to use Sky."
    });
  }

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return res.status(401).json({
        error: "Your session has expired. Please log in again."
      });
    }

    req.user = await response.json();
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    res.status(503).json({
      error: "The sign-in service is temporarily unavailable."
    });
  }
}

app.post("/api/chat", authenticateUser, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: "Sky's AI connection has not been configured."
    });
  }

  const messages = req.body?.messages;

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 30
  ) {
    return res.status(400).json({
      error: "Please send a valid conversation."
    });
  }

  const allowed = messages.every((message) =>
    message &&
    ["user", "assistant"].includes(message.role) &&
    typeof message.content === "string" &&
    message.content.length > 0 &&
    message.content.length <= 8000
  );

  if (!allowed || messages[messages.length - 1]?.role !== "user") {
    return res.status(400).json({
      error: "The conversation contains an invalid message."
    });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: SKY_INSTRUCTIONS,
        input: messages.slice(-20).map(({ role, content }) => ({
          role,
          content
        })),
        max_output_tokens: 900
      }),
      signal: AbortSignal.timeout(60000)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "OpenAI API error:",
        data?.error?.message || response.statusText
      );

      return res.status(502).json({
        error: "Sky couldn't complete that response. Please try again."
      });
    }

    const answer = (data.output || [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (!answer) {
      return res.status(502).json({
        error: "Sky returned an empty response. Please try again."
      });
    }

    res.json({ reply: answer });
  } catch (error) {
    console.error("Chat request failed:", error.message);

    res.status(500).json({
      error: "Sky is temporarily unavailable. Please try again."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Sky AI is running on port ${PORT}`);
});
