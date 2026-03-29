Cloudflare AI App

Cloudflare AI app for one learner.
Your chat history stays in session memory.
A workflow builds a learning plan in the background.

Repo name
cf_ai_app

Assignment match
LLM: Cloudflare Workers AI model @cf/meta/llama-3.3-70b-instruct-fp8-fast
Workflow and coordination: AiAppAgent starts AiPlanWorkflow and tracks state.
Chat input: public page posts messages to the Worker API.
Memory and state: Durable Object state plus SQLite tables for messages and plans.
Docs: README.md lists setup and run steps.
Prompt log: PROMPTS.md lists the main prompts used during development.

Main files
src/index.ts
src/agent.ts
src/workflow.ts
public/index.html
public/app.js
public/styles.css
PROMPTS.md

Setup
1. Create a Cloudflare account.
2. Install Node.js 20 or newer.
3. Run npm install.
4. Run npx wrangler login. If you use a token, set CLOUDFLARE_API_TOKEN.
5. Run npm run cf-typegen.
6. Run npm run dev.

Local URL
Wrangler serves the app on a local URL. The default URL is often http://127.0.0.1:8787.

Deploy
Run npm run deploy.

Checks
npm run check passed.
npm run cf-typegen ran and wrote worker-configuration.d.ts.

Current limit
Full runtime verification needs Cloudflare login or a valid API token.
