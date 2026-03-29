import { getAgentByName, routeAgentRequest } from "agents";
import { AiAppAgent } from "./agent";
import { AiPlanWorkflow } from "./workflow";

export { AiAppAgent, AiPlanWorkflow };

function readSessionId(request: Request): string {
  const sessionId = request.headers.get("x-session-id")?.trim();
  if (!sessionId) {
    return "demo-session";
  }

  return sessionId.slice(0, 120);
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        app: "cf-ai-app"
      });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        const agent = await getAgentByName(env.AI_APP, readSessionId(request), {
          locationHint: "enam"
        });

        if (url.pathname === "/api/bootstrap" && request.method === "GET") {
          return Response.json(await agent.getBootstrap());
        }

        if (url.pathname === "/api/profile" && request.method === "POST") {
          const body = await readJson<{
            subject?: string;
            learningGoal?: string;
            studyWindow?: string;
          }>(request);

          return Response.json(await agent.updateProfile(body));
        }

        if (url.pathname === "/api/chat" && request.method === "POST") {
          const body = await readJson<{ message?: string }>(request);
          return Response.json(await agent.chat(body.message ?? ""));
        }

        if (url.pathname === "/api/plan" && request.method === "POST") {
          const body = await readJson<{ topic?: string }>(request);
          return Response.json(await agent.startLearningPlan(body.topic));
        }

        if (url.pathname === "/api/reset" && request.method === "POST") {
          return Response.json(await agent.resetSession());
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Request failed.";
        return jsonError(message, 500);
      }

      return jsonError("Not found", 404);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
