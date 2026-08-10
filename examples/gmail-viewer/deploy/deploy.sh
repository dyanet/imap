#!/usr/bin/env bash
#
# Provision + deploy mail-example (the gmail-viewer example app) on a single
# Debian/Ubuntu host. Same mechanism as sesgun and qpedia-pvt: image-based,
# idempotent — CI builds the image and pushes it to GHCR, this script only
# installs Docker (if missing), pulls the pinned tag, and starts the stack.
# No build happens on this host.
#
# Ingress: this script never binds 80/443. demo.dyanet.com hosts several
# /examples/* apps, so this script writes a PATH-SCOPED route snippet to
# /opt/ingress/sites/mail-example.caddy (not a whole-domain file) and reloads
# the shared ingress-caddy container (a separate project, deployed once per
# host BEFORE this one — see the `ingress` repo). If ingress-caddy isn't
# running on this host yet, the route is still written; it goes live the
# next time ingress-caddy starts or reloads.
#
# IMPORTANT: the app strips its own BASE_URL path prefix internally (see
# `basePath` in src/server.ts), so the route below forwards the FULL request
# path unchanged — do NOT use `handle_path` (which would strip the prefix a
# second time and break routing).
#
# Server layout (all installed by this script):
#   /opt/mail-example/docker-compose.yml   <- compose file (from COMPOSE_SRC)
#   /opt/mail-example/data/env             <- app env file (0600, from ENV_SRC)
#
# Inputs (env):
#   ENV_SRC          production env file to install         [default: /tmp/mail-example.env]
#   COMPOSE_SRC       compose file to install                 [default: /tmp/mail-example-compose.yml]
#   GHCR_TOKEN_FILE  file with a GHCR pull token (read:packages);
#                    read once, then shredded. Optional if the package is public.
#   GHCR_USER        username for docker login ghcr.io       [default: dyanet]
#   APP_TAG          image tag (CI pins to commit SHA)       [default: latest]
#
# env-file keys consumed here (from ENV_SRC, before it's installed):
#   BASE_URL   full public URL incl. path, e.g.
#              https://demo.dyanet.com/examples/gmail-viewer (required;
#              the domain + path portion drive the ingress route)
set -euo pipefail

ENV_SRC="${ENV_SRC:-/tmp/mail-example.env}"
COMPOSE_SRC="${COMPOSE_SRC:-/tmp/mail-example-compose.yml}"
GHCR_TOKEN_FILE="${GHCR_TOKEN_FILE:-}"
GHCR_USER="${GHCR_USER:-dyanet}"
APP_TAG="${APP_TAG:-latest}"

APP_DIR="/opt/mail-example"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || { echo "deploy.sh needs root: set DEPLOY_USER=root or give the user passwordless sudo"; exit 1; }
  exec sudo -E -- bash "$0" "$@"
fi
[ -f "${ENV_SRC}" ]     || { echo "missing env file at ${ENV_SRC}"; exit 1; }
[ -f "${COMPOSE_SRC}" ] || { echo "missing compose file at ${COMPOSE_SRC}"; exit 1; }

log "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates

log "Docker (install if missing)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version >/dev/null || { echo "docker compose v2 plugin missing"; exit 1; }

log "Install compose file + env"
install -d "${APP_DIR}" "${APP_DIR}/data"
install -m 644 "${COMPOSE_SRC}" "${APP_DIR}/docker-compose.yml"
install -m 600 "${ENV_SRC}" "${APP_DIR}/data/env"

env_val() { sed -n "s/^$1=//p" "${ENV_SRC}" | head -n1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
BASE_URL="$(env_val BASE_URL)"
[ -n "${BASE_URL}" ] || { echo "BASE_URL missing from env file"; exit 1; }

# Split BASE_URL into host + path with a tiny inline node/python-free parse
# (avoid depending on either being installed on a fresh host).
DOMAIN="$(printf '%s' "${BASE_URL}" | sed -E 's#^[a-zA-Z]+://([^/]+).*#\1#')"
URL_PATH="$(printf '%s' "${BASE_URL}" | sed -E 's#^[a-zA-Z]+://[^/]+(/.*)?$#\1#')"
[ -n "${DOMAIN}" ] || { echo "could not parse host out of BASE_URL='${BASE_URL}'"; exit 1; }
URL_PATH="${URL_PATH%/}"
[ -n "${URL_PATH}" ] || { echo "BASE_URL='${BASE_URL}' has no path — refusing to route the whole domain to one example app"; exit 1; }

( umask 077; printf 'APP_TAG=%s\n' "${APP_TAG}" > "${APP_DIR}/.env" )

log "Ingress route registration (path-scoped snippet, shared ingress-caddy)"
# Shared network: created here defensively in case this app deploys before
# the `ingress` project on a brand-new host. No-op once ingress already
# created it.
docker network create ingress 2>/dev/null || true
install -d /opt/ingress/sites
{
  printf '@mail_example_route path %s*\n' "${URL_PATH}"
  printf 'handle @mail_example_route {\n\treverse_proxy mail-example-app:3000\n}\n'
} > /opt/ingress/sites/mail-example.caddy

log "GHCR login + pull (app:${APP_TAG})"
if [ -n "${GHCR_TOKEN_FILE}" ] && [ -s "${GHCR_TOKEN_FILE}" ]; then
  tr -d '\r\n' < "${GHCR_TOKEN_FILE}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
  shred -u "${GHCR_TOKEN_FILE}" 2>/dev/null || rm -f "${GHCR_TOKEN_FILE}"
fi
cd "${APP_DIR}"
docker compose pull

log "Start the stack"
docker compose up -d --remove-orphans

log "Wait for app health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:3000/" >/dev/null 2>&1; then
    echo "health: ok"; break
  fi
  sleep 2
  [ "$i" -eq 30 ] && { echo "app did not become healthy in time"; docker compose logs --tail 40 mail-example-app; exit 1; }
done

log "Reload shared ingress-caddy"
if docker exec ingress-caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null; then
  echo "route live"
else
  echo "NOTE: ingress-caddy not found/reachable on this host — deploy the 'ingress' project here; the route is written and will go live on its next start/reload"
fi

log "Status"
docker compose ps
printf '\nDeployed mail-example (app:%s). %s\n' "${APP_TAG}" "${BASE_URL}"
