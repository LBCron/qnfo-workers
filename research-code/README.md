# research-code

QNFO research libraries, staged and tested here and published in the public repositories below (CODE-REACH-1,
`docs/CODE-REACH-PROGRAM.md`). Every library is tested on each change by `.github/workflows/research-code.yml` and is
registered in D1 `qnfo-audit.research_code_libraries`. Install or build from its public repository:

| Library | Field | Kind | Tests | Public source and install |
|---|---|---|---|---|
| [agentic-collapse](agentic-collapse/) | AI | paper companion | 16 unittest; finds the v1 trajectory off its own equations | [QNFO/agentic-collapse](https://github.com/QNFO/agentic-collapse); `pip install git+https://github.com/QNFO/agentic-collapse.git` |
| [ignorance-audit](ignorance-audit/) | metascience | standalone tool and companion | 20 unittest | [QNFO/ignorance-audit](https://github.com/QNFO/ignorance-audit); `pip install git+https://github.com/QNFO/ignorance-audit.git` |
| [ultrametric-lean](ultrametric-lean/) | mathematics, formal verification | Lean 4 formalization | lake build, no sorryAx | [QNFO/ultrametric-lean](https://github.com/QNFO/ultrametric-lean); clone the repository and run `lake build` |

Rules: offline tests, pinned toolchain, no secret or model provider inside a library, claim/test/status in every README,
`CITATION.cff` pointing at the paper, QNFO-ULA `LICENSE`. A library that disagrees with its paper
pins the disagreement in a test and files an `agent_issues` row.
