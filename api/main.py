"""
HTTP API
========
A thin FastAPI layer over `src.data`, `src.analysis` and `src.inflation`.

Thin is the design, not a disclaimer. Every number this service returns is
computed by those three modules; this file fetches, converts and chooses
status codes. If you find yourself writing arithmetic here, it belongs in
`src/analysis.py`, where it can be hand-checked without a running server
rather than only through HTTP.

Run it:

    uvicorn api.main:app --reload --port 8000

Then open http://localhost:8000/docs.

To open the app on a phone, bind to the network and allow its origin:

    MIRU_DEV=1 uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

See `DEV_ORIGIN_REGEX` for what that permits, and note that the phone also
needs the frontend pointed at the laptop rather than at itself, with
NEXT_PUBLIC_API_URL=http://<laptop address>:8000.

A deployment instead names its frontend's origins in MIRU_ALLOWED_ORIGINS,
comma separated; see `ORIGINS_ENV_VAR`. The list actually in force is logged
on every boot, so a refused request can be told from a variable that was
never set without redeploying to find out.
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from typing import Optional

import numpy as np
import pandas as pd
import psycopg
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import schemas as sc
from src import db
from src import analysis as an
from src import data as dl
from src import inflation as inf
from src import market as mk
from src import style as sty
from src import fx as fxm
from src import risk as rk
from src import fees as fz
from src import periods as prd
from src import precompute as pc
from src.tefas_client import TEFASClient

logger = logging.getLogger(__name__)

# uvicorn configures its own loggers and leaves the root one alone, so
# without this every `logger.info` in this service and in `src/` is dropped
# before it reaches the platform's log. Level from the environment, INFO by
# default, because in a deployment the log is the only window into the
# process. `basicConfig` is a no-op when something has already configured
# handlers, so a host that sets logging up itself keeps its own.
LOG_LEVEL_ENV_VAR = "LOG_LEVEL"

LOG_LEVELS = {
    "CRITICAL": logging.CRITICAL,
    "ERROR": logging.ERROR,
    "WARNING": logging.WARNING,
    "INFO": logging.INFO,
    "DEBUG": logging.DEBUG,
}

logging.basicConfig(
    # A typo here must not be the thing that stops the service booting.
    level=LOG_LEVELS.get(
        os.environ.get(LOG_LEVEL_ENV_VAR, "").strip().upper(), logging.INFO
    ),
    format="%(levelname)s %(name)s %(message)s",
)

API_VERSION = "0.1.0"

# The frontend runs on its own port in development. Only these origins may
# call the API from a browser; widening this to "*" would let any page a
# user has open read whatever this service can reach.
LOCAL_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# A deployment serves the frontend from somewhere this file cannot know: a
# preview URL that changes per branch, a custom domain that arrives after the
# code does. So the deployed origins are configuration, not source, and come
# in here comma separated. The two localhost origins are kept whatever this
# says, because a deployment that sets it is still developed against locally.
ORIGINS_ENV_VAR = "MIRU_ALLOWED_ORIGINS"


def _configured_origins(raw: Optional[str] = None) -> list[str]:
    """The origins named by the environment, cleaned and deduplicated.

    A browser's `Origin` is scheme, host and port with no path, and CORS
    compares the two strings exactly, so a trailing slash is not a near miss
    -- it never matches anything. Both it and stray whitespace come from
    pasting a URL out of a browser bar into a dashboard field, which is how
    this variable is set, so both are trimmed rather than left to fail
    silently at request time.
    """
    if raw is None:
        raw = os.environ.get(ORIGINS_ENV_VAR, "")
    seen: list[str] = []
    for part in raw.split(","):
        origin = part.strip().rstrip("/")
        if origin and origin not in seen:
            seen.append(origin)
    return seen


def _allowed_origins() -> list[str]:
    """Localhost plus whatever the environment added, in that order."""
    origins = list(LOCAL_ORIGINS)
    origins.extend(o for o in _configured_origins() if o not in origins)
    return origins


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
DEV_ENV_VAR = "MIRU_DEV"
_TRUTHY = {"1", "true", "yes", "on"}


def _dev_mode() -> bool:
    """Whether to accept local network origins. Read once, at import."""
    return os.environ.get(DEV_ENV_VAR, "").strip().lower() in _TRUTHY


# The fund registry is ~2600 rows that change at most daily, and building it
# costs six TEFAS requests. Cached for a day: TEFAS lists only what is
# currently traded, and that list does not turn over inside one.
REGISTRY_TTL_SECONDS = 24 * 60 * 60

# How many weeks of returns each rolling correlation looks back over.
#
# Measured before it was chosen, on the five year matrix and its ten pairs,
# against 26 and 104. A window trades noise for lag and there is no setting
# that avoids both: the lag to reach halfway through a real change lands on
# half the window whatever the length (14, 31 and 64 weeks measured, against
# 13, 26 and 52 predicted), because that is what a moving average of a step
# does.
#
# So the choice was made on the noise side. With the true correlation held
# flat at 0.80 and never moving, a 26 week window still swings 0.52 and
# crosses the grouping line seven times; on the real basket every one of the
# six spurious crossings belonged to it. Most of what it draws is the
# estimator, not the funds. 104 weeks is the calm one, swinging 0.199, but it
# reports a real jump across the line 88 weeks late, needs two years before
# the chart starts, and asks about two and a half years of shared history
# before the section can appear at all.
#
# 52 halves 26's noise for seventeen weeks of extra lag: a 0.331 false swing,
# no spurious crossings on the real basket, four of the five available years
# on screen. It is also a year, which is a length a reader can hold.
ROLLING_WINDOW_WEEKS = 52

# Points below which a rolling series is not a history worth drawing.
#
# One point clears `rolling_correlation`'s own bar and is a dot, not a line.
# Twenty six is half a year of movement, and asks for about a year and a half
# of shared history, which is the same order as the window itself.
MIN_ROLLING_POINTS = 26

app = FastAPI(
    title="miru API",
    version=API_VERSION,
    summary="Turkish investment fund basket analysis.",
    description=(
        "Returns numbers and state codes, never display text: the caller "
        "phrases the finding for the screen it is drawing. See the response "
        "models for what each null field means."
    ),
)

DEV_MODE = _dev_mode()
ALLOWED_ORIGINS = _allowed_origins()

# Said out loud on every boot, before the first request. A CORS failure looks
# like a broken frontend rather than like a misconfiguration, and the origin
# the browser sent is not in this process's log, so the list it was compared
# against has to be -- otherwise the only way to tell a variable that was
# never read from one that was read and holds a typo is to redeploy and see.
logger.info("CORS allowed origins: %s", ", ".join(ALLOWED_ORIGINS))
if not _configured_origins():
    logger.warning(
        "%s is not set: only %s may call this API from a browser. "
        "A deployed frontend on any other address will be refused.",
        ORIGINS_ENV_VAR,
        ", ".join(LOCAL_ORIGINS),
    )

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
    rolling_status, rolling = _rolling(
        ds.trimmed, trimmed, request.group_threshold
    )

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
        rolling_status=rolling_status,
        rolling_correlation=rolling,
        fees={c: f for c in request.codes if (f := _fee_out(c, _fees())) is not None},
    )


# ----------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------


def _load(request: sc.AnalyzeRequest) -> dl.FundDataset:
    """Fetch the basket, turning an unreachable TEFAS into a 503.

    `load_price_data` does not raise when TEFAS is down, so an outage has to
    be recognised from the shape of the failures instead. Two shapes mean it,
    and both are checked:

    `request_failed` on every code is the direct signal — the price requests
    themselves did not complete. `no_data_unverified` on every code is the
    indirect one: the requests completed empty *and* the registry lookup that
    would have diagnosed the emptiness also failed to answer.

    Neither is the same as a basket of bad codes, which comes back tagged
    `unknown_code` because the registry did answer and did not know them.
    That basket is a 200 with an explanation, not a 503.
    """
    try:
        ds = dl.load_price_data(request.codes, months=request.months)
    except ValueError as exc:
        raise _invalid("funds" if request.mode == "simple" else "purchases", str(exc))

    failures = ds.failed_codes
    if len(failures) == len(ds.requested_codes):
        kinds = {f.kind for f in failures.values()}
        if kinds == {dl.FAILURE_REQUEST_FAILED}:
            raise UpstreamUnavailable(
                "no fund's prices could be requested from TEFAS"
            )
        if kinds == {dl.FAILURE_UNVERIFIED}:
            raise UpstreamUnavailable(
                "no fund returned data and the TEFAS fund registry did not answer"
            )
    return ds


#: How much of each neighbour's history its card draws. A year: long enough
#: that the two lines have weeks to agree or disagree over, short enough that
#: twenty of them add a few kilobytes to a page rather than tens. Not the
#: window the correlation was measured on, and the card says which it is.
NEIGHBOUR_RECENT_WEEKS = 52


def _weekly_series(
    rows: list[dict], digits: int = 4
) -> Optional[sc.WeeklySeriesOut]:
    """The stored weekly grid as a base-100 index, or None.

    Based at the first week that has a price, not at the first row: a fund
    whose series opens with a blank week would otherwise divide by null and
    lose the whole series. The blanks stay blank — nothing is filled in, and
    nothing is dropped either, because the payload's dates are implied from
    the start plus a weekly step and a dropped week would shift every later
    point.
    """
    if not rows:
        return None

    base = next((r["price"] for r in rows if r["price"]), None)
    if not base:
        return None

    return sc.WeeklySeriesOut(
        start=rows[0]["week_end"],
        values=[
            None if r["price"] is None else round(100.0 * r["price"] / base, digits)
            for r in rows
        ],
    )


def _cpi_series(rows: list[dict]) -> Optional[sc.CPISeriesOut]:
    """The stored CPI index, or None when the table is empty.

    Index levels as published, not rebased: the page rebases to whichever
    period the reader picked, and only ratios inside one series are ever
    used. `latest_month` travels with it because that is where the inflation
    line has to stop — the index is a level for a whole month and is never
    carried into the weeks after the last published one.
    """
    if not rows:
        return None
    return sc.CPISeriesOut(
        start_month=rows[0]["month"],
        latest_month=rows[-1]["month"],
        values=[float(r["index_value"]) for r in rows],
    )


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


def _rolling(
    prices: pd.DataFrame,
    analysis: Optional[an.BasketAnalysis],
    threshold: float,
) -> tuple[sc.RollingStatus, Optional[sc.RollingCorrelation]]:
    """Every pair's correlation over the moving window, on one date axis.

    Computed on the same matrix the analysis ran on, so the level a pair sits
    at on the chart and the number reported for the period are the same
    measurement over the same weeks.

    Every pair, not only the interesting one, because the screen lets a
    reader choose which to look at and a second round trip per pair would
    make that choice cost a spinner. The dates go once: they come from one
    weekly index, so they are identical across pairs by construction, and
    repeating them would be most of the payload.
    """
    if analysis is None or analysis.correlation is None:
        # A single fund basket has no pair. Not a failure and not worth a
        # status of its own beyond saying which of the two nulls this is.
        return ("single_fund", None)

    codes = list(analysis.correlation.columns)
    pairs: list[sc.RollingPair] = []
    dates: list[str] = []

    for i, a in enumerate(codes):
        for b in codes[i + 1 :]:
            series = an.rolling_correlation(
                prices, (a, b), window=ROLLING_WINDOW_WEEKS
            )
            if len(series) < MIN_ROLLING_POINTS:
                # Every pair shares a matrix and therefore a length, so the
                # first short one settles it for the basket.
                return ("not_enough_weeks", None)
            if not dates:
                dates = [d.strftime("%Y-%m-%d") for d in series.index]
            pairs.append(
                sc.RollingPair(
                    codes=[a, b],
                    values=[
                        None if pd.isna(v) else float(v) for v in series.to_numpy()
                    ],
                    full_period=float(analysis.correlation.loc[a, b]),
                )
            )

    if not pairs:
        return ("single_fund", None)

    # Strongest first, so a caller can draw pairs[0] without choosing.
    pairs.sort(key=lambda p: p.full_period, reverse=True)
    return (
        "ok",
        sc.RollingCorrelation(
            window_weeks=ROLLING_WINDOW_WEEKS,
            # The request's threshold, not the default: the line on the chart
            # has to be the one the finding above it was actually cut at.
            threshold=float(threshold),
            dates=dates,
            pairs=pairs,
        ),
    )


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
        # series opens at what is in it.
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


# ----------------------------------------------------------------------
# Fund pages
# ----------------------------------------------------------------------
#
# These two read Postgres and compute nothing. Every number they return was
# written by `jobs.weekly`; if one looks wrong, the job is where it was
# decided, not here.
#
# The database is optional to the rest of this service. `/analyze` never
# touched Postgres and still does not, so a deployment with no DATABASE_URL
# keeps working and only these endpoints go dark — with a 503 that says
# which, rather than a 500 from a driver.


class DatabaseUnavailable(Exception):
    """Postgres is not configured or not reachable. Becomes a 503."""


@app.exception_handler(DatabaseUnavailable)
def _database_unavailable(request: Request, exc: DatabaseUnavailable) -> JSONResponse:
    logger.warning("database unavailable on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": str(exc) or "the fund database is unavailable"},
        headers={"Retry-After": "60"},
    )


@contextmanager
def _db():
    """A connection for one request, or a 503 naming why there is none."""
    try:
        url = db.database_url()
    except db.DatabaseNotConfigured as exc:
        raise DatabaseUnavailable(str(exc)) from exc
    try:
        with db.connect(url) as conn:
            yield conn
    except psycopg.Error as exc:
        raise DatabaseUnavailable(f"Postgres did not answer: {exc}") from exc


@app.get(
    "/funds/list",
    response_model=sc.FundListResponse,
    tags=["funds"],
    summary="Every fund that has a page.",
)
def funds_list() -> sc.FundListResponse:
    """Codes, names and founders, for generating the static pages.

    Declared before `/fund/{code}` has no bearing on routing — the paths
    differ in their first segment — but it is the cheaper call and reads
    first.
    """
    with _db() as conn:
        rows = db.fetch_fund_list(conn)
    return sc.FundListResponse(
        count=len(rows), funds=[sc.FundListItem(**r) for r in rows]
    )


#: The market grouping, computed once per weekly snapshot. Keyed on the
#: last run's finish time, so a new snapshot is picked up on the next call
#: and a process restart costs one recomputation (about a second or two).
_MARKET_CACHE: dict[str, sc.MarketResponse] = {}
_PERIODS_CACHE: dict[str, sc.MarketPeriodsResponse] = {}
#: The stored grid, its weekly returns and the style model, per snapshot.
#: Both market endpoints start from the same ~260,000 rows; this is read
#: once per weekly run rather than once per endpoint.
_INPUTS_CACHE: dict[str, tuple] = {}


def _market_inputs(conn):
    last = db.fetch_last_run(conn)
    key = str(last["finished_at"]) if last else "none"
    if key in _INPUTS_CACHE:
        return _INPUTS_CACHE[key]
    rows = db.fetch_market_prices(conn)
    meta = db.fetch_market_meta(conn)
    if rows:
        long = pd.DataFrame(rows, columns=["code", "week_end", "price"])
        long["week_end"] = pd.to_datetime(long["week_end"])
        long["price"] = pd.to_numeric(long["price"], errors="coerce")
        grid = long.pivot(index="week_end", columns="code", values="price").sort_index()
    else:
        grid = pd.DataFrame()
    returns = mk.returns_from_grid(grid)
    model = sty.choose_proxies(returns) if not returns.empty else None
    out = (key, last, grid, returns, meta, model)
    _INPUTS_CACHE.clear()
    _INPUTS_CACHE[key] = out
    return out


def _market(conn) -> sc.MarketResponse:
    key, last, grid, returns, meta, model = _market_inputs(conn)
    if key in _MARKET_CACHE:
        return _MARKET_CACHE[key]

    thresholds = pc.Thresholds.from_env()
    g = mk.group_market(returns, thresholds)

    # What each group is made of: the style of its equal-weight return.
    group_styles: dict[int, sty.Style] = {}
    if model is not None and g.clusters:
        series = pd.DataFrame(
            {i: sty.group_series(returns, c.codes) for i, c in enumerate(g.clusters)}
        )
        group_styles = sty.analyse(series, model)

    def style_out(s: Optional[sty.Style]) -> Optional[sc.StyleOut]:
        if s is None:
            return None
        return sc.StyleOut(
            weights={k: round(v, 4) for k, v in s.weights.items()},
            r2=round(s.r2, 4),
            weeks=s.weeks,
            reportable=sty.reportable(s),
        )

    def size_of(codes: list[str]) -> Optional[float]:
        values = [meta.get(c, {}).get("total_assets") for c in codes]
        known = [v for v in values if v is not None]
        return float(sum(known)) if known else None

    # Share of the asset-weighted market's variance, per fund, summed per
    # group below. Measured funds with a known size only.
    measured_all = [x for c in g.clusters for x in c.codes] + list(g.singletons)
    sizes = {
        x: float(meta[x]["total_assets"])
        for x in measured_all
        if meta.get(x, {}).get("total_assets")
    }
    shares = mk.risk_shares(returns, sizes) if sizes else {}

    def risk_of(codes: list[str]) -> Optional[float]:
        return round(sum(shares.get(x, 0.0) for x in codes), 4) if shares else None

    fees = _fees()

    def fee_range(codes: list[str]) -> tuple[Optional[float], Optional[float]]:
        # Over the members with a reported non-zero fee: a zero may be a gap
        # in TEFAS's data, and a range starting at it would say "free".
        # One kind of charge per range: a securities fund's management fee
        # and a pension fund's operating expense are different charges, and
        # a range spanning both would compare them. Management fees when the
        # group has any, else operating expenses.
        known = [fees[x] for x in codes if x in fees and fees[x].rate > 0]
        kind = "management" if any(f.kind == "management" for f in known) else "operating"
        rates = [f.rate for f in known if f.kind == kind]
        return (round(min(rates), 6), round(max(rates), 6)) if rates else (None, None)

    # What sets each group apart from others of the same style: a word from
    # its funds' titles, and the house running most of them (src.market).
    style_keys = {
        i: {k for k, v in s.weights.items() if v >= 0.10}
        for i, s in group_styles.items()
        if sty.reportable(s)
    }
    measured_all_codes = [x for c in g.clusters for x in c.codes] + list(g.singletons)
    quals = mk.qualifiers(g.clusters, meta, measured_all_codes, style_keys)

    def anchor(codes: list[str]) -> str:
        # The member a group's page is addressed by: its largest fund, which
        # is the one a reader is most likely to know. Any member's code
        # resolves to the same page, so the address survives this changing.
        return max(codes, key=lambda x: (meta.get(x, {}).get("total_assets") or 0.0, x))

    clusters = []
    for i, c in enumerate(g.clusters):
        cats = [meta.get(x, {}).get("category") for x in c.codes]
        cats = [x for x in cats if x]
        top, share = None, None
        if cats:
            counts = pd.Series(cats).value_counts()
            top, share = str(counts.index[0]), float(counts.iloc[0] / len(c.codes))
        founders = {meta.get(x, {}).get("founder") for x in c.codes} - {None}
        clusters.append(
            sc.MarketClusterOut(
                codes=c.codes,
                size=len(c.codes),
                weakest_ci_low=round(c.weakest_ci_low, 4),
                median_correlation=round(c.median_correlation, 4),
                founders=len(founders),
                top_category=top,
                top_category_share=round(share, 4) if share is not None else None,
                total_assets=size_of(c.codes),
                risk_share=risk_of(c.codes),
                anchor=anchor(c.codes),
                qualifiers=[
                    sc.QualifierOut(kind=q.kind, key=q.key, count=q.count, of=q.of)
                    for q in quals.get(i, [])
                ],
                fee_low=fee_range(c.codes)[0],
                fee_high=fee_range(c.codes)[1],
                style=style_out(group_styles.get(i)),
            )
        )

    unmeasured: dict[str, list[str]] = {}
    for code, reason in sorted(g.unmeasured.items()):
        unmeasured.setdefault(reason, []).append(code)
    # A fund with a page but no stored grid at all was never measured either.
    without_prices = sorted(set(meta) - set(grid.columns))
    if without_prices:
        unmeasured.setdefault(mk.UNMEASURED_SHORT, []).extend(without_prices)

    measured_codes = [x for c in g.clusters for x in c.codes] + g.singletons
    out = sc.MarketResponse(
        listed=len(meta),
        measured=g.measured,
        groups_total=g.groups_total,
        clusters=clusters,
        singletons=g.singletons,
        unmeasured=unmeasured,
        overlapping_threshold=thresholds.overlapping,
        min_weeks=thresholds.min_weeks,
        window_start=g.window_start.date() if g.window_start is not None else None,
        window_end=g.window_end.date() if g.window_end is not None else None,
        total_assets_measured=size_of(measured_codes),
        last_run_at=last["finished_at"] if last else None,
        style_factors=[
            sc.StyleFactorOut(key=k, proxy=v) for k, v in (model.proxies.items() if model else [])
        ],
        style_min_r2=sty.MIN_R2,
    )
    _MARKET_CACHE.clear()
    _MARKET_CACHE[key] = out
    return out


@app.get(
    "/market/clusters",
    response_model=sc.MarketResponse,
    tags=["funds"],
    summary="How many different things the fund universe holds.",
)
def market_clusters() -> sc.MarketResponse:
    """Every included fund, partitioned into groups whose every pair overlaps.

    Computed from the stored weekly grid with the fund pages' own functions
    and thresholds, once per weekly snapshot, then served from memory.
    """
    with _db() as conn:
        return _market(conn)


#: Weeks of each member's line on a group page: a year, as on the
#: neighbour cards.
GROUP_RECENT_WEEKS = 52


@app.get(
    "/market/group/{code}",
    response_model=sc.MarketGroupResponse,
    tags=["funds"],
    summary="One market group, found by any of its funds' codes.",
)
def market_group(code: str) -> sc.MarketGroupResponse:
    """The group containing `code`: its figures and every member.

    404 when the code is in no multi-fund group — a fund with no twin, one
    that could not be measured, or no such fund. The page sends those to
    the fund's own page.
    """
    code = code.strip().upper()
    with _db() as conn:
        m = _market(conn)
        idx = next((i for i, c in enumerate(m.clusters) if code in c.codes), None)
        if idx is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"{code!r} is not in any group of the last run",
            )
        cl = m.clusters[idx]
        rows = db.fetch_funds(conn, cl.codes)
        recent = db.fetch_recent_prices(conn, cl.codes, GROUP_RECENT_WEEKS)
    fees = _fees()
    members = [
        sc.GroupMemberOut(
            fund=_with_fee(sc.FundIdentity.from_row(r), fees),
            recent=_weekly_series(recent.get(r["code"], []), digits=2),
        )
        for r in rows
    ]
    return sc.MarketGroupResponse(
        rank=idx + 1,
        groups=len(m.clusters),
        cluster=cl,
        members=members,
        style_factors=m.style_factors,
        style_min_r2=m.style_min_r2,
        overlapping_threshold=m.overlapping_threshold,
        window_start=m.window_start,
        window_end=m.window_end,
        last_run_at=m.last_run_at,
    )


def _period_out(p: prd.Period) -> sc.PeriodOut:
    return sc.PeriodOut(
        key=p.key,
        start=p.start.date(),
        end=p.end.date(),
        weeks=p.weeks,
        partial=p.partial,
        mean_correlation=round(p.mean_correlation, 4) if np.isfinite(p.mean_correlation) else None,
        correlation=sc.Correlation.from_frame(p.corr.round(4)),
        volatility={k: round(v, 4) for k, v in p.volatility.items()},
        shifts=[
            sc.ShiftOut(a=x.a, b=x.b, corr=round(x.corr, 4), rest=round(x.rest, 4), z=round(x.z, 2))
            for x in p.shifts
        ],
    )


@app.get(
    "/market/periods",
    response_model=sc.MarketPeriodsResponse,
    tags=["funds"],
    summary="How the asset classes moved against each other, year by year.",
)
def market_periods() -> sc.MarketPeriodsResponse:
    """Correlations and volatility of the style factors per calendar year.

    `shifts` lists, per year, the pairs whose correlation that year differs
    from the other years' by more than a Bonferroni-corrected two-sided
    test at 5% across the year's pairs (`src.periods`). Keys only; the
    frontend names them.
    """
    with _db() as conn:
        key, last, grid, returns, meta, model = _market_inputs(conn)
    if key in _PERIODS_CACHE:
        return _PERIODS_CACHE[key]
    if model is None or model.factors.empty:
        out = sc.MarketPeriodsResponse(factors=[], whole=None, periods=[], alpha=prd.ALPHA, z_critical=None)
    else:
        whole, periods = prd.calendar_periods(model.factors)
        pairs = len(model.factors.columns) * (len(model.factors.columns) - 1) // 2
        out = sc.MarketPeriodsResponse(
            factors=[sc.StyleFactorOut(key=k, proxy=v) for k, v in model.proxies.items()],
            whole=_period_out(whole),
            periods=[_period_out(p) for p in periods],
            alpha=prd.ALPHA,
            z_critical=round(prd.z_critical(pairs), 3),
        )
    _PERIODS_CACHE.clear()
    _PERIODS_CACHE[key] = out
    return out


#: USD/TRY, fetched once a day per process. A static build asks for 1,372
#: fund pages; this makes that one EVDS request, not 1,372.
_FX_CACHE: dict[str, Optional[pd.Series]] = {}
_FX_FAILED_AT: list[float] = []
#: A failed rate fetch is retried after this long rather than the next day:
#: during a static build every fund page asks, and one transient EVDS error
#: must not blank the dollar figure on all of them until tomorrow.
_FX_RETRY_SECONDS = 600


def _usdtry() -> Optional[pd.Series]:
    today = pd.Timestamp.today().normalize()
    key = today.strftime("%Y-%m-%d")
    if key in _FX_CACHE:
        return _FX_CACHE[key]
    if _FX_FAILED_AT and time.monotonic() - _FX_FAILED_AT[-1] < _FX_RETRY_SECONDS:
        return None
    rate = fxm.load_usdtry((today - pd.DateOffset(years=6)).date(), today.date())
    if rate is None:
        _FX_FAILED_AT[:] = [time.monotonic()]
        return None
    _FX_CACHE.clear()
    _FX_CACHE[key] = rate
    return rate


_FEE_CACHE: dict[str, dict[str, fz.Fee]] = {}
_FEE_FAILED_AT: list[float] = []


def _fees() -> dict[str, fz.Fee]:
    """Every fund's applied fee from TEFAS, fetched once a day.

    Two requests cover the universe. A failure returns an empty dict — the
    fee is an extra, and every page works without it — and is retried after
    `_FX_RETRY_SECONDS` rather than tomorrow, for the same reason the rate
    is: a static build asks for every fund at once.
    """
    key = pd.Timestamp.today().strftime("%Y-%m-%d")
    if key in _FEE_CACHE:
        return _FEE_CACHE[key]
    if _FEE_FAILED_AT and time.monotonic() - _FEE_FAILED_AT[-1] < _FX_RETRY_SECONDS:
        return {}
    try:
        fees = fz.load_fees(TEFASClient()._crawler)
    except Exception as exc:  # noqa: BLE001 - display data, never fatal
        logger.warning("Fees unavailable: %s", exc)
        _FEE_FAILED_AT[:] = [time.monotonic()]
        return {}
    _FEE_CACHE.clear()
    _FEE_CACHE[key] = fees
    return fees


def _fee_out(code: str, fees: dict[str, fz.Fee]) -> Optional[sc.FeeOut]:
    fee = fees.get(code.upper())
    return sc.FeeOut(rate=round(fee.rate, 6), kind=fee.kind) if fee else None


def _with_fee(identity: sc.FundIdentity, fees: dict[str, fz.Fee]) -> sc.FundIdentity:
    identity.fee = _fee_out(identity.code, fees)
    return identity


def _with_risk(identity: sc.FundIdentity, weekly: list[dict]) -> sc.FundIdentity:
    """Add volatility, drawdown and the dollar return to each return window."""
    if not weekly:
        return identity
    series = pd.Series(
        [r["price"] for r in weekly],
        index=pd.to_datetime([r["week_end"] for r in weekly]),
        dtype="float64",
    )
    fx = None
    for ret in identity.returns:
        if ret.window_end is None:
            continue
        w = rk.window_risk(series, ret.months, ret.window_end)
        ret.volatility = round(w.volatility, 4) if w.volatility is not None else None
        ret.max_drawdown = round(w.max_drawdown, 4) if w.max_drawdown is not None else None
        if ret.nominal is not None:
            fx = fx if fx is not None else _usdtry()
            usd = rk.usd_return(ret.nominal, fx, ret.months, ret.window_end)
            ret.usd = round(usd, 4) if usd is not None else None
    return identity


@app.get(
    "/fund/{code}",
    response_model=sc.FundPageResponse,
    tags=["funds"],
    summary="One fund: identity, returns, and its correlation neighbours.",
    responses={404: {"description": "No fund with that code in the last run."}},
)
def fund_page(code: str) -> sc.FundPageResponse:
    """Read one fund's page out of Postgres.

    404 means the code was not in the last run's universe — a typo, or a
    fund TEFAS no longer lists. It does not mean the fund has no
    neighbours: that case is a 200 with empty lists and a reason, because
    the fund is real and the page has something true to say about it.
    """
    # Codes are upper case on TEFAS. Not the Turkish locale upper: that
    # turns "tie" into "TİE" and there is no such fund.
    code = code.strip().upper()

    with _db() as conn:
        row = db.fetch_fund(conn, code)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No fund {code!r} in the last run",
            )
        neighbours = db.fetch_neighbours(conn, code)
        weekly = db.fetch_weekly_prices(conn, code)
        recent = db.fetch_recent_prices(
            conn,
            [n["fund"]["code"] for n in neighbours],
            NEIGHBOUR_RECENT_WEEKS,
        )
        cpi_rows = db.fetch_cpi(conn)
        last_run = db.fetch_last_run(conn)

    fees = _fees()
    high = [
        sc.NeighbourOut(
            correlation=n["correlation"],
            ci_low=n["ci_low"],
            ci_high=n["ci_high"],
            n_weeks=n["n_weeks"],
            bucket=n["bucket"],
            fund=_with_fee(sc.FundIdentity.from_row(n["fund"]), fees),
            recent=_weekly_series(recent.get(n["fund"]["code"], []), digits=2),
        )
        for n in neighbours
        if n["direction"] == "high"
    ]
    low = [
        sc.NeighbourOut(
            correlation=n["correlation"],
            ci_low=n["ci_low"],
            ci_high=n["ci_high"],
            n_weeks=n["n_weeks"],
            bucket=n["bucket"],
            fund=_with_fee(sc.FundIdentity.from_row(n["fund"]), fees),
            recent=_weekly_series(recent.get(n["fund"]["code"], []), digits=2),
        )
        for n in neighbours
        if n["direction"] == "low"
    ]

    unavailable = None
    if not high and not low:
        # Two different silences, and `included` is what separates them: a
        # fund the run could not price at all never entered the matrix,
        # while a priced one was measured against every other fund and
        # cleared the bar against none. Reading it off the returns instead
        # would call a six-month-old fund unpriced, which it is not.
        unavailable = (
            "no_measurable_pairs" if row.get("included") else "fund_not_priced"
        )

    freshness = sc.DataFreshness(
        last_run_at=last_run["finished_at"] if last_run else None,
        universe_size=last_run["universe_size"] if last_run else None,
        included_funds=last_run["included_funds"] if last_run else None,
        cpi_latest_month=last_run["cpi_latest_month"] if last_run else None,
    )

    return sc.FundPageResponse(
        series=_weekly_series(weekly),
        cpi=_cpi_series(cpi_rows),
        fund=_with_fee(_with_risk(sc.FundIdentity.from_row(row), weekly), fees),
        high=high,
        low=low,
        neighbours_unavailable=unavailable,
        freshness=freshness,
    )
