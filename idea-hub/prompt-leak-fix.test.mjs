// Test PROMPTLIKE regex catches markdown headings (IDEA-FEED-PROMPT-LEAK-1)
const PROMPTLIKE=/^\s*(?:#{1,6}\s|task\s+writer|task\s+reviewer|task\s+judge|you\s+are\s+one\s+of\b|you\s+are\s+(?:a|an|the)\b|you\s+are\s+now\b|answer\s+the\s+question\s+using\s+only\b|your\s+(?:task|role|job)\s+is\b|act\s+as\s+(?:a|the)\b|follow\s+these\s+instructions\b)/i;

const tests = [
  { input: "### TASK WRITER You are one of three", expected: true, name: "markdown heading with task" },
  { input: "## Another heading", expected: true, name: "two-hash heading" },
  { input: "# Single hash", expected: true, name: "single hash" },
  { input: "###### Six hashes", expected: true, name: "six hashes" },
  { input: "####### Seven hashes (not markdown)", expected: false, name: "seven hashes not markdown" },
  { input: "TASK WRITER without heading", expected: true, name: "task writer without heading" },
  { input: "What is the structure of ultrametric spaces?", expected: false, name: "normal question" },
  { input: "  ### Heading with leading space", expected: true, name: "heading with leading space" },
];

let pass = 0, fail = 0;
for (const t of tests) {
  const result = PROMPTLIKE.test(t.input);
  if (result === t.expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${t.name}: expected ${t.expected}, got ${result}`);
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
