import { Agent } from "agents";
import type {
  AiAppState,
  BootstrapPayload,
  ChatMessage,
  LearningPlan,
  LearnerProfile
} from "./types";

const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_STORED_MESSAGES = 24;

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type PlanRow = {
  id: string;
  topic: string;
  content: string;
  created_at: string;
};

type CountRow = {
  total: number;
};

type PlanWorkflowProgress = {
  step?: string;
  status?: "pending" | "running" | "complete" | "error";
  message?: string;
};

type StartPlanPayload = {
  topic: string;
  profile: LearnerProfile;
  recentMessages: ChatMessage[];
  latestPlan: string;
};

function createEmptyProfile(): LearnerProfile {
  return {
    subject: "",
    learningGoal: "",
    studyWindow: ""
  };
}

function createInitialState(): AiAppState {
  return {
    profile: createEmptyProfile(),
    activeWorkflowId: null,
    workflowStatus: "idle",
    workflowMessage: null,
    latestPlanId: null,
    lastPlanTopic: null,
    lastUpdatedAt: null,
    messageCount: 0
  };
}

function compactText(value: string, maxLength = 500): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function trimMessage(value: string, maxLength = 4_000): string {
  return value.trim().slice(0, maxLength);
}

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  };
}

function toLearningPlan(row: PlanRow): LearningPlan {
  return {
    id: row.id,
    topic: row.topic,
    content: row.content,
    createdAt: row.created_at
  };
}

function readAiResponse(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "response" in result &&
    typeof result.response === "string"
  ) {
    return result.response.trim();
  }

  throw new Error("Workers AI returned an unexpected response.");
}

function buildSystemPrompt(profile: LearnerProfile, latestPlan: string): string {
  const details = [
    profile.subject ? `Subject: ${profile.subject}` : "Subject: missing",
    profile.learningGoal ? `Goal: ${profile.learningGoal}` : "Goal: missing",
    profile.studyWindow ? `Time: ${profile.studyWindow}` : "Time: missing"
  ].join("\n");

  const savedPlan = latestPlan
    ? `Latest plan:\n${latestPlan.slice(0, 1_500)}`
    : "Latest plan: none";

  return [
    "You are the assistant for this Cloudflare AI app.",
    "Help one learner.",
    "Use short sentences.",
    "Use plain words.",
    "Give clear steps.",
    "If the learner asks for practice, give a short drill or checklist.",
    "If profile details are missing, ask one short follow-up.",
    "",
    details,
    "",
    savedPlan
  ].join("\n");
}

export class AiAppAgent extends Agent<Env, AiAppState> {
  initialState: AiAppState = createInitialState();

  #tablesReady = false;

  ensureTables() {
    if (this.#tablesReady) {
      return;
    }

    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `;

    this.#tablesReady = true;
  }

  listMessages(limit = 18): ChatMessage[] {
    this.ensureTables();
    const rows = this.sql<MessageRow>`
      SELECT id, role, content, created_at
      FROM messages
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return [...rows].reverse().map(toChatMessage);
  }

  listPlans(limit = 4): LearningPlan[] {
    this.ensureTables();
    const rows = this.sql<PlanRow>`
      SELECT id, topic, content, created_at
      FROM plans
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map(toLearningPlan);
  }

  getLatestPlanText(): string {
    const [latestPlan] = this.listPlans(1);
    return latestPlan?.content ?? "";
  }

  getMessageCount(): number {
    this.ensureTables();
    const [row] = this.sql<CountRow>`
      SELECT COUNT(*) AS total
      FROM messages
    `;

    return Number(row?.total ?? 0);
  }

  saveMessage(role: "user" | "assistant", content: string): ChatMessage {
    this.ensureTables();
    const createdAt = new Date().toISOString();
    const message = {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt
    } satisfies ChatMessage;

    this.sql`
      INSERT INTO messages (id, role, content, created_at)
      VALUES (${message.id}, ${message.role}, ${message.content}, ${message.createdAt})
    `;

    return message;
  }

  trimOldMessages() {
    this.ensureTables();
    const oldRows = this.sql<{ id: string }>`
      SELECT id
      FROM messages
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ${MAX_STORED_MESSAGES}
    `;

    for (const row of oldRows) {
      this.sql`
        DELETE FROM messages
        WHERE id = ${row.id}
      `;
    }
  }

  updateStoredState(partial: Partial<AiAppState>) {
    this.setState({
      ...this.state,
      ...partial,
      lastUpdatedAt: new Date().toISOString()
    });
  }

  async getBootstrap(): Promise<BootstrapPayload> {
    this.ensureTables();

    return {
      state: {
        ...this.state,
        messageCount: this.getMessageCount()
      },
      messages: this.listMessages(),
      plans: this.listPlans()
    };
  }

  async updateProfile(nextProfile: Partial<LearnerProfile>): Promise<AiAppState> {
    const profile = {
      subject: compactText(nextProfile.subject ?? this.state.profile.subject, 120),
      learningGoal: compactText(
        nextProfile.learningGoal ?? this.state.profile.learningGoal,
        220
      ),
      studyWindow: compactText(
        nextProfile.studyWindow ?? this.state.profile.studyWindow,
        120
      )
    };

    this.updateStoredState({ profile });
    return this.state;
  }

  async chat(rawMessage: string) {
    this.ensureTables();

    const message = trimMessage(rawMessage);
    if (!message) {
      throw new Error("Send a message first.");
    }

    this.saveMessage("user", message);

    const result = await this.env.AI.run(CHAT_MODEL, {
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(this.state.profile, this.getLatestPlanText())
        },
        ...this.listMessages(10).map((entry) => ({
          role: entry.role,
          content: entry.content
        }))
      ],
      max_tokens: 700,
      temperature: 0.65
    });

    const reply =
      readAiResponse(result) ||
      "I did not get a useful answer. Ask again with a tighter question.";

    const assistantMessage = this.saveMessage("assistant", reply);
    this.trimOldMessages();
    this.updateStoredState({ messageCount: this.getMessageCount() });

    return {
      reply,
      message: assistantMessage,
      state: this.state
    };
  }

  async startLearningPlan(rawTopic?: string) {
    this.ensureTables();

    if (this.state.workflowStatus === "running" && this.state.activeWorkflowId) {
      return {
        instanceId: this.state.activeWorkflowId,
        topic: this.state.lastPlanTopic ?? rawTopic ?? this.state.profile.subject
      };
    }

    const topic =
      compactText(rawTopic ?? "", 160) ||
      this.state.profile.subject ||
      "next learning session";

    const payload: StartPlanPayload = {
      topic,
      profile: this.state.profile,
      recentMessages: this.listMessages(8),
      latestPlan: this.getLatestPlanText()
    };

    const instanceId = await this.runWorkflow("AI_APP_WORKFLOW", payload, {
      agentBinding: "AI_APP",
      metadata: { topic }
    });

    this.updateStoredState({
      activeWorkflowId: instanceId,
      workflowStatus: "running",
      workflowMessage: `Building plan for ${topic}.`,
      lastPlanTopic: topic
    });

    return { instanceId, topic };
  }

  async saveGeneratedPlan(plan: { id?: string; topic: string; content: string }) {
    this.ensureTables();

    const savedPlan = {
      id: plan.id ?? crypto.randomUUID(),
      topic: compactText(plan.topic, 160) || "learning plan",
      content: trimMessage(plan.content, 10_000),
      createdAt: new Date().toISOString()
    } satisfies LearningPlan;

    this.sql`
      INSERT INTO plans (id, topic, content, created_at)
      VALUES (${savedPlan.id}, ${savedPlan.topic}, ${savedPlan.content}, ${savedPlan.createdAt})
    `;

    return savedPlan;
  }

  async resetSession(): Promise<BootstrapPayload> {
    this.ensureTables();

    this.sql`DELETE FROM messages`;
    this.sql`DELETE FROM plans`;
    this.setState(createInitialState());

    return this.getBootstrap();
  }

  async onWorkflowProgress(
    workflowName: string,
    instanceId: string,
    progress: unknown
  ) {
    if (workflowName !== "AI_APP_WORKFLOW") {
      return;
    }

    const next = (progress ?? {}) as PlanWorkflowProgress;
    this.updateStoredState({
      activeWorkflowId: instanceId,
      workflowStatus: next.status === "error" ? "error" : "running",
      workflowMessage: next.message ?? this.state.workflowMessage
    });
  }

  async onWorkflowComplete(
    workflowName: string,
    _instanceId: string,
    result?: unknown
  ) {
    if (workflowName !== "AI_APP_WORKFLOW") {
      return;
    }

    const latestPlanId =
      result && typeof result === "object" && "id" in result && typeof result.id === "string"
        ? result.id
        : this.state.latestPlanId;

    this.updateStoredState({
      activeWorkflowId: null,
      workflowStatus: "complete",
      workflowMessage: "Plan ready.",
      latestPlanId
    });
  }

  async onWorkflowError(
    workflowName: string,
    _instanceId: string,
    error: string
  ) {
    if (workflowName !== "AI_APP_WORKFLOW") {
      return;
    }

    this.updateStoredState({
      activeWorkflowId: null,
      workflowStatus: "error",
      workflowMessage: error || "Plan run failed."
    });
  }
}
