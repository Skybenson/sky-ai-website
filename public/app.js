
(() => {
  const $ = id => document.getElementById(id);

  const screens = ["welcomeScreen", "authScreen", "chatScreen"];

  let supabaseClient = null;
  let session = null;
  let currentConversation = null;
  let conversations = [];
  let authMode = "login";
  let pendingFiles = [];
  let recognition = null;
  let conversationLoadNumber = 0;

  const show = id => {
    screens.forEach(screen => {
      const element = $(screen);
      if (element) element.classList.toggle("hidden", screen !== id);
    });
    $("sidebar")?.classList.remove("open");
  };

  function addMessage(text, role = "assistant", files = []) {
    const messagesBox = $("messages");
    if (!messagesBox) return;

    $("chatWelcome")?.classList.add("hidden");

    const wrap = document.createElement("article");
    wrap.className = `message ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "assistant" ? "S" : "Y";

    const body = document.createElement("div");
    body.className = "message-body";

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = text ?? "";

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
    messagesBox.appendChild(wrap);
    messagesBox.scrollTop = messagesBox.scrollHeight;

    return wrap;
  }

  function showWelcomeMessage() {
    const messagesBox = $("messages");
    const welcome = $("chatWelcome");

    if (!messagesBox || !welcome) return;

    messagesBox.replaceChildren(welcome);
    welcome.classList.remove("hidden");
  }

  async function init() {
    try {
      const configResponse = await fetch("/api/config");

      if (!configResponse.ok) {
        throw new Error("Could not load Sky configuration.");
      }

      const config = await configResponse.json();

      if (
        !config.supabaseUrl ||
        !config.supabaseAnonKey ||
        !window.supabase
      ) {
        throw new Error("Supabase configuration is missing.");
      }

      supabaseClient = window.supabase.createClient(
        config.supabaseUrl,
        config.supabaseAnonKey
      );

      const { data, error } = await supabaseClient.auth.getSession();

      if (error) throw error;

      session = data.session;

      if (session) {
        await enterApp();
      } else {
        show("welcomeScreen");
      }

      const health = await fetch("/api/health")
        .then(response => response.json())
        .catch(() => null);

      if ($("statusText")) {
        $("statusText").textContent = health?.aiEnabled
          ? "AI assistant · Free model"
          : "AI connection needs setup";
      }

    } catch (error) {
      console.error("Sky initialization error:", error);
      show("welcomeScreen");
    } finally {
      $("bootScreen")?.classList.add("hidden");
    }
  }

  async function enterApp() {
    if (!session) return;

    show("chatScreen");

    if ($("userEmail")) {
      $("userEmail").textContent = session.user.email || "Signed in";
    }

    currentConversation = null;
    await loadConversations();

    if (!currentConversation && conversations.length > 0) {
      await openConversation(conversations[0].id);
    } else if (!currentConversation && conversations.length === 0) {
      await createConversation();
    }
  }

  async function loadConversations() {
    if (!session || !supabaseClient) return;

    const { data, error } = await supabaseClient
      .from("conversations")
      .select("*")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false })
      .limit(60);

    if (error) {
      console.error("Conversation list error:", error);

      if ($("chatHistory")) {
        $("chatHistory").textContent =
          "Couldn't load chats: " + error.message;
      }

      return;
    }

    conversations = data || [];
    renderHistory();
  }

  function renderHistory() {
    const list = $("chatHistory");
    if (!list) return;

    list.replaceChildren();

    conversations.forEach(conversation => {
      const button = document.createElement("button");

      button.className =
        "history-item" +
        (conversation.id === currentConversation ? " selected" : "");

      button.textContent = conversation.title || "New conversation";

      button.type = "button";

      button.onclick = () => {
        openConversation(conversation.id);
      };

      list.appendChild(button);
    });
  }

  async function createConversation() {
    if (!session || !supabaseClient) return;

    const { data, error } = await supabaseClient
      .from("conversations")
      .insert({
        user_id: session.user.id,
        title: "New conversation"
      })
      .select()
      .single();

    if (error) {
      console.error("Create conversation error:", error);
      addMessage(`I couldn't create a chat: ${error.message}`);
      return;
    }

    conversations.unshift(data);
    currentConversation = data.id;

    conversationLoadNumber++;

    renderHistory();
    showWelcomeMessage();
  }

  // Improved chat-history loading.
  async function openConversation(id) {
    if (!session || !supabaseClient || !id) return;

    const requestNumber = ++conversationLoadNumber;

    currentConversation = id;
    renderHistory();

    const messagesBox = $("messages");
    if (!messagesBox) return;

    messagesBox.replaceChildren();

    const loading = document.createElement("div");
    loading.className = "message assistant";

    const loadingText = document.createElement("div");
    loadingText.className = "message-content";
    loadingText.textContent = "Loading your conversation...";

    loading.appendChild(loadingText);
    messagesBox.appendChild(loading);

    try {
      const { data, error } = await supabaseClient
        .from("messages")
        .select("id, conversation_id, user_id, role, content, created_at")
        .eq("conversation_id", id)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      // Ignore an older request if another chat was selected.
      if (
        requestNumber !== conversationLoadNumber ||
        currentConversation !== id
      ) {
        return;
      }

      messagesBox.replaceChildren();

      if (!data || data.length === 0) {
        showWelcomeMessage();
        return;
      }

      data.forEach(message => {
        if (
          message.role === "user" ||
          message.role === "assistant"
        ) {
          addMessage(message.content, message.role);
        }
      });

      messagesBox.scrollTop = messagesBox.scrollHeight;

    } catch (error) {
      console.error("Chat history loading error:", error);

      if (
        requestNumber !== conversationLoadNumber ||
        currentConversation !== id
      ) {
        return;
      }

      messagesBox.replaceChildren();

      addMessage(
        `Couldn't load this conversation: ${error.message || "Please try again."}`
      );
    }
  }

  async function save(role, content) {
    if (!session || !currentConversation) {
      throw new Error("No active conversation. Please open a chat again.");
    }

    const { error } = await supabaseClient
      .from("messages")
      .insert({
        conversation_id: currentConversation,
        user_id: session.user.id,
        role,
        content
      });

    if (error) throw error;

    const { error: updateError } = await supabaseClient
      .from("conversations")
      .update({
        updated_at: new Date().toISOString()
      })
      .eq("id", currentConversation)
      .eq("user_id", session.user.id);

    if (updateError) {
      console.error("Conversation timestamp update error:", updateError);
    }
  }

  async function getRecentHistory() {
    const { data, error } = await supabaseClient
      .from("messages")
      .select("role, content")
      .eq("conversation_id", currentConversation)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;

    return (data || [])
      .reverse()
      .filter(message =>
        ["user", "assistant"].includes(message.role)
      )
      .map(message => ({
        role: message.role,
        content: message.content
      }));
  }

  async function send() {
    const text = $("prompt").value.trim();

    if (!text && !pendingFiles.length) return;

    if (!session) {
      addMessage("Please sign in again to continue.");
      return;
    }

    if (!currentConversation) {
      await createConversation();
    }

    if (!currentConversation) return;

    const conversationAtSend = currentConversation;

    const files = [...pendingFiles];
    pendingFiles = [];
    renderFiles();

    const userText =
      text || "I attached a file, but it is not being sent for analysis yet.";

    addMessage(userText, "user", files);

    $("prompt").value = "";
    resize();

    $("sendButton").disabled = true;

    try {
      await save("user", userText);

      if (!text) {
        const note =
          "I can see that you selected a file, but file and image analysis aren't enabled in this version of Sky yet. Please type a question for me, or describe the file.";

        addMessage(note);
        await save("assistant", note);

      } else {
        const history = await getRecentHistory();

        if (
          history.length &&
          history[history.length - 1].role === "user"
        ) {
          history.pop();
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            prompt: text,
            history
          })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            result.error || "Sky couldn't get an AI response."
          );
        }

        if (currentConversation !== conversationAtSend) return;

        addMessage(result.reply);
        await save("assistant", result.reply);
      }

      const conversation = conversations.find(
        item => item.id === conversationAtSend
      );

      if (conversation?.title === "New conversation") {
        const { error } = await supabaseClient
          .from("conversations")
          .update({
            title: userText.slice(0, 42),
            updated_at: new Date().toISOString()
          })
          .eq("id", conversationAtSend)
          .eq("user_id", session.user.id);

        if (error) console.error("Chat title update error:", error);
      }

      await loadConversations();

    } catch (error) {
      console.error("Sky send error:", error);

      if (currentConversation === conversationAtSend) {
        addMessage(`Sky couldn't complete that request: ${error.message}`);
      }

    } finally {
      $("sendButton").disabled = false;
      $("prompt").focus();
    }
  }

  function renderFiles() {
    const box = $("attachmentPreview");
    if (!box) return;

    box.replaceChildren();

    pendingFiles.forEach((file, index) => {
      const chip = document.createElement("span");
      chip.className = "file-chip";
      chip.textContent = file.name + " ";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";

      remove.onclick = () => {
        pendingFiles.splice(index, 1);
        renderFiles();
      };

      chip.appendChild(remove);
      box.appendChild(chip);
    });
  }

  function resize() {
    const prompt = $("prompt");
    if (!prompt) return;

    prompt.style.height = "auto";
    prompt.style.height =
      Math.min(prompt.scrollHeight, 150) + "px";
  }

  function voice() {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      addMessage(
        "Voice typing isn't supported in this browser. You can still type your message."
      );
      return;
    }

    if (recognition) {
      recognition.stop();
      recognition = null;
      $("voiceButton")?.classList.remove("recording");
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;

    $("voiceButton")?.classList.add("recording");

    recognition.onresult = event => {
      let text = "";

      for (
        let index = event.resultIndex;
        index < event.results.length;
        index++
      ) {
        text += event.results[index][0].transcript;
      }

      $("prompt").value = text;
      resize();
    };

    recognition.onerror = () => {
      $("voiceButton")?.classList.remove("recording");
      recognition = null;
    };

    recognition.onend = () => {
      $("voiceButton")?.classList.remove("recording");
      recognition = null;
    };

    recognition.start();
  }

  if ($("year")) {
    $("year").textContent = new Date().getFullYear();
  }

  $("loginNav").onclick =
    $("welcomeLoginButton").onclick = () => setAuth("login");

  $("signupNav").onclick =
    $("getStartedButton").onclick = () => setAuth("signup");

  $("backHomeButton").onclick = () => show("welcomeScreen");

  function setAuth(mode) {
    authMode = mode;

    $("authTitle").textContent =
      mode === "login"
        ? "Welcome back"
        : "Create your Sky account";

    $("authDescription").textContent =
      mode === "login"
        ? "Sign in to continue your conversations."
        : "Create an account to start using Sky.";

    $("authSubmit").textContent =
      mode === "login" ? "Log in" : "Create account";

    $("authSwitchText").textContent =
      mode === "login" ? "New to Sky?" : "Already have an account?";

    $("authSwitchButton").textContent =
      mode === "login" ? "Create an account" : "Log in";

    $("authPassword").autocomplete =
      mode === "login" ? "current-password" : "new-password";

    $("authMessage").textContent = "";

    show("authScreen");
  }

  $("authSwitchButton").onclick = () => {
    setAuth(authMode === "login" ? "signup" : "login");
  };

  $("authForm").onsubmit = async event => {
    event.preventDefault();

    $("authSubmit").disabled = true;
    $("authMessage").textContent = "Please wait…";

    try {
      const email = $("authEmail").value.trim();
      const password = $("authPassword").value;

      const result = authMode === "signup"
        ? await supabaseClient.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: location.origin
            }
          })
        : await supabaseClient.auth.signInWithPassword({
            email,
            password
          });

      if (result.error) throw result.error;

      if (authMode === "signup" && !result.data.session) {
        $("authMessage").textContent =
          "Check your email to confirm your account, then log in.";
        return;
      }

      session = result.data.session;
      await enterApp();

    } catch (error) {
      $("authMessage").textContent =
        error.message || "Unable to sign in. Please try again.";

    } finally {
      $("authSubmit").disabled = false;
    }
  };

  $("logoutButton").onclick = async () => {
    await supabaseClient.auth.signOut();

    session = null;
    currentConversation = null;
    conversations = [];
    conversationLoadNumber++;

    show("welcomeScreen");
  };

  $("newChatButton").onclick = createConversation;

  $("chatForm").onsubmit = event => {
    event.preventDefault();
    send();
  };

  $("prompt").addEventListener("input", resize);

  $("prompt").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  $("attachButton").onclick = () => {
    $("fileInput").click();
  };

  $("fileInput").onchange = event => {
    pendingFiles = [
      ...pendingFiles,
      ...Array.from(event.target.files)
    ].slice(0, 5);

    renderFiles();
    event.target.value = "";
  };

  $("voiceButton").onclick = voice;

  $("openSidebar").onclick = () => {
    $("sidebar").classList.add("open");
  };

  $("closeSidebar").onclick = () => {
    $("sidebar").classList.remove("open");
  };

  document.querySelectorAll(".suggestion").forEach(button => {
    button.onclick = () => {
      $("prompt").value = button.dataset.prompt;
      send();
    };
  });

  init();
})();
