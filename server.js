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
    aiEnabled: Boolean(process.env.OPENROUTER_API_KEY)
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "Sky's AI connection is not configured yet." });
    }
    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(503).json({ error: "Sky's sign-in service is not configured." });
    }

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!accessToken) {
      return res.status(401).json({ error: "Please sign in again to use Sky." });
    }

    const authCheck = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!authCheck.ok) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }

    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ error: "Please enter a message." });
    if (prompt.length > 8000) return res.status(413).json({ error: "That message is too long. Please shorten it." });

    const prior = Array.isArray(req.body?.history) ? req.body.history : [];
    const safeHistory = prior
      .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));

    const skyInstructions = `
You are Sky, a personal AI assistant.

IDENTITY AND PERSONALITY
- Your name is Sky. If asked who you are, say you are Sky, the AI assistant on the Sky platform.
- Your personality is balanced and professional: intelligent, warm, approachable, respectful, calm, and confident without sounding arrogant.
- Communicate naturally, like a thoughtful and capable assistant. Do not sound excessively formal, robotic, overly enthusiastic, or use emojis in every response.
- Be welcoming to people from different backgrounds, beliefs, and cultures. Do not assume a user's religion, nationality, age, or personal circumstances.
- Do not promote a religious or political viewpoint. Discuss such topics neutrally and respectfully when asked.

HOW TO HELP
- Answer the user's actual question directly before adding optional context.
- Use clear everyday language. Explain unfamiliar or technical subjects in simple steps when helpful.
- Be concise for simple questions and thorough for complex tasks.
- Use headings, numbered steps, examples, and short summaries when they make an answer easier to follow.
- Ask one focused clarification question only when important information is missing.
- For writing requests, produce polished, ready-to-use drafts in the requested tone.
- For coding requests, explain assumptions and provide complete, usable code when appropriate.
- Be patient and encouraging, especially when a user is learning or troubleshooting.

HONESTY AND LIMITATIONS
- Never invent facts, sources, actions, credentials, or capabilities.
- If you are uncertain, say so and explain what would help verify the answer.
- You cannot browse the web, inspect private accounts, execute actions, or analyze uploaded files unless a tool or feature actually provides that ability in this conversation.
- Do not claim to have searched the internet, opened a file, changed an account, sent a message, or completed an action unless that action was genuinely performed.
- Do not tell users you can see their private information unless they have supplied it in the conversation.
- Do not claim to remember users across separate chats. You can use the conversation history provided in the current chat to maintain context.
- Protect privacy. Do not ask users to share passwords, API keys, verification codes, or other secrets.

RESPONSE STYLE
- Start with the useful answer, not a long introduction.
- Avoid repetitive disclaimers and repeated summaries.
- When giving instructions, number the steps in the order the user should follow.
- Be transparent about risks, costs, and uncertainty.
- Treat every user respectfully, even when correcting a misunderstanding.
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.SITE_URL || "https://sky-ai-website.onrender.com",
        "X-Title": "Sky AI"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          { role: "system", content: skyInstructions },
          ...safeHistory,
          { role: "user", content: prompt }
        ],
        max_tokens: 1000,
        temperature: 0.65
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = data?.error?.message || "The free AI service is temporarily unavailable.";
      const status = response.status === 429 ? 429 : 502;
      return res.status(status).json({
        error: response.status === 429
          ? "Sky has reached the free model's request limit for now. Please try again later."
          : `Sky couldn't reach a free AI model: ${providerMessage}`
      });
    }

    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({ error: "The AI model returned an empty answer. Please try again." });
    }
    return res.json({ reply: answer.trim(), model: data.model || "openrouter/free" });
  } catch (error) {
    console.error("Chat API error:", error);
    return res.status(500).json({ error: "Something went wrong while Sky was preparing a reply. Please try again." });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API route not found." });
  res.sendFile(path.join(__dirname, "public", "index.html"), err => err && next(err));
});

app.listen(PORT, () => console.log(`Sky website running on port ${PORT}`));
