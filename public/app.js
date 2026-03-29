const sessionStorageKey = "cf-ai-app-session-id";
const sessionId = getSessionId();

const state = {
  hydratedProfile: false,
  loading: false,
  bootstrapped: false
};

const profileForm = document.querySelector("#profile-form");
const planForm = document.querySelector("#plan-form");
const chatForm = document.querySelector("#chat-form");
const resetButton = document.querySelector("#reset-button");
const messageInput = document.querySelector("#message");
const planTopicInput = document.querySelector("#planTopic");
const subjectInput = document.querySelector("#subject");
const learningGoalInput = document.querySelector("#learningGoal");
const studyWindowInput = document.querySelector("#studyWindow");
const messageList = document.querySelector("#message-list");
const planList = document.querySelector("#plan-list");
const workflowStatusText = document.querySelector("#workflow-status-text");
const helperText = document.querySelector("#helper-text");
const seedButtons = Array.from(document.querySelectorAll(".chip"));

function getSessionId() {
  const saved = localStorage.getItem(sessionStorageKey);
  if (saved) {
    return saved;
  }

  const next = `app-${crypto.randomUUID()}`;
  localStorage.setItem(sessionStorageKey, next);
  return next;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-session-id": sessionId,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || "Request failed");
  }

  return response.json();
}

function setHelperText(text) {
  helperText.textContent = text;
}

function renderMessages(messages) {
  messageList.replaceChildren();

  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No messages yet. Ask for a recap, quiz, or checklist.";
    messageList.append(empty);
    return;
  }

  for (const message of messages) {
    const item = document.createElement("article");
    item.className = `message message-${message.role}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = `${message.role === "assistant" ? "Assistant" : "You"} - ${new Date(
      message.createdAt
    ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

    const body = document.createElement("p");
    body.className = "message-body";
    body.textContent = message.content;

    item.append(meta, body);
    messageList.append(item);
  }

  messageList.scrollTop = messageList.scrollHeight;
}

function renderPlans(plans) {
  planList.replaceChildren();

  if (!plans.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No plan yet. Start one for a focused session.";
    planList.append(empty);
    return;
  }

  for (const plan of plans) {
    const card = document.createElement("article");
    card.className = "plan-card";

    const heading = document.createElement("div");
    heading.className = "plan-heading";

    const title = document.createElement("h3");
    title.textContent = plan.topic;

    const stamp = document.createElement("span");
    stamp.textContent = new Date(plan.createdAt).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });

    heading.append(title, stamp);

    const body = document.createElement("pre");
    body.className = "plan-body";
    body.textContent = plan.content;

    card.append(heading, body);
    planList.append(card);
  }
}

function renderStatus(agentState) {
  const labelMap = {
    idle: "Idle",
    running: agentState.workflowMessage || "Running.",
    complete: agentState.workflowMessage || "Plan ready.",
    error: agentState.workflowMessage || "Request failed."
  };

  workflowStatusText.textContent = labelMap[agentState.workflowStatus] || "Idle";
}

function hydrateProfile(agentState) {
  if (state.hydratedProfile) {
    return;
  }

  subjectInput.value = agentState.profile.subject || "";
  learningGoalInput.value = agentState.profile.learningGoal || "";
  studyWindowInput.value = agentState.profile.studyWindow || "";
  if (!planTopicInput.value && agentState.profile.subject) {
    planTopicInput.value = agentState.profile.subject;
  }
  state.hydratedProfile = true;
}

async function loadApp() {
  const data = await request("/api/bootstrap", { method: "GET", headers: {} });
  hydrateProfile(data.state);
  renderMessages(data.messages);
  renderPlans(data.plans);
  renderStatus(data.state);
  if (!state.bootstrapped) {
    setHelperText(`Session id: ${sessionId.slice(0, 16)}`);
    state.bootstrapped = true;
  }
}

async function saveProfile() {
  const profile = {
    subject: subjectInput.value,
    learningGoal: learningGoalInput.value,
    studyWindow: studyWindowInput.value
  };

  const nextState = await request("/api/profile", {
    method: "POST",
    body: JSON.stringify(profile)
  });

  renderStatus(nextState);
  if (!planTopicInput.value && profile.subject) {
    planTopicInput.value = profile.subject;
  }
}

async function sendMessage() {
  if (state.loading) {
    return;
  }

  const message = messageInput.value.trim();
  if (!message) {
    setHelperText("Type a message first.");
    return;
  }

  state.loading = true;
  setHelperText("Saving details. Sending message.");

  try {
    await saveProfile();
    messageInput.value = "";

    await request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message })
    });

    await loadApp();
    setHelperText("Reply ready.");
  } catch (error) {
    setHelperText(error.message || "Send failed.");
  } finally {
    state.loading = false;
  }
}

async function buildPlan() {
  setHelperText("Saving details. Starting plan.");

  try {
    await saveProfile();
    await request("/api/plan", {
      method: "POST",
      body: JSON.stringify({ topic: planTopicInput.value.trim() })
    });
    await loadApp();
    setHelperText("Plan run started.");
  } catch (error) {
    setHelperText(error.message || "Plan start failed.");
  }
}

async function resetSession() {
  if (!confirm("Clear this learning session?")) {
    return;
  }

  state.hydratedProfile = false;
  await request("/api/reset", {
    method: "POST",
    body: JSON.stringify({})
  });
  await loadApp();
  setHelperText("Session cleared.");
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await saveProfile();
    setHelperText("Details saved.");
  } catch (error) {
    setHelperText(error.message || "Save failed.");
  }
});

planForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await buildPlan();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage();
});

resetButton.addEventListener("click", async () => {
  await resetSession();
});

seedButtons.forEach((button) => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.seed || "";
    messageInput.focus();
  });
});

setInterval(() => {
  loadApp().catch(() => {
    setHelperText("Waiting for app response.");
  });
}, 6000);

loadApp().catch(() => {
  setHelperText("App load failed.");
});
