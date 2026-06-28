#!/usr/bin/env python3
"""Production-hardened Watch List Processor.

Hermes owns retrieval. Persona Command Center owns configuration, imports,
storage, notifications, drafts, and Operator display.

This bridge does not create placeholder opportunities. Retrieval must produce
usable evidence before any PCC import is attempted.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

_THIS_DIR = Path(__file__).resolve().parent
_SEARCH_AGENT_DIR = _THIS_DIR.parent
_PROJECT_DIR = _SEARCH_AGENT_DIR.parent
if str(_PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(_PROJECT_DIR))

from search_agent import SearchAgent
from search_agent.models.opportunities import DraftPost, OpportunityPacket
from search_agent.providers.searxng import SearXNGProvider
from search_agent.services.draft_generation_service import DraftGenerationService

logger = logging.getLogger("watch_list_processor")

VALID_RETRIEVAL_STATUSES = {"success", "no_results", "retrieval_failed", "skipped"}

TRIAL_MAPPING: list[dict[str, str]] = [
    {"persona_id": "policy-pete", "persona_name": "Sterling Digital", "handle": "@paulg", "entity_name": "Paul Graham"},
    {"persona_id": "maga-memester", "persona_name": "Scott Decoded", "handle": "@karpathy", "entity_name": "Andrej Karpathy"},
    {"persona_id": "the-wonkette", "persona_name": "Peptide Tracker", "handle": "@bryan_johnson", "entity_name": "Bryan Johnson"},
    {"persona_id": "progressive-pat", "persona_name": "Chris Klebl", "handle": "@morganhousel", "entity_name": "Morgan Housel"},
]


@dataclass
class RetrievalResult:
    status: str
    method: str | None = None
    query: str = ""
    search_results: list[dict[str, Any]] = field(default_factory=list)
    research_packet: Any | None = None
    evidence_urls: list[str] = field(default_factory=list)
    error: str | None = None

    def __post_init__(self) -> None:
        if self.status not in VALID_RETRIEVAL_STATUSES:
            raise ValueError(f"Invalid retrieval status: {self.status}")


class PCCClient:
    def __init__(self, base_url: str = "http://127.0.0.1:3000", timeout: int = 20):
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout

    def _request(self, method: str, path: str, data: dict | None = None) -> dict | list:
        url = f"{self.base_url}{path}"
        headers = {"content-type": "application/json"}
        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = Request(url, data=body, headers=headers, method=method)
        with urlopen(req, timeout=self._timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}

    def get_health(self) -> dict[str, Any]:
        result = self._request("GET", "/api/health")
        return result if isinstance(result, dict) else {"ok": False}

    def get_export(self) -> dict[str, Any]:
        result = self._request("GET", "/api/hermes/export")
        if isinstance(result, list):
            return {"personas": result}
        return result

    def post_import(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("POST", "/api/hermes/import", payload)
        return result if isinstance(result, dict) else {"raw": result}

    def get_operator_queue(self) -> dict[str, Any]:
        result = self._request("GET", "/api/operator/queue")
        if isinstance(result, dict):
            return result
        return {"personas": result if isinstance(result, list) else []}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def preflight(pcc: PCCClient, require_crawl4ai: bool = False) -> tuple[bool, list[str], dict[str, Any]]:
    errors: list[str] = []
    details: dict[str, Any] = {}

    try:
        health = pcc.get_health()
        details["pccHealth"] = health
        if not health.get("ok"):
            errors.append("PCC /api/health did not return ok=true")
    except Exception as exc:
        errors.append(f"PCC /api/health unreachable: {exc}")

    try:
        export = pcc.get_export()
        details["pccExportPersonaCount"] = len(export.get("personas", []))
        if not isinstance(export.get("personas"), list):
            errors.append("PCC /api/hermes/export missing personas array")
    except Exception as exc:
        errors.append(f"PCC /api/hermes/export unreachable: {exc}")

    try:
        agent_health = SearchAgent.health()
        status = getattr(agent_health, "status", "")
        details["searchAgentHealth"] = agent_health.to_dict() if hasattr(agent_health, "to_dict") else {"status": status}
        if status != "healthy":
            errors.append(f"SearchAgent unhealthy: {status or 'unknown'}")
    except Exception as exc:
        errors.append(f"SearchAgent health failed: {exc}")

    try:
        searxng = SearXNGProvider()
        searxng_health = searxng.health()
        status = getattr(searxng_health, "status", "")
        details["searxngHealth"] = searxng_health.to_dict() if hasattr(searxng_health, "to_dict") else {"status": status}
        if status != "healthy":
            errors.append(f"SearXNG unhealthy: {status or 'unknown'}")
    except Exception as exc:
        errors.append(f"SearXNG health failed: {exc}")

    if require_crawl4ai:
        endpoint = (os.environ.get("CRAWL4AI_ENDPOINT") or "http://127.0.0.1:11235").rstrip("/")
        try:
            req = Request(f"{endpoint}/health", method="GET")
            with urlopen(req, timeout=10) as resp:
                details["crawl4aiHealth"] = {"status": resp.status}
                if resp.status >= 400:
                    errors.append(f"Crawl4AI unhealthy: HTTP {resp.status}")
        except Exception as exc:
            errors.append(f"Crawl4AI health failed: {exc}")

    return len(errors) == 0, errors, details


def object_to_dict(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return item
    if hasattr(item, "to_dict"):
        return item.to_dict()
    return {
        "title": getattr(item, "title", ""),
        "url": getattr(item, "url", ""),
        "snippet": getattr(item, "snippet", ""),
        "source_id": getattr(item, "source_id", ""),
    }


def usable_http_urls(items: list[dict[str, Any]]) -> list[str]:
    urls: list[str] = []
    for item in items:
        url = str(item.get("url") or item.get("source_id") or "").strip()
        if url.startswith("http") and url not in urls:
            urls.append(url)
    return urls


def clean_entity_name(entity_name: str) -> str:
    return entity_name.replace(" H. ", " ").replace(", MD", "").strip()


def normalized_title(entity_name: str, research_packet: Any, search_results: list[dict[str, Any]]) -> str:
    entity = clean_entity_name(entity_name)
    haystack = " ".join([
        getattr(research_packet, "executive_summary", ""),
        " ".join(getattr(research_packet, "key_findings", []) or []),
        " ".join(str(item.get("title", "")) for item in search_results[:3]),
        " ".join(str(item.get("snippet", "")) for item in search_results[:3]),
    ]).lower()
    if "surveillance" in haystack or "behavior" in haystack:
        return f"{entity} discusses surveillance and human behavior"
    if "claude" in haystack or "llm" in haystack or "interface" in haystack or "tag" in haystack:
        return f"{entity} analyzes a new LLM interface"
    if "school" in haystack or "education" in haystack or "student" in haystack:
        return f"{entity} comments on AI use in schools"
    if "longevity" in haystack or "protocol" in haystack or "health" in haystack:
        return f"{entity} shares longevity protocol updates"
    return f"{entity} shares a timely update worth reviewing"


def retrieve_entity(entity_name: str, handle: str) -> RetrievalResult:
    query = f"{entity_name} {handle} X post latest"
    try:
        search_results_raw = SearchAgent.search(query, limit=5)
    except Exception as exc:
        return RetrievalResult(status="retrieval_failed", query=query, error=str(exc))

    search_results = [object_to_dict(item) for item in search_results_raw]
    if not search_results:
        return RetrievalResult(status="no_results", method="search", query=query)

    evidence_urls = usable_http_urls(search_results)
    if not evidence_urls:
        return RetrievalResult(status="no_results", method="search", query=query, search_results=search_results)

    try:
        research_packet = SearchAgent.research(query, top_n=5)
    except Exception as exc:
        return RetrievalResult(
            status="retrieval_failed",
            method="search",
            query=query,
            search_results=search_results,
            evidence_urls=evidence_urls,
            error=str(exc),
        )

    research_sources = [object_to_dict(item) for item in getattr(research_packet, "sources", []) or []]
    research_evidence = [object_to_dict(item) for item in getattr(research_packet, "evidence", []) or []]
    all_evidence_urls = usable_http_urls(research_sources + research_evidence + search_results)
    if not all_evidence_urls:
        return RetrievalResult(
            status="no_results",
            method="research",
            query=query,
            search_results=search_results,
            research_packet=research_packet,
        )

    return RetrievalResult(
        status="success",
        method="research",
        query=query,
        search_results=search_results,
        research_packet=research_packet,
        evidence_urls=all_evidence_urls[:5],
    )


def build_opportunity_packet(persona_name: str, entity_name: str, retrieval: RetrievalResult) -> OpportunityPacket:
    if retrieval.status != "success" or retrieval.research_packet is None or not retrieval.evidence_urls:
        raise ValueError("Only successful evidence-backed retrievals can become OpportunityPackets")

    research = retrieval.research_packet
    title = normalized_title(entity_name, research, retrieval.search_results)
    evidence = []
    for index, source in enumerate((getattr(research, "sources", []) or [])[:5], start=1):
        source_dict = object_to_dict(source)
        if not str(source_dict.get("url", "")).startswith("http"):
            continue
        evidence.append({
            "source_id": source_dict.get("source_id") or f"SRC-{index:03d}",
            "finding": source_dict.get("title") or title,
            "excerpt": source_dict.get("snippet") or source_dict.get("excerpt") or "",
            "url": source_dict.get("url"),
        })

    if not evidence:
        evidence = [{"source_id": "SRC-001", "finding": title, "excerpt": "", "url": retrieval.evidence_urls[0]}]

    confidence = 0.86 if len(retrieval.evidence_urls) >= 2 else 0.78
    return OpportunityPacket(
        packet_id=OpportunityPacket.generate_packet_id(persona_name, title),
        persona=persona_name,
        entity_topic=title,
        what_happened=getattr(research, "executive_summary", "") or title,
        why_now="This surfaced through live SearchAgent retrieval from a monitored Watch List entity and has fresh evidence.",
        confidence=confidence,
        evidence=evidence,
        supporting_sources=retrieval.evidence_urls,
        conversation_summary=" ".join((getattr(research, "key_findings", []) or [])[:2]) or title,
        suggested_operator_action="Review the evidence-backed opportunity and choose one of the three draft options.",
    )


def build_import_payload(
    persona_id: str,
    persona_name: str,
    entity_name: str,
    handle: str,
    retrieval: RetrievalResult,
    run_type: str,
    test_mode: bool,
) -> tuple[dict[str, Any], OpportunityPacket, list[DraftPost]]:
    if retrieval.status != "success":
        raise ValueError(f"Cannot import retrieval status {retrieval.status}")

    packet = build_opportunity_packet(persona_name, entity_name, retrieval)
    drafts = DraftGenerationService().generate_drafts_for_packet(packet)
    generated_at = now_iso()
    evidence_urls = [url for url in packet.supporting_sources if str(url).startswith("http")]
    if not evidence_urls:
        raise ValueError("OpportunityPacket has no usable evidence URLs")

    payload = {
        "runType": run_type,
        "generatedAt": generated_at,
        "testMode": test_mode,
        "provider": "SearchAgent",
        "model": "search_agent_v1",
        "endpoint": f"search_agent://watch_list/{retrieval.method}",
        "jobName": f"hermes-watch-list-bridge-{run_type}",
        "personas": [{
            "personaId": persona_id,
            "signals": [{
                "topic": packet.entity_topic,
                "source": "hermes_x_search",
                "query": retrieval.query,
                "sourceProvider": "SearchAgent",
                "sourceCount": len(evidence_urls),
                "firstSeenAt": generated_at,
                "lastSeenAt": generated_at,
                "velocityScore": 64,
                "relevanceScore": 88,
                "noveltyScore": 76,
                "freshnessScore": 92,
                "riskScore": 12,
                "priorityScore": round(packet.confidence * 100),
                "suggestedAngle": packet.suggested_operator_action,
                "evidenceUrls": evidence_urls,
                "clusterId": f"sa-{run_type}-{packet.packet_id.lower()}",
                "rawData": {
                    "retrievalMethod": retrieval.method,
                    "retrievalStatus": retrieval.status,
                    "entityName": entity_name,
                    "handle": handle,
                    "opportunityPacket": packet.to_dict(),
                    "drafts": [draft.to_dict() for draft in drafts],
                    "searchResults": retrieval.search_results[:5],
                    "testMode": test_mode,
                },
            }],
        }],
    }
    return payload, packet, drafts


def collect_entities(export_data: dict[str, Any], trial: bool) -> list[dict[str, str]]:
    if trial:
        return list(TRIAL_MAPPING)
    entities: list[dict[str, str]] = []
    for persona in export_data.get("personas", []):
        pid = persona.get("id") or persona.get("personaId") or ""
        pname = persona.get("name") or persona.get("displayName") or pid
        for sub in persona.get("trackedEntities", []) or []:
            entity_name = sub.get("entity_name") or sub.get("name") or ""
            handle = sub.get("primary_x_handle") or sub.get("handle") or entity_name
            if entity_name and sub.get("monitor_x", False):
                entities.append({
                    "persona_id": pid,
                    "persona_name": pname,
                    "entity_name": entity_name,
                    "handle": handle,
                })
    return entities


def summarize_operator_queue(queue: dict[str, Any]) -> dict[str, int]:
    personas = queue.get("personas", []) if isinstance(queue, dict) else []
    signals = sum(len(item.get("signals", []) or []) for item in personas)
    drafts = sum(len(item.get("drafts", []) or []) for item in personas)
    notifications = 0
    return {
        "personaCount": len(personas),
        "visibleOperatorItems": signals + drafts,
        "visibleSignals": signals,
        "visibleDrafts": drafts,
        "readyPosts": drafts,
        "notificationsCreated": notifications,
    }


def run_bridge(pcc: PCCClient, trial: bool = True, require_crawl4ai: bool = False) -> dict[str, Any]:
    started_at = now_iso()
    summary: dict[str, Any] = {
        "started_at": started_at,
        "mode": "trial" if trial else "production",
        "status": "running",
        "entities_queued": 0,
        "entities_processed": 0,
        "success": 0,
        "no_results": 0,
        "retrieval_failed": 0,
        "skipped": 0,
        "imports_accepted": 0,
        "imports_rejected": 0,
        "drafts_created": 0,
        "visible_operator_items": 0,
        "notifications_created": 0,
        "errors": [],
        "import_results": [],
        "preflight": {},
    }

    ok, preflight_errors, preflight_details = preflight(pcc, require_crawl4ai=require_crawl4ai)
    summary["preflight"] = preflight_details
    if not ok:
        summary["status"] = "failed"
        summary["errors"].extend(preflight_errors)
        summary["completed_at"] = now_iso()
        logger.error("Preflight failed; aborting without imports: %s", "; ".join(preflight_errors))
        return summary

    export_data = pcc.get_export()
    personas_list = export_data.get("personas", []) if isinstance(export_data, dict) else []
    summary["personas_found"] = len(personas_list)
    entities = collect_entities(export_data, trial=trial)
    summary["entities_queued"] = len(entities)

    run_type = "trial_push" if trial else "morning_digest"
    for entity in entities:
        summary["entities_processed"] += 1
        pid = entity["persona_id"]
        pname = entity["persona_name"]
        ename = entity["entity_name"]
        handle = entity["handle"]
        logger.info("Processing %s (%s) for %s", ename, handle, pname)

        retrieval = retrieve_entity(ename, handle)
        summary[retrieval.status] += 1
        if retrieval.status != "success":
            logger.warning("Skipping import for %s: %s %s", ename, retrieval.status, retrieval.error or "")
            continue

        try:
            payload, packet, drafts = build_import_payload(pid, pname, ename, handle, retrieval, run_type, trial)
            result = pcc.post_import(payload)
            summary["imports_accepted"] += 1
            summary["drafts_created"] += int(result.get("draftsGenerated") or len(drafts))
            summary["import_results"].append({
                "persona_id": pid,
                "persona_name": pname,
                "entity_name": ename,
                "handle": handle,
                "retrieval_status": retrieval.status,
                "packet_id": packet.packet_id,
                "topic": packet.entity_topic,
                "draft_options": len(drafts),
                "import_result": result,
            })
        except (HTTPError, URLError, ValueError) as exc:
            summary["imports_rejected"] += 1
            summary["errors"].append(f"Import rejected for {ename}: {exc}")
            logger.error("Import rejected for %s: %s", ename, exc)
        except Exception as exc:
            summary["imports_rejected"] += 1
            summary["errors"].append(f"Import failed for {ename}: {exc}")
            logger.exception("Import failed for %s", ename)

    try:
        queue_summary = summarize_operator_queue(pcc.get_operator_queue())
        summary.update({
            "visible_operator_items": queue_summary["visibleOperatorItems"],
            "visible_signals": queue_summary["visibleSignals"],
            "visible_drafts": queue_summary["visibleDrafts"],
            "ready_posts": queue_summary["readyPosts"],
        })
    except Exception as exc:
        summary["errors"].append(f"Failed to verify Operator queue: {exc}")

    summary["completed_at"] = now_iso()
    summary["status"] = "completed" if summary["imports_accepted"] > 0 else "no_imports_sent"
    return summary


def print_summary(summary: dict[str, Any]) -> None:
    print("\n" + "=" * 70)
    print("WATCH LIST BRIDGE — RUN SUMMARY")
    print("=" * 70)
    for label, key in [
        ("Status", "status"),
        ("Mode", "mode"),
        ("Personas found", "personas_found"),
        ("Entities queued", "entities_queued"),
        ("Entities processed", "entities_processed"),
        ("Success", "success"),
        ("No results", "no_results"),
        ("Retrieval failed", "retrieval_failed"),
        ("Skipped", "skipped"),
        ("Imports accepted", "imports_accepted"),
        ("Imports rejected", "imports_rejected"),
        ("Drafts created", "drafts_created"),
        ("Visible operator items", "visible_operator_items"),
        ("Ready posts", "ready_posts"),
        ("Started", "started_at"),
        ("Completed", "completed_at"),
    ]:
        print(f"  {label:<24}{summary.get(key, 0)}")
    if summary.get("errors"):
        print(f"  Errors                  {len(summary['errors'])}")
        for err in summary["errors"]:
            print(f"    - {err}")
    print("=" * 70)
    if summary.get("import_results"):
        print("\nImport Results:")
        for item in summary["import_results"]:
            print(
                f"  {item['persona_name']} -> {item['entity_name']} ({item['handle']}): "
                f"{item['topic']} | drafts={item['draft_options']} | "
                f"runId={item['import_result'].get('runId', 'N/A')}"
            )


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Hermes Watch List Bridge")
    parser.add_argument("--trial", action="store_true", help="Trial mode with four mapped entities")
    parser.add_argument("--production", action="store_true", help="Production mode with all active Watch List entities")
    parser.add_argument("--pcc-base-url", default="http://127.0.0.1:3000", help="PCC backend URL")
    parser.add_argument("--require-crawl4ai", action="store_true", help="Require Crawl4AI health in preflight")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    if not args.trial and not args.production:
        parser.print_help()
        sys.exit(1)

    summary = run_bridge(
        PCCClient(base_url=args.pcc_base_url),
        trial=args.trial,
        require_crawl4ai=args.require_crawl4ai,
    )
    print_summary(summary)

    if summary.get("status") == "failed" or summary.get("imports_accepted", 0) == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
