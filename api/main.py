"""
HTTP API
========
A thin FastAPI layer over `src.data`, `src.analysis` and `src.inflation`.

Thin is the design, not a disclaimer. Every number this service returns is
computed by those three modules; this file fetches, converts and chooses
status codes. If you find yourself writing arithmetic here, it belongs in
`src/analysis.py`, where it can be hand-checked without a running server —
and where the Streamlit app gets it too.

Run it:

    uvicorn api.main:app --reload --port 8000

Then open http://localhost:8000/docs.

To open the app on a phone, bind to the network and allow its origin:

    FONRADAR_DEV=1 uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

See `DEV_ORIGIN_REGEX` for what that permits, and note that the phone also
needs the frontend pointed at the laptop rather than at itself, with
NEXT_PUBLIC_API_URL=http://<laptop address>:8000.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import schemas as sc
from src import analysis as an
from src import data as dl
from src import inflation as inf
from src.tefas_client import TEFASClient

logger = logging.getLogger(__name__)

API_VERSION = "0.1.0"

# The frontend runs on its own port in development. Only these origins may
# call the API from a browser; widening this to "*" would let any page a
# user has open read whatever this service can reach.
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# Testing on a real phone means loading the page from the laptop's address on
# the local network, and the browser sends that address as the Origin. It
# cannot be listed above: it is whatever the router handed out this morning,
# and the port moves as soon as something else has 3000. So development
# matches a pattern instead — the three private IPv4 ranges and mDNS `.local`
# names, on any port.
#
# The ranges are spelled out rather than covered by a looser pattern. `10\.`
# and `192\.168\.` are cheap to allow because nothing routable can claim
# them; a pattern that also caught, say, any bare hostname would hand the
# same access to a public one.
DEV_ORIGIN_REGEX = (
    r"http://("
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|[A-Za-z0-9-]+\.local"
    r")(:\d{1,5})?"
)

# What turns that on. Off unless the environment says otherwise, because this
# is exactly the kind of switch that is only ever noticed once it has been
# left on: with it set, any page served from the same network can read
# everything this API can reach, which on a laptop joined to a café's wifi is
# every other device on it. Deployment sets nothing and gets the two localhost
# origins, so production cannot inherit this by forgetting to unset it.
DEV_ENV_VAR = "FONRADAR_DEV"
_TRUTHY = {"1", "true", "yes", "on"}


def _dev_mode() -> bool:
    """Whether to accept local network origins. Read once, at import."""
    return os.environ.get(DEV_ENV_VAR, "").strip().lower() in _TRUTHY


# The fund registry is ~2600 rows that change at most daily, and building it
# costs six TEFAS requests. Cached for a day, exactly like the Streamlit
# app's `@st.cache_data(ttl=24*60*60)`.
REGISTRY_TTL_SECONDS = 24 * 60 * 60

app = FastAPI(
    title="FonRadar API",
    version=API_VERSION,
    summary="Turkish investment fund basket analysis.",
    description=(
        "Returns numbers and state codes, never display text: the caller "
        "phrases the finding for the screen it is drawing. See the response "
        "models for what each null field means."
    ),
)

DEV_MODE = _dev_mode()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # None in production, so the regex branch is never even reached.
    allow_origin_regex=DEV_ORIGIN_REGEX if DEV_MODE else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

if DEV_MODE:
    # Said out loud on every boot. A permission this wide should not be
    # something you have to read the source to discover you are running.
    logger.warning(
        "%s is set: pages served from the local network may call this API. "
        "Do not run with it set in production.",
        DEV_ENV_VAR,
    )


# ----------------------------------------------------------------------
# Failure handling
# ----------------------------------------------------------------------


class UpstreamUnavailable(Exception):
    """TEFAS could not be reached. Becomes a 503."""


@app.exception_handler(UpstreamUnavailable)
def _upstream_unavailable(request: Request, exc: UpstreamUnavailable) -> JSONResponse:
    logger.warning("upstream unavailable on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": str(exc) or "TEFAS is unreachable"},
        headers={"Retry-After": "60"},
    )


@app.exception_handler(Exception)
def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    # The traceback goes to the log, where an operator can read it. The
    # client gets the fact of the failure and nothing about the shape of
    # this service — paths, module names and library versions are all a
    # stack trace hands to whoever asked.
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "internal server error"},
    )


def _invalid(field: str, message: str) -> HTTPException:
    """A 422 shaped like the ones FastAPI raises for itself.

    Same envelope as a pydantic rejection — a list of `{loc, msg, type}` —
    so a client has one error format to parse rather than two.
    """
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=[{"loc": ["body", field], "msg": message, "type": "value_error"}],
    )


# ----------------------------------------------------------------------
# Fund registry, cached for a day
# ----------------------------------------------------------------------

_registry: Optional[dict[str, str]] = None
_registry_at: float = 0.0


def _fund_registry() -> dict[str, str]:
    """Code to title for every listed fund. One TEFAS round trip a day."""
    global _registry, _registry_at

    if _registry is not None and time.monotonic() - _registry_at < REGISTRY_TTL_SECONDS:
        return _registry

    try:
        funds = TEFASClient().list_funds()
    except Exception as exc:
        # `list_funds` raises rather than returning a partial registry, on
        # the grounds that a half-built one would label live funds invalid.
        # Serving a stale copy beats serving nothing: the registry changes
        # slowly, and an autocomplete a day old is still an autocomplete.
        if _registry is not None:
            logger.warning("registry refresh failed, serving stale copy: %s", exc)
            return _registry
        raise UpstreamUnavailable(f"could not list TEFAS funds: {exc}") from exc

    _registry, _registry_at = funds, time.monotonic()
    return funds


# ----------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------


@app.get("/health", response_model=sc.HealthResponse, tags=["meta"])
def health() -> sc.HealthResponse:
    """Is this service up? Says nothing about TEFAS — see `/funds` for that."""
    return sc.HealthResponse(status="ok", version=API_VERSION)


@app.get("/funds", response_model=sc.FundsResponse, tags=["funds"])
def funds() -> sc.FundsResponse:
    """
    Every fund TEFAS currently lists, as code and title.

    For an autocomplete that searches both: people look a fund up by code
    when they know it and by name when they do not.

    Cached for a day. Delisted funds are not here — TEFAS lists only what is
    currently traded, which is also why a dead code and a code that never
    existed are indistinguishable downstream.
    """
    registry = _fund_registry()
    rows = [sc.Fund(code=code, title=title) for code, title in sorted(registry.items())]
    return sc.FundsResponse(count=len(rows), funds=rows)


@app.post("/analyze", response_model=sc.AnalyzeResponse, tags=["analysis"])
def analyze(request: sc.AnalyzeRequest) -> sc.AnalyzeResponse:
    """
    Analyse one basket: coverage, correlation grouping, risk and real return.

    Send either `funds` (the basket as it stands) or `purchases` (dated
    deposits). In staged mode the weights are today's market value rather
    than the lira paid in, and `analysis.purchases.xirr` is the return that
    accounts for when each deposit arrived.

    Returns 422 for a request that cannot be analysed — an empty basket, a
    non-positive amount, a purchase dated before the price series — with the
    offending field named. Returns 503 when TEFAS cannot be reached. A valid
    request whose funds simply returned no data is a 200 with `analysis:
    null`, an `analysis_status` saying why, and the coverage report that
    explains it: nothing was wrong with the asking.
    """
    ds = _load(request)

    trimmed_status, trimmed = _analyse_matrix(ds.trimmed, request, "trimmed")
    analysis, grouping = _pair(trimmed, request.group_threshold)

    # Only worth computing when the two matrices differ. When nothing was
    # excluded, `full` is `trimmed` and a second copy would say nothing.
    if not ds.excluded_codes:
        full_status: sc.FullAnalysisStatus = "not_needed"
        full = None
    else:
        full_status, full = _analyse_matrix(ds.full, request, "full")
    full_analysis, full_grouping = _pair(full, request.group_threshold)

    real_status, real = _real_return(trimmed, request)

    return sc.AnalyzeResponse(
        mode=request.mode,
        months=request.months,
        requested_codes=request.codes,
        coverage=sc.Coverage.from_dataset(ds),
        analysis_status=trimmed_status,
        analysis=analysis,
        grouping=grouping,
        full_analysis_status=full_status,
        full_analysis=full_analysis,
        full_grouping=full_grouping,
        real_return_status=real_status,
        real_return=real,
    )


# ----------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------


def _load(request: sc.AnalyzeRequest) -> dl.FundDataset:
    """Fetch the basket, turning an unreachable TEFAS into a 503.

    `load_price_data` does not raise when TEFAS is down: `get_fund_history`
    logs and returns an empty frame, and the registry lookup that would
    diagnose the emptiness degrades to "unverified" rather than failing. So
    an outage arrives here looking like a basket of codes that all returned
    nothing, unverified — which is exactly the signature tested for below.
    A basket that genuinely holds only bad codes comes back tagged
    `unknown_code`, because the registry answered.
    """
    try:
        ds = dl.load_price_data(request.codes, months=request.months)
    except ValueError as exc:
        raise _invalid("funds" if request.mode == "simple" else "purchases", str(exc))

    failures = ds.failed_codes
    if len(failures) == len(ds.requested_codes) and all(
        f.kind == dl.FAILURE_UNVERIFIED for f in failures.values()
    ):
        raise UpstreamUnavailable(
            "no fund returned data and the TEFAS fund registry did not answer"
        )
    return ds


def _analyse_matrix(
    prices: pd.DataFrame,
    request: sc.AnalyzeRequest,
    which: str,
) -> tuple[str, Optional[an.BasketAnalysis]]:
    """Run one price matrix, or say why it could not be run.

    The two matrices hold different funds over different windows, so the
    basket has to be cut down to whichever one is in hand — a fund excluded
    from `trimmed` has no column to weight.
    """
    if prices.empty or prices.shape[1] == 0:
        return "no_funds", None

    codes = set(prices.columns)

    if request.mode == "simple":
        basket, purchases = _simple_basket(request, prices, codes)
    else:
        basket = None
        purchases = [
            an.Purchase(date=p.date, code=p.code, amount=p.amount, basis=p.basis)
            for p in request.purchases
            if p.code in codes
        ]

    # Nothing of this basket survived the cut to this matrix.
    if not (purchases or basket):
        return "no_funds", None

    try:
        return "ok", an.analyze_basket(prices, basket, purchases=purchases)
    except ValueError as exc:
        message = str(exc)

        # A window too short to estimate from is a fact about the data, not
        # a fault in the request: the funds are real, they just have not
        # traded long enough together.
        if "weekly returns" in message:
            return "window_too_short", None

        # A purchase before the matrix starts is a fault in the request —
        # but only fatally so for the matrix the caller is actually shown.
        # `full` covers a *shorter* window than `trimmed` (that is what
        # excluding a late starter buys), so a purchase can be valid for the
        # answer and still predate the comparison. Failing the whole request
        # over the comparison would be the tail wagging the dog.
        if "before" in message and which == "full":
            return "out_of_window", None

        raise _invalid("purchases" if request.mode == "staged" else "funds", message)


def _simple_basket(
    request: sc.AnalyzeRequest,
    prices: pd.DataFrame,
    codes: set[str],
) -> tuple[Optional[dict[str, float]], Optional[list[an.Purchase]]]:
    """Decide whether a `funds` basket is plain weights or dated holdings.

    A basket where nothing carries a date and everything is stated at today's
    value is the request this service has always answered: the amounts *are*
    the composition, and it still goes down the weights path untouched, so
    those callers see byte for byte what they saw before.

    The moment a date or a `paid` amount appears, the basket is describing
    holdings in time rather than a snapshot, and only the purchase path can
    answer it. Mixed baskets land here too, which is the point: `paid` and
    `current_value` become units bought on a date before anything else runs,
    so one basket holding both is not a special case downstream.

    A `current_value` holding with no date is anchored to the first day of
    the matrix. That is not a guess: it is exactly what the weights path
    already assumes when it buys the whole basket on day one, so the two
    agree rather than quietly differing.
    """
    wanted = [f for f in request.funds if f.code in codes]

    plain = all(f.date is None and f.basis == "current_value" for f in wanted)
    if plain:
        return {f.code: f.amount for f in wanted}, None

    start = prices.index[0].date()
    return None, [
        an.Purchase(
            date=f.date if f.date is not None else start,
            code=f.code,
            amount=f.amount,
            basis=f.basis,
        )
        for f in wanted
    ]


def _pair(
    analysis: Optional[an.BasketAnalysis],
    threshold: float,
) -> tuple[Optional[sc.BasketAnalysis], Optional[sc.Grouping]]:
    """An analysis and its grouping, converted together or not at all."""
    if analysis is None:
        return None, None
    grouping = an.find_fund_groups(analysis.correlation, analysis.weights, threshold)
    return sc.BasketAnalysis.from_dataclass(analysis), sc.Grouping.from_dataclass(grouping)


def _real_return(
    analysis: Optional[an.BasketAnalysis],
    request: sc.AnalyzeRequest,
) -> tuple[str, Optional[sc.RealReturn]]:
    """The basket restated in today's prices, when the CPI is available.

    Measured on `basket_value`, the deposit-free series, either way. When the
    basket was resolved into purchases that makes it a statement about the
    holding rather than about the investor — see `schemas.RealReturn.basis`.
    Deflating the staged market value instead would fold every deposit into
    the return, which is the arithmetic the purchase path exists to correct.

    The branch is on how the basket was actually *analysed*, not on which
    request field carried it. A `funds` basket with dates on it is resolved
    into purchases, and calling that a lump sum would both mislabel it and
    scale the series by a sum of amounts that are not commensurable: some
    stated as what was paid, some as what the holding is worth today.

    Scaled to lira before deflating. The returns themselves are ratios and
    do not care, but `real_value` is a series someone will plot with a lira
    axis, and an axis running from 1.0 to 1.4 is not one.
    """
    if analysis is None:
        return "not_applicable", None

    plan = analysis.purchases
    if plan is None:
        # A plain weights basket: the amounts are the composition, and the
        # series opens at what is in it. Same convention as the Streamlit app.
        basis: sc.ReturnBasis = "lump_sum"
        scale = sum(f.amount for f in request.funds if f.code in analysis.weights)
        series = analysis.basket_value * scale
    else:
        # The one lira figure that is certain here is what the holding is
        # worth now, so anchor the series to it at the far end.
        basis = "held_units"
        series = analysis.basket_value * (
            plan.total_value / float(analysis.basket_value.iloc[-1])
        )

    cpi = inf.load_cpi()
    if cpi is None:
        # Every expected CPI failure — no key, no network, a rejected key —
        # arrives as None. The rest of the answer is unaffected, and this
        # section is an extra the page works without.
        return "unavailable", None

    try:
        real = inf.real_return(series, cpi)
    except Exception as exc:
        logger.warning("real return unavailable: %s", exc)
        return "unavailable", None

    return "ok", sc.RealReturn.from_dataclass(real, basis)
