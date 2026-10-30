const $ = (id) => document.getElementById(id);

let supabaseClient;
let currentUser = null;
let currentConversation = null;
let messages = [];
let authMode = "signup";
let busy = false;

const welcomeScreen = $("welcomeScreen");
const authScreen = $("authScreen");
const chatScreen = $("chatScreen");

function showScreen(screen) {
  welcomeScreen.classList.add("hidden");
  authScreen.classList.add("hidden");
  chatScreen.classList.add("hidden");
  screen.classList.remove("hidden");
  $("logoutButton").classList.toggle("hidden", !currentUser);
  $("loginNav").classList.toggle("hidden", Boolean(currentUser));
  $("signupNav").classList.toggle("hidden", Boolean(currentUser));
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function showAuth(mode) {
  authMode = mode;
  $("authTitle").textContent =
    mode === "signup" ? "Create your account" : "Welcome back";
  $("authDescription").textContent =
    mode === "signup"
      ? "Your personal AI assistant is waiting for you."
      : "Log in to continue your journey with Sky.";
  $("authSubmit").textContent =
    mode === "signup" ? "Create Account" : "Log In";
  $("authSwitchText").textContent =
    mode === "signup"
      ? "Already have an account?"
      : "Don't have an account?";
  $("authSwitchButton").textContent =
    mode === "signup" ? "Log In" : "Sign Up";
  $("authPassword").autocomplete =
    mode === "signup" ? "new-password" : "current-password";
  $("authForm").reset();
  showMessage($("authMessage"), "");
  showScreen(authScreen);
}

async function initialize() {
  $("year").textContent = new Date().getFullYear();

  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Could not load Sky configuration.");

    const config = await response.json();

    if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("Supabase is not configured correctly.");
    }

    supabaseClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey
    );

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    if (data.session) {
      currentUser = data.session.user;
      await openChat();
    } else {
      showScreen(welcomeScreen);
    }

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      if (!currentUser) {
        currentConversation = null;
        messages = [];
        showScreen(welcomeScreen);
      }
    });

    $("statusText").textContent = "Ready to chat";
  } catch (error) {
    console.error(error);
    showScreen(welcomeScreen);
    $("statusText").textContent = "Connection issue";
  }
}

async function signUpOrLogin(event) {
  event.preventDefault();

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const button = $("authSubmit");

  button.disabled = true;
  showMessage($("authMessage"), "Please wait...");

  try {
    let result;

    if (authMode === "signup") {
      result = await supabaseClient.auth.signUp({
        email,
        password
      });
    } else {
      result = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });
    }

    if (result.error) throw result.error;

    if (authMode === "signup" && !result.data.session) {
      showMessage(
        $("authMessage"),
        "Account created! Please check your email and confirm your address, then log in."
      );
      return;
    }

    currentUser = result.data.user;
    await openChat();
  } catch (error) {
    showMessage(
      $("authMessage"),
      error.message || "Something went wrong. Please try again.",
      true
    );
  } finally {
    button.disabled = false;
  }
}

async function signOut() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    alert(error.message);
    return;
  }

  currentUser = null;
  currentConversation = null;
  messages = [];
  showScreen(welcomeScreen);
}

function addMessage(role, content) {
  $("chatWelcome")?.remove();

  const row = document.createElement("div");
  row.className = `message ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;

  row.appendChild(bubble);
  $("messages").appendChild(row);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function clearChatView() {
  $("messages").innerHTML = "";
}

function showChatWelcome() {
  clearChatView();

  const welcome = document.createElement("div");
  welcome.id = "chatWelcome";
  welcome.className = "chat-welcome";

  const heading = document.createElement("h2");
  heading.textContent = "Where shall we begin?";

  const description = document.createElement("p");
  description.textContent =
    "Ask a question, share an idea, or tell me what you're working on.";

  welcome.append(heading, description);

  const suggestions = document.createElement("div");
  suggestions.className = "suggestions";

  [
    "Help me plan a new project",
    "Explain a difficult concept",
    "Give me ideas for my business"
  ].forEach((text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";
    button.textContent = text;
    button.addEventListener("click", () => sendMessage(text));
    suggestions.appendChild(button);
  });

  welcome.appendChild(suggestions);
  $("messages").appendChild(welcome);
}

async function openChat() {
  showScreen(chatScreen);
  showChatWelcome();
  await loadConversations();
}

async function loadConversations() {
  const list = $("chatHistory");
  list.innerHTML = "";

  const { data, error } = await supabaseClient
    .from("conversations")
    .select("id, title, updated_at")
    .eq("user_id", currentUser.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("History loading error:", error);
    list.textContent = "Couldn't load conversations.";
    return;
  }

  if (!data.length) {
    list.textContent = "Your saved conversations will appear here.";
    return;
  }

  data.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.textContent = conversation.title;
    button.addEventListener("click", () => loadConversation(conversation.id));
    list.appendChild(button);
  });
}

async function loadConversation(id) {
  const { data, error } = await supabaseClient
    .from("messages")
    .select("role, content")
    .eq("conversation_id", id)
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: true });

  if (error) {
    alert("Couldn't open this conversation: " + error.message);
    return;
  }

  currentConversation = id;
  messages = data || [];
  clearChatView();

  if (!messages.length) {
    showChatWelcome();
    return;
  }

  messages.forEach((message) => {
    addMessage(message.role, message.content);
  });
}

async function createConversation(title) {
  const { data, error } = await supabaseClient
    .from("conversations")
    .insert({
      user_id: currentUser.id,
      title: title.slice(0, 80)
    })
    .select("id")
    .single();

  if (error) throw error;

  currentConversation = data.id;
  await loadConversations();
}

async function saveMessage(role, content) {
  const { error } = await supabaseClient
    .from("messages")
    .insert({
      conversation_id: currentConversation,
      user_id: currentUser.id,
      role,
      content
    });

  if (error) throw error;

  await supabaseClient
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", currentConversation)
    .eq("user_id", currentUser.id);
}

async function sendMessage(text) {
  const content = text.trim();
  if (!content || busy || !currentUser) return;

  busy = true;
  $("sendButton").disabled = true;
  $("prompt").disabled = true;

  try {
    if (!currentConversation) {
      await createConversation(content);
    }

    messages.push({ role: "user", content });
    addMessage("user", content);
    $("prompt").value = "";

    await saveMessage("user", content);

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) throw new Error("Please log in again.");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ messages })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Sky couldn't respond.");
    }

    messages.push({ role: "assistant", content: result.reply });
    addMessage("assistant", result.reply);
    await saveMessage("assistant", result.reply);
    await loadConversations();
  } catch (error) {
    console.error(error);
    addMessage(
      "assistant",
      error.message || "Sky couldn't connect. Please try again."
    );
  } finally {
    busy = false;
    $("sendButton").disabled = false;
    $("prompt").disabled = false;
    $("prompt").focus();
  }
}

function newChat() {
  if (busy) return;
  currentConversation = null;
  messages = [];
  showChatWelcome();
}

$("loginNav").addEventListener("click", () => showAuth("login"));
$("signupNav").addEventListener("click", () => showAuth("signup"));
$("getStartedButton").addEventListener("click", () => showAuth("signup"));
$("welcomeLoginButton").addEventListener("click", () => showAuth("login"));
$("authSwitchButton").addEventListener("click", () => {
  showAuth(authMode === "signup" ? "login" : "signup");
});
$("backHomeButton").addEventListener("click", () => showScreen(welcomeScreen));
$("authForm").addEventListener("submit", signUpOrLogin);
$("logoutButton").addEventListener("click", signOut);
$("newChatButton").addEventListener("click", newChat);

$("chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage($("prompt").value);
});

$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("chatForm").requestSubmit();
  }
});

initialize();

