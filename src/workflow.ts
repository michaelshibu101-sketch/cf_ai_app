import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { AiAppAgent } from "./agent";

const PLAN_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

type WorkflowPayload = {
  topic: string;
  profile: {
    subject: string;
    learningGoal: string;
    studyWindow: string;
  };
  recentMessages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  latestPlan: string;
};

export class AiPlanWorkflow extends AgentWorkflow<
  AiAppAgent,
  WorkflowPayload,
  { step?: string; status?: string; message?: string; percent?: number },
  Env
> {
  async run(
    event: AgentWorkflowEvent<WorkflowPayload>,
    step: AgentWorkflowStep
  ) {
    const startedAt = new Date().toISOString();

    try {
      await this.reportProgress({
        step: "review",
        status: "running",
        message: "Reviewing saved notes and recent chat.",
        percent: 0.2
      });

      await step.mergeAgentState({
        workflowStatus: "running",
        workflowMessage: "Reviewing saved notes and recent chat.",
        lastUpdatedAt: startedAt
      });

      const contextSummary = [
        event.payload.profile.subject
          ? `Subject: ${event.payload.profile.subject}`
          : "Subject: missing",
        event.payload.profile.learningGoal
          ? `Goal: ${event.payload.profile.learningGoal}`
          : "Goal: missing",
        event.payload.profile.studyWindow
          ? `Time: ${event.payload.profile.studyWindow}`
          : "Time: missing",
        "",
        "Recent chat:",
        event.payload.recentMessages.length
          ? event.payload.recentMessages
              .map((message) => `${message.role}: ${message.content}`)
              .join("\n")
          : "No chat history.",
        "",
        event.payload.latestPlan
          ? `Last plan:\n${event.payload.latestPlan.slice(0, 1_200)}`
          : "Last plan: none"
      ].join("\n");

      await this.reportProgress({
        step: "draft",
        status: "running",
        message: "Drafting plan.",
        percent: 0.65
      });

      await step.mergeAgentState({
        workflowStatus: "running",
        workflowMessage: "Drafting plan.",
        lastUpdatedAt: new Date().toISOString()
      });

      const planText = await step.do("draft-learning-plan", async () => {
        const response = await this.env.AI.run(PLAN_MODEL, {
          messages: [
            {
              role: "system",
              content:
                "You write learning plans for one learner. " +
                "Return plain text. " +
                "Use these headings exactly: Session Focus, Checklist, Trouble Spots, Quick Win. " +
                "Keep length between 300 and 450 words."
            },
            {
              role: "user",
              content: `Topic: ${event.payload.topic}\n\n${contextSummary}`
            }
          ],
          max_tokens: 900,
          temperature: 0.45
        });

        if (
          !response ||
          typeof response !== "object" ||
          !("response" in response) ||
          typeof response.response !== "string"
        ) {
          throw new Error("Workers AI returned an unexpected plan response.");
        }

        return response.response.trim();
      });

      await this.reportProgress({
        step: "save",
        status: "running",
        message: "Saving plan.",
        percent: 0.9
      });

      const savedPlan = await step.do("save-learning-plan", async () => {
        const saved = await this.agent.saveGeneratedPlan({
          topic: event.payload.topic,
          content: planText
        });

        return {
          id: saved.id,
          topic: saved.topic,
          content: saved.content,
          createdAt: saved.createdAt
        };
      });

      await step.mergeAgentState({
        activeWorkflowId: null,
        workflowStatus: "complete",
        workflowMessage: "Plan ready.",
        latestPlanId: savedPlan.id,
        lastPlanTopic: event.payload.topic,
        lastUpdatedAt: savedPlan.createdAt
      });

      await step.reportComplete(savedPlan);
      return savedPlan;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Plan build failed.";

      await step.mergeAgentState({
        activeWorkflowId: null,
        workflowStatus: "error",
        workflowMessage: message,
        lastUpdatedAt: new Date().toISOString()
      });

      await step.reportError(message);
      throw error;
    }
  }
}
