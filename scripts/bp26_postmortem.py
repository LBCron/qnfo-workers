#!/usr/bin/env python3
"""BP26 collector for postmortem_coverage (2026-10-28, charter pillar autonomy).

postmortem_coverage: incidents in the last 30 days with a completed postmortem within 72 hours / all incidents (target 1.0).

The hourly ledger builder in bp26_slo writes incidents from availability episodes and control-plane canary failures, then creates evidence-backed
postmortems. This module owns the single producer registration for that metric.

Offline suite: python3 scripts/bp26_postmortem.py --selftest
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector  # noqa: E402
from bp26_slo import collect_slo, selftest as slo_selftest  # noqa: E402

COLLECTORS = [Collector("postmortem_ledger", collect_slo, ["postmortem_coverage"], 50)]


def selftest():
    ok = len(COLLECTORS) == 1 and COLLECTORS[0].fn is collect_slo and COLLECTORS[0].metrics == ["postmortem_coverage"]
    if not ok:
        print("bp26_postmortem selftest FAILED")
        return 1
    result = slo_selftest()
    print("bp26_postmortem selftest %s" % ("ok" if result == 0 else "FAILED"))
    return result


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
