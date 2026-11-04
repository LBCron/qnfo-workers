// Fixture handler for scripts/agent_loop_replay.mjs: a loop that calls an OpenAI-style chat completions endpoint over fetch.
// The URL is never contacted; the replay serves the recorded body.
export default async function run({ fetch, input }) {
  const res = await fetch("https://ai.qnfo.org/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-v4-flash-wa",
      messages: [{ role: "user", content: String(input.question) }],
      temperature: 0,
    }),
  });
  const body = await res.json();
  return { answer: body.choices[0].message.content };
}
