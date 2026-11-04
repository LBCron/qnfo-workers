#!/usr/bin/env python3
"""
QNFO GitHub Star Audit Tool — v1.0

Fetches all starred repos for a GitHub account, classifies them against
the QNFO Research Program Keyword Taxonomy, and generates a KEEP/DUMP report.

Usage:
    python star_audit.py [--account rwnq8|QNFO] [--output star_report.json]

Classification categories:
    agentic_ai   — LLM/agent frameworks, RAG, vector DBs, MCP
    quantum      — Quantum computing, QEC, quantum information
    ultrametric  — p-adic, adelic, non-Archimedean, Bruhat-Tits
    qnfo_owned   — rwnq8/QNFO/QWAV-owned repos (always KEEP)
    infra_keep   — Dev tools, Cloudflare, note-taking, git tools
    infra_dump   — Dead/irrelevant build tools, Android SDK wrappers
    dump         — Clearly irrelevant (Android modding, crypto, social media)

Thin-client compliant: writes output to stdout + optional JSON file.
No local persistence needed — this script lives in git.
"""
import subprocess, json, sys, argparse, os

# === KEYWORD TAXONOMY (synced from QNFO/qnfo-research:docs/QNFO-KEYWORD-TAXONOMY.md) ===

AGENTIC_KEYWORDS = [
    "agent", "mcp", "llm", "prompt", "rag", "attention", "reasoning",
    "autonomous", "copilot", "tool-use", "function-call", "chatgpt", "gpt",
    "openai", "anthropic", "claude", "gemini", "mistral", "llama",
    "langchain", "autogen", "crewai", "semantic-kernel", "langgraph",
    "transformers", "huggingface", "tokenizer", "embedding", "vector",
    "inference", "serve", "generative", "multi-agent", "swarm",
    "deepseek", "qwen", "machine-learning", "deep-learning", "nlp",
    "fine-tune", "rlhf", "alignment", "safety", "guardrail",
    "coder", "code-gen", "completion", "assistant", "chat",
    "memory", "context", "orchestrat", "workflow", "planning",
    "cognition", "brain", "neural", "neuro",
    "local-ai", "edge-infer", "web-llm", "mlc-ai", "onnx",
    "open-interpreter", "computer-use", "browser-use",
    "model", "training", "distill", "quantiz", "lora", "qlora",
    "sentence-transform", "cross-encoder", "rerank",
    "llm-studio", "oobabooga", "kobold", "sillytavern",
    "text-generation", "text-gen", "textgen",
    "firecrawl", "litellm", "bolt.new", "dify", "flowise",
    "anything-llm", "open-webui", "jan", "lmstudio",
    "vllm", "ollama", "llamafile", "unsloth",
]

QUANTUM_KEYWORDS = [
    "quantum", "qec", "qubit", "qiskit", "cirq", "pennylane",
    "error-correction", "surface-code", "stabilizer", "qsharp",
    "anyon", "majorana", "topological-quantum", "braiding",
    "quantum-algorithm", "quantum-circuit", "quantum-gate",
    "quantum-simulation", "quantum-chemistry", "vqe", "qaoa",
    "quantum-anneal", "d-wave", "ionq", "rigetti", "ibm-q",
    "quantum-information", "quantum-channel", "quantum-entropy",
    "bell", "entanglement", "teleportation", "superdense",
    "boson-sampling", "gaussian-boson", "photonic-quantum",
    "quantum-computer", "quantum-processor", "quantum-hardware",
    "transmon", "superconducting-qubit", "spin-qubit", "nv-center",
    "quantum-ml", "quantum-machine-learning",
]

ULTRAMETRIC_KEYWORDS = [
    "ultrametric", "p-adic", "adelic", "ostrowski", "tate",
    "bruhat-tits", "non-archimedean", "archimedean",
    "number-theory", "algebraic-geometry", "arithmetic-geometry",
    "galois", "etale", "crystalline-cohomology", "rigid-geometry",
    "berkovich", "perfectoid", "scholze", "fontaine",
    "class-field", "automorphic", "langlands", "modular-form",
    "elliptic-curve", "abelian-variety", "shimura",
    "p-adic-hodge", "p-adic-analysis", "p-divisible",
    "lubin-tate", "formal-group", "dieudonne",
    "valuation", "place", "completion",
    "adel", "idele", "idele-class",
    "fargues", "condensed-math", "analytic-geometry",
    "sagemath", "padic", "sage", "arithmetic",
]

QNFO_PREFIXES = ["rwnq8/", "QNFO/", "QWAV/"]

INFRA_KEYWORDS = [
    "poetry", "pip", "build", "deploy", "ci-cd", "github-action",
    "docker", "kubernetes", "terraform",
    "goreleaser", "nfpm",
    "just-the-docs", "mkdocs", "sphinx",
    "wrangler", "cloudflare", "workers", "pages", "d1", "r2",
    "cuda", "rocm", "vulkan", "opencl",
    "typescript", "eslint", "prettier", "rust", "cargo",
    "git", "github-cli", "gh",
    "android-sdk", "ndk", "gradle",
    "pandoc", "latex", "typst",
    "obsidian", "markdown", "note",
    "termux", "linux", "kernel",
    "nextcloud", "self-host", "homelab",
    "security", "vpn", "tor", "encrypt",
    "search", "index", "database", "sqlite", "postgres", "redis",
    "wasm", "webassembly", "browser",
    "s3", "storage", "cdn", "proxy", "nginx",
    "backup", "restore", "sync",
    "api", "graphql", "rest", "grpc",
    "monitor", "observ", "logging", "metrics", "tracing",
    "pypi", "npm", "crate",
]


def fetch_stars(account="rwnq8"):
    """Fetch all starred repos for an account via gh api."""
    all_repos = []
    page = 1
    while True:
        result = subprocess.run(
            ["gh", "api", f"users/{account}/starred?per_page=100&page={page}",
             "--jq", ".[].full_name"],
            capture_output=True, text=True, check=False, timeout=30
        )
        if result.returncode != 0:
            print(f"ERROR page {page}: {result.stderr}", file=sys.stderr)
            break
        names = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]
        if not names:
            break
        all_repos.extend(names)
        page += 1
    return all_repos


def classify(repos):
    """Classify repos into categories based on keyword matching."""
    results = {"agentic_ai": [], "quantum": [], "ultrametric": [],
               "qnfo_owned": [], "infra": [], "dump": []}

    for repo in repos:
        lower = repo.lower()

        # QNFO-owned
        if any(repo.startswith(p) for p in QNFO_PREFIXES):
            results["qnfo_owned"].append(repo)
            continue

        # Ultrametric
        if any(kw in lower for kw in ULTRAMETRIC_KEYWORDS):
            results["ultrametric"].append(repo)
            continue

        # Quantum
        if any(kw in lower for kw in QUANTUM_KEYWORDS):
            results["quantum"].append(repo)
            continue

        # Agentic AI
        if any(kw in lower for kw in AGENTIC_KEYWORDS):
            results["agentic_ai"].append(repo)
            continue

        # Infra
        if any(kw in lower for kw in INFRA_KEYWORDS):
            results["infra"].append(repo)
            continue

        # Dump
        results["dump"].append(repo)

    return results


def main():
    parser = argparse.ArgumentParser(description="QNFO GitHub Star Audit Tool")
    parser.add_argument("--account", default="rwnq8", help="GitHub account (rwnq8 or QNFO)")
    parser.add_argument("--output", help="Output JSON file path")
    args = parser.parse_args()

    print(f"\n{'='*70}")
    print(f"QNFO STAR AUDIT — {args.account}")
    print(f"{'='*70}\n")

    # Fetch
    repos = fetch_stars(args.account)
    print(f"Fetched {len(repos)} starred repos\n")

    # Classify
    results = classify(repos)
    for cat, lst in sorted(results.items()):
        print(f"  {cat:15s}: {len(lst):4d}")

    total = sum(len(v) for v in results.values())
    keep = sum(len(results[c]) for c in ["agentic_ai", "quantum", "ultrametric", "qnfo_owned"])
    dump = sum(len(results[c]) for c in ["dump"])
    print(f"\n  {'KEEP':15s}: {keep:4d}")
    print(f"  {'DUMP':15s}: {dump:4d}")
    print(f"  {'INFRA (review)':15s}: {len(results['infra']):4d}")
    print(f"  {'TOTAL':15s}: {total:4d}")

    # Output JSON
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"\nSaved to {args.output}")

    return results


if __name__ == "__main__":
    main()
