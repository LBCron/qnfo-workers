#!/usr/bin/env python3
"""
submit_task.py — DeepChat → Cloudflare Agent Orchestrator bridge.
Offloads agentic LLM threads to Cloudflare Workers for remote execution.

Usage (from DeepChat exec):
  python C:/Users/LENOVO/.deepchat/scripts/submit_task.py "Research ultrametric clustering taxonomy"
  python C:/Users/LENOVO/.deepchat/scripts/submit_task.py "Search and summarize..." --max-steps 5 --timeout 120

Environment: No dependencies beyond Python 3.10+ stdlib (urllib, json, time, sys).
"""

import urllib.request, json, time, sys, argparse

BASE = "https://qnfo-agent-orchestrator.q08.workers.dev"

def _token():
    p = r"C:\Users\LENOVO\.deepchat\scripts\.sync_token"
    try:
        with open(p) as f:
            return f.read().strip()
    except Exception:
        return ""

UA = {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json", "X-Sync-Token": _token()}

def submit_task(prompt: str, max_steps: int = 5, model: str = "workers-ai") -> str:
    """Submit a task to the agent orchestrator. Returns task_id."""
    task = json.dumps({
        "prompt": prompt,
        "max_steps": max_steps,
        "model": model
    }).encode()
    req = urllib.request.Request(f"{BASE}/task", data=task, headers=UA)
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())
    tid = result.get("task_id")
    if not tid:
        raise RuntimeError(f"Submission failed: {result}")
    return tid

def poll_task(task_id: str, timeout: int = 60) -> dict:
    """Poll task until completed or timeout. Returns full state dict."""
    deadline = time.time() + timeout
    poll_headers = {"User-Agent": "Mozilla/5.0"}
    
    while time.time() < deadline:
        req = urllib.request.Request(f"{BASE}/task/{task_id}", headers=poll_headers)
        try:
            state = json.loads(urllib.request.urlopen(req, timeout=10).read())
        except Exception as e:
            time.sleep(2)
            continue
        
        status = state.get("status", "unknown")
        step = state.get("step", 0)
        max_steps = state.get("maxSteps", "?")
        
        if status in ("completed", "failed"):
            return state
        
        # Progress indicator
        print(f"  [{status}] step {step}/{max_steps}", file=sys.stderr)
        time.sleep(3)
    
    return {"status": "timeout", "error": f"Task did not complete within {timeout}s"}

def main():
    parser = argparse.ArgumentParser(
        description="Submit research tasks to Cloudflare agent orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s "Search papers about ultrametric clustering"
  %(prog)s "Summarize the KIF-29 consilience gate paper" --max-steps 5
  %(prog)s "Query the knowledge graph for Paper nodes with label ultrametric" --max-steps 3 --json
        """
    )
    parser.add_argument("prompt", nargs="+", help="Research prompt to submit")
    parser.add_argument("--max-steps", type=int, default=5, help="Maximum agent steps (default: 5, max: 10)")
    parser.add_argument("--timeout", type=int, default=90, help="Poll timeout in seconds (default: 90)")
    parser.add_argument("--json", action="store_true", help="Output full JSON state instead of just result")
    parser.add_argument("--poll-interval", type=int, default=3, help="Seconds between polls (default: 3)")
    
    args = parser.parse_args()
    prompt = " ".join(args.prompt)
    max_steps = min(args.max_steps, 10)
    
    print(f"Submit: {BASE}/task", file=sys.stderr)
    print(f"Prompt: {prompt[:120]}{'...' if len(prompt) > 120 else ''}", file=sys.stderr)
    
    try:
        task_id = submit_task(prompt, max_steps)
    except Exception as e:
        print(f"ERROR: Submit failed: {e}", file=sys.stderr)
        sys.exit(1)
    
    print(f"Task ID: {task_id}", file=sys.stderr)
    
    state = poll_task(task_id, args.timeout)
    
    if args.json:
        print(json.dumps(state, indent=2))
    else:
        status = state.get("status", "unknown")
        if status == "completed":
            result = state.get("result", "")
            print(result)
        elif status == "failed":
            error = state.get("error", "Unknown error")
            print(f"[FAILED] {error}", file=sys.stderr)
            sys.exit(1)
        else:
            print(f"[{status}] Task did not complete", file=sys.stderr)
            
            # Diagnostic: show last step
            step = state.get("step", 0)
            print(f"  Reached step {step}. Timeout at {args.timeout}s.", file=sys.stderr)
            sys.exit(2)

if __name__ == "__main__":
    main()
