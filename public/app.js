const form = document.querySelector("#chatForm");
const promptBox = document.querySelector("#prompt");
const messagesEl = document.querySelector("#messages");
const sendButton = document.querySelector("#sendButton");
const welcome = document.querySelector("#welcome");
const statusText = document.querySelector("#statusText");
const newChatButton = document.querySelector("#newChat");
let history = [];
let busy = false;

document.querySelector("#year").textContent = new Date().getFullYear();

async function checkStatus() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    statusText.textContent = data.configured ? "Ready to chat" : "Setup needed";
    if (!data.configured) statusText.title = "The server needs an API key before Sky can answer.";
  } catch {
    statusText.textContent = "Server unavailable";
  }
}
checkStatus();

function addMessage(role, content) {
  welcome?.remove();
  const row = document.createElement("div");
  row.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "assistant" ? "S" : "Y";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  row.append(avatar, bubble);
  messagesEl.append(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
  promptBox.disabled = value;
}

async function sendMessage(text) {
  const content = text.trim();
  if (!content || busy) return;
  history.push({ role: "user", content });
  addMessage("user", content);
  promptBox.value = "";
  promptBox.style.height = "auto";
  setBusy(true);
  const typing = document.createElement("div");
  typing.className = "typing";
  typing.textContent = "Sky is thinking…";
  messagesEl.append(typing);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history })
    });
    const data = await response.json();
    typing.remove();
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    history.push({ role: "assistant", content: data.reply });
    addMessage("assistant", data.reply);
  } catch (error) {
    typing.remove();
    history.pop();
    addMessage("assistant", error.message || "I couldn't connect just now. Please try again.");
  } finally {
    setBusy(false);
    promptBox.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(promptBox.value);
});
promptBox.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
promptBox.addEventListener("input", () => {
  promptBox.style.height = "auto";
  promptBox.style.height = `${Math.min(promptBox.scrollHeight, 120)}px`;
});
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.textContent.replace("↗", "").trim()));
});
newChatButton.addEventListener("click", () => {
  if (busy) return;
  history = [];
  messagesEl.innerHTML = "";
  const fresh = document.createElement("div");
  fresh.className = "welcome";
  fresh.innerHTML = `<div class="welcome-icon"><span class="brand-mark"><span></span><span></span><span></span></span></div><div class="welcome-kicker">HELLO, I'M SKY</div><h3>Where shall we<br><span>begin?</span></h3><p>Ask me a question, share an idea, or tell me what you're working on.</p><div class="suggestions"><button class="suggestion">Help me plan a new project <span>↗</span></button><button class="suggestion">Explain a difficult concept <span>↗</span></button><button class="suggestion">Give me ideas for my business <span>↗</span></button></div>`;
  messagesEl.append(fresh);
  fresh.querySelectorAll(".suggestion").forEach((button) => button.addEventListener("click", () => sendMessage(button.textContent.replace("↗", "").trim())));
  promptBox.focus();
});