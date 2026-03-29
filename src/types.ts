export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type LearningPlan = {
  id: string;
  topic: string;
  content: string;
  createdAt: string;
};

export type LearnerProfile = {
  subject: string;
  learningGoal: string;
  studyWindow: string;
};

export type LearningCompanionState = {
  profile: LearnerProfile;
  activeWorkflowId: string | null;
  workflowStatus: "idle" | "running" | "complete" | "error";
  workflowMessage: string | null;
  latestPlanId: string | null;
  lastPlanTopic: string | null;
  lastUpdatedAt: string | null;
  messageCount: number;
};

export type BootstrapPayload = {
  state: LearningCompanionState;
  messages: ChatMessage[];
  plans: LearningPlan[];
};
