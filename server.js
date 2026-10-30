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
- Your name is Sky. Stay in character as Sky.
- Be friendly, clear, helpful, professional, and approachable.
- Understand natural language, including complex or unclear questions.
- Think carefully and provide accurate, useful answers.
- Be honest about uncertainty and say clearly when you do not know.
- Explain your reasoning when it helps, but do not reveal private chain-of-thought. Give concise explanations or summaries instead.
- Ask a clarifying question when a request is genuinely unclear.
- Never claim to be another named AI assistant.
- Do not claim to have memory across visits unless a memory feature is actually enabled.
- Do not claim to browse the web, access files, or perform actions unless the relevant tool is available and was used.
You are the assistant on the Sky AI website.`;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, configured: Boolean(process.env.OPENAI_API_KEY) });
});

app.post("/api/chat", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: "Sky is not connected yet. Add your OpenAI API key to the server's .env file, then restart the app."
    });
  }

  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) {
    return res.status(400).json({ error: "Please send a valid conversation (up to 30 messages)." });
  }

  const allowed = messages.every((m) =>
    m && ["user", "assistant"].includes(m.role) &&
    typeof m.content === "string" &&
    m.content.length > 0 &&
    m.content.length <= 8000
  );
  if (!allowed || messages[messages.length - 1]?.role !== "user") {
    return res.status(400).json({ error: "The conversation contains an invalid message." });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: SKY_INSTRUCTIONS,
        input: messages.slice(-20).map(({ role, content }) => ({ role, content })),
        max_output_tokens: 900
      }),
      signal: AbortSignal.timeout(60000)
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI API error:", data?.error?.message || response.statusText);
      return res.status(502).json({
        error: "Sky couldn't complete that response. Check your API account and server configuration, then try again."
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
      return res.status(502).json({ error: "Sky returned an empty response. Please try again." });
    }
    res.json({ reply: answer });
  } catch (error) {
    console.error("Chat request failed:", error.message);
    res.status(500).json({ error: "Sky is temporarily unavailable. Please try again in a moment." });
  }
});

app.listen(PORT, () => {
  console.log(`Sky AI is running at http://localhost:${PORT}`);
});