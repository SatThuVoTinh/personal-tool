# Phase 1 infrastructure scan — infra-1

- **Mode:** Audit
- **Target:** Working tree at dispatch, HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a` (dirty baseline documented in `docs/execution/context.md`)
- **Scope:** `infrastructure/` — Docker/Compose services, networks, volumes, healthchecks, startup order, resource ceilings
- **Checks run:** Read-only source and register inspection. Docker commands and tests were not run.
- **Result:** 1 confirmed candidate; 0 hypotheses; 0 out-of-scope pointers.

## Confirmed candidates

### CAND-infra-1-01 — Production Knowledge has unrestricted bridge-network egress around the model allowlist

- **Path:** `infrastructure/docker/compose/compose.core.yml:182-183` and `:221-222`
- **Evidence:** The deployed `knowledge` service joins `platform` (`:182-183`), whose only network control is `driver: bridge` (`:221-222`); it is not declared `internal: true`. On standard Docker bridge networking, containers can initiate outbound connections through the host unless an external host policy blocks them. The service also maps `host.docker.internal` (`:164-165`) and sets its configured model URL to the allowlisted Nginx route (`:157-160`). The Nginx config permits only the exact `/ollama/api/tags` and `/ollama/api/embed` paths and returns 404 elsewhere (`infrastructure/nginx/conf.d/default.conf:29-47`), but the ordinary bridge gives Knowledge a direct network path that bypasses that gateway. The acceptance network is explicitly internal (`infrastructure/docker/compose/compose.m3-t5.acceptance.yml:52-58`); its direct TCP and DNS egress probes are in `infrastructure/docker/scripts/knowledge-t5-common.ps1:591-609`. The live driver instead runs the model allowlist proof (`infrastructure/docker/scripts/knowledge-t5-live.ps1:463-472`), whose checks cover the Nginx route and refused proxy paths, not general direct egress (`knowledge-t5-common.ps1:570-588`). A host firewall may independently restrict traffic; no such restriction is configured in this Compose slice.
- **Impact:** If the Knowledge process is compromised or induced to make an outbound request, it can reach arbitrary external services directly and bypass the documented model API allowlist. The model gateway therefore does not enforce the intended egress boundary for the deployed service.
- **Severity:** Medium — direct egress requires an outbound-capable code path or process compromise, and host firewall policy may reduce exposure.
- **Concrete reproduction:** With the deployed Knowledge container running on a default Docker Engine host, run `docker exec <knowledge-container> python -c "import socket; socket.create_connection(('1.1.1.1',443),3).close()"`. A successful connection demonstrates direct public TCP egress. Then verify that a request to an unlisted Ollama endpoint through `http://nginx:8080/ollama/api/pull` is refused while a direct connection to the host model service remains reachable. This probe was not run in this read-only scan.
- **Class:** 1 — security flaw
- **Other modules touched:** Knowledgebase runtime; Nginx model gateway
- **Confidence:** Medium — the Compose declaration does not block egress and default bridge behavior allows it; actual reachability can additionally depend on host firewall policy.
- **Register cross-check:** No existing finding describing this deployed direct-egress path was found. `F-520` concerns the repository-policy parser dropping malformed Compose files; `F-569` concerns incomplete network-driver comparison. Neither records this runtime egress boundary.

## Hypotheses

None.

## Out-of-scope pointers

None.
