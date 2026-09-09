"""
Straggler round test.
=====================
Checks `jobs.weekly._retry_stragglers` against a stub client, so the round
can be verified without spending a TEFAS request.

The round exists because a request that never completed says nothing about
a fund, and leaving it failed turns it into an exclusion — which costs that
fund its page for a week. On 2026-09-09 two consecutive full-universe runs
lost eight funds and then four, all to `RemoteDisconnected`, all in bursts,
and none of the twelve had anything wrong with it.

What matters here is the shape of the decision, not the network: which codes
get retried, which get dropped from `failures`, which stay, and that a
finding about a fund is never re-asked. Unlike `smoke_test.py` this touches
nothing live.

Run:
    .venv/bin/python tests/straggler_test.py
"""

import logging
import os
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jobs.weekly as weekly
import src.data as data
from src.tefas_client import TEFASRequestError

FAILED = {"observed": "request_failed"}


def frame(code: str, rows: int = 3) -> pd.DataFrame:
    """A price frame shaped like the one `fetch_history` returns."""
    return pd.DataFrame(
        {
            "date": pd.date_range("2026-01-02", periods=rows, freq="D"),
            "fund_code": code,
            "fund_name": f"{code} FUND",
            "price": [10.0] * rows,
            "category_rank": 1,
            "category_total": 9,
        }
    )


class StubClient:
    """Answers each code from a script: 'ok', 'empty' or 'fail'."""

    def __init__(self, script: dict[str, str]):
        self.script = script
        self.calls: list[str] = []

    def fetch_history(self, code, start, end, *, attempts=3):
        self.calls.append(code)
        answer = self.script[code]
        if answer == "fail":
            raise TEFASRequestError(f"{code} refused")
        return frame(code, 0 if answer == "empty" else 3)


class Checker:
    def __init__(self) -> None:
        self.failed = 0

    def __call__(self, label: str, condition: bool) -> None:
        print(f"   {'PASS' if condition else 'FAIL'}  {label}")
        self.failed += 0 if condition else 1


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="   | %(message)s")

    # The round's settle pause and the fetch loop's pacing are both real
    # time and neither is what is under test.
    weekly.STRAGGLER_SETTLE_SECONDS = 0.0
    slept = data.time.sleep
    data.time.sleep = lambda _seconds: None

    start, end = pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-05")
    check = Checker()

    print("\n[1] a straggler answers on the retry")
    out, merged = weekly._retry_stragglers(
        frame("AAA"), {"BBB": dict(FAILED)}, start, end, StubClient({"BBB": "ok"})
    )
    check("dropped from failures entirely", "BBB" not in merged)
    check("its prices joined the frame", set(out["fund_code"]) == {"AAA", "BBB"})
    check("the fetched rows are untouched", (out["fund_code"] == "AAA").sum() == 3)

    print("\n[2] a straggler fails again")
    out, merged = weekly._retry_stragglers(
        frame("AAA"), {"BBB": dict(FAILED)}, start, end, StubClient({"BBB": "fail"})
    )
    check("still unmeasured, not downgraded", merged["BBB"]["observed"] == "request_failed")
    check("no rows invented for it", set(out["fund_code"]) == {"AAA"})

    print("\n[3] a straggler answers with nothing")
    _, merged = weekly._retry_stragglers(
        frame("AAA"), {"BBB": dict(FAILED)}, start, end, StubClient({"BBB": "empty"})
    )
    check("becomes a finding about the fund", merged["BBB"]["observed"] == "no_rows")

    print("\n[4] findings are never re-asked")
    findings = {"CCC": {"observed": "no_rows"}, "DDD": {"observed": "no_valid_prices"}}
    stub = StubClient({})
    _, merged = weekly._retry_stragglers(frame("AAA"), dict(findings), start, end, stub)
    check("no request was made", stub.calls == [])
    check("kept verbatim", merged == findings)

    print("\n[5] a run with no failures at all")
    # The settle pause is 90 seconds in production, and the claim written
    # beside that constant is that a clean run never pays it. Assert that
    # rather than trusting the read: put the real value back and time it.
    weekly.STRAGGLER_SETTLE_SECONDS = 90.0
    began = time.monotonic()
    out, merged = weekly._retry_stragglers(frame("AAA"), {}, start, end, StubClient({}))
    elapsed = time.monotonic() - began
    weekly.STRAGGLER_SETTLE_SECONDS = 0.0
    check("nothing added to failures", merged == {})
    check("frame unchanged", len(out) == 3)
    check(f"returns without sleeping ({elapsed:.3f}s at a 90s setting)", elapsed < 1.0)
    print("   (the round still logs a line above — that is the point of it)")

    print("\n[6] the mixed case, shaped like the real one")
    failures = {code: dict(FAILED) for code in ("KDL", "KDO", "KEB")}
    failures["ZZZ"] = {"observed": "no_rows"}
    stub = StubClient({"KDL": "ok", "KDO": "ok", "KEB": "fail"})
    out, merged = weekly._retry_stragglers(frame("AAA"), failures, start, end, stub)
    check("only the stragglers were asked", sorted(stub.calls) == ["KDL", "KDO", "KEB"])
    check("the two that answered are gone", "KDL" not in merged and "KDO" not in merged)
    check("the one that did not is kept", merged["KEB"]["observed"] == "request_failed")
    check("the finding is untouched", merged["ZZZ"] == {"observed": "no_rows"})
    check("recovered prices are in the frame", {"KDL", "KDO"} <= set(out["fund_code"]))

    data.time.sleep = slept

    print()
    if check.failed:
        print(f"{check.failed} check(s) FAILED")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
