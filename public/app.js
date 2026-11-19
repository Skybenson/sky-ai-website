
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

  // Routine Builder state
  let routines = [];
  let selectedRoutineId = null;
  let routineItems = [];
  let routineLogs = {};

  const show = id => {
    screens.forEach(screen => {
      const element = $(screen);
      if (element) element.classList.toggle("hidden", screen !== id);
    });
    $("sidebar")?.classList.remove("open");
  };

  function showWorkspace(workspace) {
    const chat = $("chatWorkspace");
    const routine = $("routineWorkspace");

    if (chat) chat.classList.toggle("hidden", workspace !== "chat");
    if (routine) routine.classList.toggle("hidden", workspace !== "routine");

    $("chatTabButton")?.classList.toggle("active", workspace === "chat");
    $("routineTabButton")?.classList.toggle("active", workspace === "routine");

    if (workspace === "routine") loadRoutines();

    $("sidebar")?.classList.remove("open");
  }

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

  function localDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function tomorrowDate() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return localDate(date);
  }

  function showRoutineMessage(message, isError = false) {
    const element = $("routineGenerateMessage");
    if (!element) return;

    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  // ---------- ROUTINE BUILDER ----------

  async function loadRoutines() {
    if (!session || !supabaseClient) return;

    const list = $("routineList");

    if (list) {
      list.replaceChildren();
      const loading = document.createElement("p");
      loading.className = "routine-empty";
      loading.textContent = "Loading your routines...";
      list.appendChild(loading);
    }

    const { data, error } = await supabaseClient
      .from("routines")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Routine loading error:", error);

      if (list) {
        list.replaceChildren();
        const message = document.createElement("p");
        message.className = "routine-empty";
        message.textContent = "Couldn't load routines: " + error.message;
        list.appendChild(message);
      }
      return;
    }

    routines = data || [];
    renderRoutines();

    if (selectedRoutineId && routines.some(r => r.id === selectedRoutineId)) {
      await selectRoutine(selectedRoutineId);
    } else if (routines.length) {
      await selectRoutine(routines[0].id);
    } else {
      selectedRoutineId = null;
      routineItems = [];
      routineLogs = {};
      renderRoutineActivities();
    }
  }

  function renderRoutines() {
    const list = $("routineList");
    if (!list) return;

    list.replaceChildren();

    if (!routines.length) {
      const empty = document.createElement("p");
      empty.className = "routine-empty";
      empty.textContent =
        "You haven't created a routine yet. Describe what you want above to build your first one.";
      list.appendChild(empty);
      return;
    }

    routines.forEach(routine => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "routine-card";

      if (routine.id === selectedRoutineId) {
        card.classList.add("selected");
      }

      const title = document.createElement("strong");
      title.textContent = routine.title || "Untitled routine";

      const description = document.createElement("span");
      description.textContent = routine.description || "Your personal routine";

      card.append(title, description);
      card.onclick = () => selectRoutine(routine.id);

      list.appendChild(card);
    });
  }

  async function selectRoutine(id) {
    if (!session || !supabaseClient || !id) return;

    selectedRoutineId = id;
    renderRoutines();

    const titleElement = $("selectedRoutineTitle");
    if (titleElement) {
      const selected = routines.find(r => r.id === id);
      titleElement.textContent = selected?.title || "Your routine";
    }

    const activityBox = $("routineActivities");

    if (activityBox) {
      activityBox.replaceChildren();
      const loading = document.createElement("p");
      loading.className = "routine-empty";
      loading.textContent = "Loading activities...";
      activityBox.appendChild(loading);
    }

    const { data, error } = await supabaseClient
      .from("routine_items")
      .select("*")
      .eq("routine_id", id)
      .eq("user_id", session.user.id)
      .order("position", { ascending: true });

    if (error) {
      console.error("Routine activities error:", error);

      if (activityBox) {
        activityBox.replaceChildren();
        const message = document.createElement("p");
        message.className = "routine-empty";
        message.textContent = "Couldn't load activities: " + error.message;
        activityBox.appendChild(message);
      }
      return;
    }

    routineItems = data || [];
    routineLogs = {};

    if (routineItems.length) {
      const itemIds = routineItems.map(item => item.id);

      const { data: logs, error: logError } = await supabaseClient
        .from("routine_item_logs")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("scheduled_date", localDate())
        .in("routine_item_id", itemIds);

      if (logError) {
        console.error("Routine progress loading error:", logError);
      } else {
        (logs || []).forEach(log => {
          routineLogs[log.routine_item_id] = log;
        });
      }
    }

    renderRoutineActivities();
  }

  function renderRoutineActivities() {
    const box = $("routineActivities");
    if (!box) return;

    box.replaceChildren();

    const total = routineItems.length;
    const completed = routineItems.filter(item =>
      routineLogs[item.id]?.status === "completed"
    ).length;

    if ($("routineProgressText")) {
      $("routineProgressText").textContent =
        `${completed} of ${total} activities completed today`;
    }

    if ($("routineProgressBar")) {
      const percentage = total ? (completed / total) * 100 : 0;
      $("routineProgressBar").style.width = `${percentage}%`;
    }

    if (!selectedRoutineId || !total) {
      const empty = document.createElement("p");
      empty.className = "routine-empty";
      empty.textContent = selectedRoutineId
        ? "This routine has no activities yet. Add your first activity."
        : "Select a routine or create a new one to get started.";
      box.appendChild(empty);
      return;
    }

    routineItems.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "routine-activity";

      const details = document.createElement("div");
      details.className = "routine-activity-details";

      const heading = document.createElement("strong");
      heading.textContent = item.title;

      const time = document.createElement("span");
      time.textContent = item.scheduled_time
        ? item.scheduled_time.slice(0, 5)
        : "No time set";

      const description = document.createElement("p");
      description.textContent = item.description || "";

      const log = routineLogs[item.id];

      const status = document.createElement("span");
      status.className = "routine-activity-status";
      status.textContent = log?.status
        ? log.status.charAt(0).toUpperCase() + log.status.slice(1)
        : "Pending";

      if (log?.status) status.dataset.status = log.status;

      details.append(heading, time, description, status);

      const actions = document.createElement("div");
      actions.className = "routine-activity-actions";

      actions.append(
        makeRoutineButton("Complete", () => updateRoutineStatus(item, "completed")),
        makeRoutineButton("Skip", () => updateRoutineStatus(item, "skipped")),
        makeRoutineButton("Postpone", () => postponeRoutineItem(item))
      );

      actions.append(
        makeRoutineButton("Edit", () => editRoutineItem(item)),
        makeRoutineButton("Move up", () => moveRoutineItem(index, -1), index === 0),
        makeRoutineButton("Move down", () => moveRoutineItem(index, 1), index === total - 1),
        makeRoutineButton("Delete", () => deleteRoutineItem(item))
      );

      card.append(details, actions);
      box.appendChild(card);
    });
  }

  function makeRoutineButton(label, action, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "routine-action-button";
    button.textContent = label;
    button.disabled = disabled;
    button.onclick = action;
    return button;
  }

  async function createRoutineFromDescription(description) {
    if (!session) throw new Error("Please sign in again.");

    const response = await fetch("/api/routines/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ description })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "Sky couldn't generate your routine.");
    }

    const generated = result.routine;

    if (
      !generated ||
      !generated.title ||
      !Array.isArray(generated.items) ||
      !generated.items.length
    ) {
      throw new Error("Sky returned an incomplete routine. Please try again.");
    }

    const { data: savedRoutine, error: routineError } = await supabaseClient
      .from("routines")
      .insert({
        user_id: session.user.id,
        title: generated.title,
        description: generated.description || description,
        is_active: true
      })
      .select()
      .single();

    if (routineError) throw routineError;

    const items = generated.items.map((item, index) => ({
      routine_id: savedRoutine.id,
      user_id: session.user.id,
      title: item.title || `Activity ${index + 1}`,
      description: item.description || "",
      scheduled_time: item.scheduled_time || null,
      position: index
    }));

    const { error: itemsError } = await supabaseClient
      .from("routine_items")
      .insert(items);

    if (itemsError) {
      await supabaseClient
        .from("routines")
        .delete()
        .eq("id", savedRoutine.id)
        .eq("user_id", session.user.id);

      throw itemsError;
    }

    selectedRoutineId = savedRoutine.id;
    await loadRoutines();

    return savedRoutine;
  }

  async function generateRoutineFromForm() {
    const description = $("routineDescription")?.value.trim();

    if (!description) {
      showRoutineMessage(
        "Just type something simple, like Workout routine or Morning routine.",
        true
      );
      return;
    }

    const button = $("generateRoutineButton");
    if (button) button.disabled = true;

    showRoutineMessage("Sky is building your routine...");

    try {
      const routine = await createRoutineFromDescription(description);

      if ($("routineDescription")) {
        $("routineDescription").value = "";
      }

      showRoutineMessage(`"${routine.title}" has been created and saved.`);
    } catch (error) {
      console.error("Routine generation error:", error);
      showRoutineMessage(error.message || "Couldn't create your routine.", true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function updateRoutineStatus(item, status) {
    if (!session) return;

    const payload = {
      routine_item_id: item.id,
      user_id: session.user.id,
      scheduled_date: localDate(),
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
      postponed_to: null
    };

    const { error } = await supabaseClient
      .from("routine_item_logs")
      .upsert(payload, {
        onConflict: "routine_item_id,scheduled_date"
      });

    if (error) {
      console.error("Routine status update error:", error);
      showRoutineMessage("Couldn't update activity: " + error.message, true);
      return;
    }

    await selectRoutine(selectedRoutineId);
  }

  async function postponeRoutineItem(item) {
    const date = window.prompt(
      "What date should this activity be postponed to? Use YYYY-MM-DD.",
      tomorrowDate()
    );

    if (date === null) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= localDate()) {
      showRoutineMessage("Please enter a future date in YYYY-MM-DD format.", true);
      return;
    }

    const payload = {
      routine_item_id: item.id,
      user_id: session.user.id,
      scheduled_date: localDate(),
      status: "postponed",
      postponed_to: date,
      completed_at: null
    };

    const { error } = await supabaseClient
      .from("routine_item_logs")
      .upsert(payload, {
        onConflict: "routine_item_id,scheduled_date"
      });

    if (error) {
      showRoutineMessage("Couldn't postpone activity: " + error.message, true);
      return;
    }

    await selectRoutine(selectedRoutineId);
  }

  async function addRoutineActivity() {
    if (!selectedRoutineId) {
      showRoutineMessage("Please select a routine first.", true);
      return;
    }

    const title = window.prompt("What is the activity called?");
    if (!title?.trim()) return;

    const description =
      window.prompt("Add a short description (optional).", "") || "";

    const timeInput = window.prompt(
      "What time? Use 24-hour format HH:MM, or leave blank.",
      ""
    );

    let time = null;

    if (timeInput?.trim()) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeInput.trim())) {
        showRoutineMessage("Please enter the time in HH:MM format.", true);
        return;
      }
      time = timeInput.trim();
    }

    const { error } = await supabaseClient
      .from("routine_items")
      .insert({
        routine_id: selectedRoutineId,
        user_id: session.user.id,
        title: title.trim(),
        description: description.trim(),
        scheduled_time: time,
        position: routineItems.length
      });

    if (error) {
      showRoutineMessage("Couldn't add activity: " + error.message, true);
      return;
    }

    await selectRoutine(selectedRoutineId);
  }

  async function editRoutineItem(item) {
    const title = window.prompt("Edit activity name:", item.title);
    if (!title?.trim()) return;

    const description = window.prompt(
      "Edit activity description:",
      item.description || ""
    );

    if (description === null) return;

    const oldTime = item.scheduled_time
      ? item.scheduled_time.slice(0, 5)
      : "";

    const timeInput = window.prompt(
      "Edit time (HH:MM), or leave blank:",
      oldTime
    );

    if (timeInput === null) return;

    let time = null;

    if (timeInput.trim()) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeInput.trim())) {
        showRoutineMessage("Please enter the time in HH:MM format.", true);
        return;
      }
      time = timeInput.trim();
    }

    const { error } = await supabaseClient
      .from("routine_items")
      .update({
        title: title.trim(),
        description: description.trim(),
        scheduled_time: time
      })
      .eq("id", item.id)
      .eq("user_id", session.user.id);

    if (error) {
      showRoutineMessage("Couldn't edit activity: " + error.message, true);
      return;
    }

    await selectRoutine(selectedRoutineId);
  }

  async function deleteRoutineItem(item) {
    if (!window.confirm(`Delete "${item.title}" from this routine?`)) return;

    const { error } = await supabaseClient
      .from("routine_items")
      .delete()
      .eq("id", item.id)
      .eq("user_id", session.user.id);

    if (error) {
      showRoutineMessage("Couldn't delete activity: " + error.message, true);
      return;
    }

    await selectRoutine(selectedRoutineId);
  }

  async function moveRoutineItem(index, direction) {
    const otherIndex = index + direction;

    if (otherIndex < 0 || otherIndex >= routineItems.length) return;

    const first = routineItems[index];
    const second = routineItems[otherIndex];

    const firstUpdate = await supabaseClient
      .from("routine_items")
      .update({ position: second.position })
      .eq("id", first.id)
      .eq("user_id", session.user.id);

    if (firstUpdate.error) {
      showRoutineMessage(
        "Couldn't reorder activities: " + firstUpdate.error.message,
        true
      );
      return;
    }

    const secondUpdate = await supabaseClient
      .from("routine_items")
      .update({ position: first.position })
      .eq("id", second.id)
      .eq("user_id", session.user.id);

    if (secondUpdate.error) {
      showRoutineMessage(
        "Couldn't finish reordering: " + secondUpdate.error.message,
        true
      );
    }

    await selectRoutine(selectedRoutineId);
  }

  async function editSelectedRoutine() {
    const routine = routines.find(item => item.id === selectedRoutineId);
    if (!routine) return;

    const title = window.prompt("Routine name:", routine.title);
    if (!title?.trim()) return;

    const description = window.prompt(
      "Routine description:",
      routine.description || ""
    );

    if (description === null) return;

    const { error } = await supabaseClient
      .from("routines")
      .update({
        title: title.trim(),
        description: description.trim(),
        updated_at: new Date().toISOString()
      })
      .eq("id", routine.id)
      .eq("user_id", session.user.id);

    if (error) {
      showRoutineMessage("Couldn't update routine: " + error.message, true);
      return;
    }

    await loadRoutines();
  }

  // Recognize short and detailed routine requests in normal chat.
  function isRoutineRequest(text) {
    const request = text.trim().toLowerCase();

    const shortRequests =
      /^(?:please\s+)?(?:workout|fitness|gym|morning|evening|night|daily|study|exercise|weight loss|reading)\s+(?:routine|plan|schedule)$/i;

    const directRequests =
      /\b(create|make|build|generate|design|plan|give me|suggest)\b[\s\S]{0,120}\b(routine|workout|fitness plan|daily schedule|study plan|morning routine|evening routine)\b/i;

    const wantRequests =
      /\b(i want|i need|help me create|help me make)\b[\s\S]{0,100}\b(routine|workout plan|fitness plan|study plan|daily schedule|morning routine|evening routine)\b/i;

    return (
      shortRequests.test(request) ||
      directRequests.test(request) ||
      wantRequests.test(request)
    );
  }

  function routineChatReply(routine) {
    const lines = routineItems.map(item => {
      const time = item.scheduled_time
        ? ` — ${item.scheduled_time.slice(0, 5)}`
        : "";

      return `• ${item.title}${time}`;
    });

    return `I've created and saved your routine, "${routine.title}".\n\nYou can find it in the Routine Builder tab, where you can edit activities, change their order, and track your progress.\n\n${lines.join("\n")}`;
  }

  // ---------- EXISTING SKY APP ----------

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
    showWorkspace("chat");

    if ($("userEmail")) {
      $("userEmail").textContent = session.user.email || "Signed in";
    }

    currentConversation = null;
    await loadConversations();
    await loadRoutines();

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
      button.onclick = () => openConversation(conversation.id);

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
    showWorkspace("chat");
  }

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

      if (error) throw error;

      if (
        requestNumber !== conversationLoadNumber ||
        currentConversation !== id
      ) return;

      messagesBox.replaceChildren();

      if (!data || data.length === 0) {
        showWelcomeMessage();
        return;
      }

      data.forEach(message => {
        if (["user", "assistant"].includes(message.role)) {
          addMessage(message.content, message.role);
        }
      });

      messagesBox.scrollTop = messagesBox.scrollHeight;

    } catch (error) {
      console.error("Chat history loading error:", error);

      if (
        requestNumber !== conversationLoadNumber ||
        currentConversation !== id
      ) return;

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
      .update({ updated_at: new Date().toISOString() })
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
      .filter(message => ["user", "assistant"].includes(message.role))
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

    if (!currentConversation) await createConversation();
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

      } else if (isRoutineRequest(text)) {
        const routine = await createRoutineFromDescription(text);

        if (currentConversation !== conversationAtSend) return;

        const reply = routineChatReply(routine);
        addMessage(reply);
        await save("assistant", reply);

      } else {
        const history = await getRecentHistory();

        if (history.length && history[history.length - 1].role === "user") {
          history.pop();
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ prompt: text, history })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || "Sky couldn't get an AI response.");
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
    prompt.style.height = Math.min(prompt.scrollHeight, 150) + "px";
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

  // ---------- EXISTING BUTTONS AND EVENTS ----------

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
      mode === "login" ? "Welcome back" : "Create your Sky account";

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
            options: { emailRedirectTo: location.origin }
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
    routines = [];
    routineItems = [];
    routineLogs = {};
    selectedRoutineId = null;
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

  // ---------- ROUTINE BUILDER BUTTONS ----------

  $("chatTabButton")?.addEventListener("click", () => {
    showWorkspace("chat");
  });

  $("routineTabButton")?.addEventListener("click", () => {
    showWorkspace("routine");
  });

  $("routineOpenSidebar")?.addEventListener("click", () => {
    showWorkspace("routine");
  });

  $("generateRoutineButton")?.addEventListener(
    "click",
    generateRoutineFromForm
  );

  $("newRoutineButton")?.addEventListener("click", () => {
    showWorkspace("routine");

    if ($("routineDescription")) {
      $("routineDescription").value = "";
      $("routineDescription").focus();
    }

    showRoutineMessage(
      "Just type something simple, like Workout routine or Morning routine."
    );
  });

  $("addRoutineActivityButton")?.addEventListener(
    "click",
    addRoutineActivity
  );

  $("editRoutineButton")?.addEventListener(
    "click",
    editSelectedRoutine
  );

  document.querySelectorAll(".suggestion").forEach(button => {
    button.onclick = () => {
      $("prompt").value = button.dataset.prompt;
      send();
    };
  });

  init();
})();
