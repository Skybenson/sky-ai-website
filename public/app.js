
(() => {
  const $ = id => document.getElementById(id);
  const screens = ["welcomeScreen", "authScreen", "chatScreen"];
  let supabaseClient, session, currentConversation = null, conversations = [];
  let authMode = "login", pendingFiles = [], recognition = null;

  const show = id => {
    screens.forEach(s => $(s).classList.toggle("hidden", s !== id));
    $("sidebar")?.classList.remove("open");
  };

  function addMessage(text, role = "assistant", files = []) {
    $("chatWelcome").classList.add("hidden");
    const wrap = document.createElement("article");
    wrap.className = `message ${role}`;
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "assistant" ? "S" : "Y";
    const body = document.createElement("div");
    body.className = "message-body";
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = text;
    body.appendChild(content);
    files.forEach(file => {
      if (file.type?.startsWith("image/")) {
        const img = document.createElement("img");
        img.className = "generated-image";
        img.src = URL.createObjectURL(file);
        img.alt = file.name;
        body.appendChild(img);
      } else {
        const tag = document.createElement("div");
        tag.className = "file-chip";
        tag.textContent = `📎 ${file.name} (not sent to AI)`;
        body.appendChild(tag);
      }
    });
    wrap.append(avatar, body);
    $("messages").appendChild(wrap);
    $("messages").scrollTop = $("messages").scrollHeight;
    return wrap;
  }

  async function init() {
    try {
      const configResponse = await fetch("/api/config");
      const config = await configResponse.json();
      if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
        throw new Error("Supabase configuration is missing.");
      }
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      const { data } = await supabaseClient.auth.getSession();
      session = data.session;
      if (session) await enterApp();
      else show("welcomeScreen");
      const health = await fetch("/api/health").then(r => r.json()).catch(() => null);
      if (health?.aiEnabled) $("statusText").textContent = "AI assistant · Free model";
      else $("statusText").textContent = "AI connection needs setup";
    } catch (e) {
      console.error(e);
      show("welcomeScreen");
    } finally {
      $("bootScreen").classList.add("hidden");
    }
  }

  async function enterApp() {
    show("chatScreen");
    $("userEmail").textContent = session.user.email || "Signed in";
    await loadConversations();
    if (!currentConversation) await createConversation();
  }

  async function loadConversations() {
    const { data, error } = await supabaseClient.from("conversations")
      .select("*").order("updated_at", { ascending: false }).limit(60);
    if (error) {
      console.error(error);
      $("chatHistory").textContent = "Couldn't load chats. Check database permissions.";
      return;
    }
    conversations = data || [];
    renderHistory();
  }

  function renderHistory() {
    const list = $("chatHistory");
    list.replaceChildren();
    conversations.forEach(c => {
      const b = document.createElement("button");
      b.className = "history-item" + (c.id === currentConversation ? " selected" : "");
      b.textContent = c.title || "New conversation";
      b.onclick = () => openConversation(c.id);
      list.appendChild(b);
    });
  }

  async function createConversation() {
    const { data, error } = await supabaseClient.from("conversations")
      .insert({ user_id: session.user.id, title: "New conversation" }).select().single();
    if (error) {
      addMessage(`I couldn't create a chat: ${error.message}`);
      return;
    }
    conversations.unshift(data);
    currentConversation = data.id;
    renderHistory();
    $("messages").replaceChildren($("chatWelcome"));
    $("chatWelcome").classList.remove("hidden");
  }

  // UPDATED FUNCTION: opens and displays the selected saved conversation.
  async function openConversation(id) {
    currentConversation = id;
    renderHistory();

    const messagesBox = $("messages");
    messagesBox.replaceChildren();

    const loadingMessage = document.createElement("div");
    loadingMessage.className = "message assistant";
    loadingMessage.textContent = "Loading conversation...";
    messagesBox.appendChild(loadingMessage);

    try {
      const { data, error } = await supabaseClient
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Do not display results from an older request if another chat was selected.
      if (currentConversation !== id) return;

      messagesBox.replaceChildren();

      if (!data || data.length === 0) {
        messagesBox.appendChild($("chatWelcome"));
        $("chatWelcome").classList.remove("hidden");
      } else {
        data.forEach(message => {
          addMessage(message.content, message.role);
        });
      }

      messagesBox.scrollTop = messagesBox.scrollHeight;

    } catch (error) {
      console.error("Could not open conversation:", error);

      if (currentConversation === id) {
        messagesBox.replaceChildren();
        addMessage(`Couldn't load this chat: ${error.message || "Please try again."}`);
      }
    }
  }

  async function save(role, content) {
    const { error } = await supabaseClient.from("messages").insert({
      conversation_id: currentConversation,
      user_id: session.user.id,
      role,
      content
    });
    if (error) throw error;
    await supabaseClient.from("conversations")
      .update({ updated_at: new Date().toISOString() }).eq("id", currentConversation);
  }

  async function getRecentHistory() {
    const { data, error } = await supabaseClient.from("messages")
      .select("role,content").eq("conversation_id", currentConversation)
      .order("created_at", { ascending: false }).limit(10);
    if (error) throw error;
    return (data || []).reverse()
      .filter(m => ["user", "assistant"].includes(m.role))
      .map(m => ({ role: m.role, content: m.content }));
  }

  async function send() {
    const text = $("prompt").value.trim();
    if (!text && !pendingFiles.length) return;
    if (!session) return addMessage("Please sign in again to continue.");
    if (!currentConversation) await createConversation();

    const files = [...pendingFiles];
    pendingFiles = [];
    renderFiles();
    const userText = text || "I attached a file, but it is not being sent for analysis yet.";
    addMessage(userText, "user", files);
    $("prompt").value = "";
    resize();
    $("sendButton").disabled = true;

    try {
      await save("user", userText);

      if (!text) {
        const note = "I can see that you selected a file, but file and image analysis aren't enabled in this version of Sky yet. Please type a question for me, or describe the file.";
        addMessage(note);
        await save("assistant", note);
      } else {
        const history = await getRecentHistory();
        // Remove the current prompt from history because the server adds it itself.
        if (history.length && history[history.length - 1].role === "user") history.pop();

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ prompt: text, history })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Sky couldn't get an AI response.");
        addMessage(result.reply);
        await save("assistant", result.reply);
      }

      const convo = conversations.find(c => c.id === currentConversation);
      if (convo?.title === "New conversation") {
        await supabaseClient.from("conversations")
          .update({ title: userText.slice(0, 42), updated_at: new Date().toISOString() })
          .eq("id", currentConversation);
      }
      await loadConversations();
    } catch (e) {
      console.error(e);
      addMessage(`Sky couldn't complete that request: ${e.message}`);
    } finally {
      $("sendButton").disabled = false;
      $("prompt").focus();
    }
  }

  function renderFiles() {
    const box = $("attachmentPreview");
    box.replaceChildren();
    pendingFiles.forEach((f, i) => {
      const chip = document.createElement("span");
      chip.className = "file-chip";
      chip.textContent = f.name + " ";
      const x = document.createElement("button");
      x.textContent = "×";
      x.onclick = () => { pendingFiles.splice(i, 1); renderFiles(); };
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  function resize() {
    const p = $("prompt");
    p.style.height = "auto";
    p.style.height = Math.min(p.scrollHeight, 150) + "px";
  }

  function voice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      addMessage("Voice typing isn't supported in this browser. You can still type your message.");
      return;
    }
    if (recognition) {
      recognition.stop();
      recognition = null;
      $("voiceButton").classList.remove("recording");
      return;
    }
    recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    $("voiceButton").classList.add("recording");
    recognition.onresult = e => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      $("prompt").value = t;
      resize();
    };
    recognition.onerror = () => {
      $("voiceButton").classList.remove("recording");
      recognition = null;
    };
    recognition.onend = () => {
      $("voiceButton").classList.remove("recording");
      recognition = null;
    };
    recognition.start();
  }

  $("year").textContent = new Date().getFullYear();
  $("loginNav").onclick = $("welcomeLoginButton").onclick = () => setAuth("login");
  $("signupNav").onclick = $("getStartedButton").onclick = () => setAuth("signup");
  $("backHomeButton").onclick = () => show("welcomeScreen");

  function setAuth(mode) {
    authMode = mode;
    $("authTitle").textContent = mode === "login" ? "Welcome back" : "Create your Sky account";
    $("authDescription").textContent = mode === "login"
      ? "Sign in to continue your conversations."
      : "Create an account to start using Sky.";
    $("authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
    $("authSwitchText").textContent = mode === "login" ? "New to Sky?" : "Already have an account?";
    $("authSwitchButton").textContent = mode === "login" ? "Create an account" : "Log in";
    $("authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
    $("authMessage").textContent = "";
    show("authScreen");
  }

  $("authSwitchButton").onclick = () => setAuth(authMode === "login" ? "signup" : "login");
  $("authForm").onsubmit = async e => {
    e.preventDefault();
    $("authSubmit").disabled = true;
    $("authMessage").textContent = "Please wait…";
    try {
      const email = $("authEmail").value.trim();
      const password = $("authPassword").value;
      const result = authMode === "signup"
        ? await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
        : await supabaseClient.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (authMode === "signup" && !result.data.session) {
        $("authMessage").textContent = "Check your email to confirm your account, then log in.";
        return;
      }
      session = result.data.session;
      await enterApp();
    } catch (error) {
      $("authMessage").textContent = error.message || "Unable to sign in. Please try again.";
    } finally {
      $("authSubmit").disabled = false;
    }
  };

  $("logoutButton").onclick = async () => {
    await supabaseClient.auth.signOut();
    session = null;
    currentConversation = null;
    show("welcomeScreen");
  };
  $("newChatButton").onclick = createConversation;
  $("chatForm").onsubmit = e => { e.preventDefault(); send(); };
  $("prompt").addEventListener("input", resize);
  $("prompt").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("attachButton").onclick = () => $("fileInput").click();
  $("fileInput").onchange = e => {
    pendingFiles = [...pendingFiles, ...Array.from(e.target.files)].slice(0, 5);
    renderFiles();
    e.target.value = "";
  };
  $("voiceButton").onclick = voice;
  $("openSidebar").onclick = () => $("sidebar").classList.add("open");
  $("closeSidebar").onclick = () => $("sidebar").classList.remove("open");
  document.querySelectorAll(".suggestion").forEach(b => b.onclick = () => {
    $("prompt").value = b.dataset.prompt;
    send();
  });

  init();
})();
