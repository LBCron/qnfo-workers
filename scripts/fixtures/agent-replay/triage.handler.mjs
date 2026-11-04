// Fixture handler for scripts/agent_loop_replay.mjs: a two-step triage loop with the same shape as a fleet loop that calls env.AI.run.
// Step 1 asks the model to classify an issue; step 2 asks it to write the one-line next action for the class it chose.
export default async function run({ ai, input }) {
  const model = "@cf/zai-org/glm-5.3-flash";
  const first = await ai.run(model, {
    messages: [
      { role: "system", content: "Classify the issue as defect, request or noise. Reply with one word." },
      { role: "user", content: String(input.title) },
    ],
    max_tokens: 16,
  });
  const label = String(first.response || "").trim().toLowerCase();
  const second = await ai.run(model, {
    messages: [
      { role: "system", content: "Write the single next action for a " + label + "." },
      { role: "user", content: String(input.title) },
    ],
    max_tokens: 64,
  });
  return { label, action: String(second.response || "").trim() };
}
