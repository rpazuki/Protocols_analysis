#!/usr/bin/env bash
# Run as root on the deployment host. All functions are parsed before git pull.
set -Eeuo pipefail

usage() {
    cat <<'HELP'
Usage: sudo bash scripts/deploy/update.sh [options]
  --mode native|docker  Default: native (systemd); Docker updates only app
  --repo PATH           Default: directory containing this script's repository
  --user NAME           Native checkout/service user (default: protocols)
  --service NAME        Native unit (default: protocols-analysis)
  --owner-env PATH      Owner environment (default: /etc/protocols-analysis/owner.env)
  --app-env PATH        Docker Compose env (default: /etc/protocols-analysis/app.env)
  --health-url URL      Default: http://127.0.0.1:3200/protocols/api/health
  --base-path PATH      Build prefix (default: /protocols)
  --help
Take a protected database backup before running. This is an updater, not a fresh
installer. Docker mode requires the existing db container to be running; it never
pulls/recreates PostgreSQL or touches nginx or other projects. Environment files
are read by systemd, never sourced as shell code. Do not run with bash -x.
HELP
}
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require_root() { (( EUID == 0 )) || fail 'Run this script with sudo bash.'; }
need() { command -v "$1" >/dev/null || fail "Required command not found: $1"; }
as_app() { sudo -u "$app_user" -- "$@"; }
compose() { docker compose -f "$repo/infra/environments/production/docker-compose.yml" --env-file "$app_env" "$@"; }
owner_native() {
    systemd-run --quiet --wait --pipe --collect --uid="$app_user" \
        --property="EnvironmentFile=$owner_env" --working-directory="$repo" \
        "$node_bin" --experimental-strip-types scripts/db/migrate.ts
}
owner_docker() {
    # Pass owner variables through the environment, never in command arguments.
    systemd-run --quiet --wait --pipe --collect \
        --property="EnvironmentFile=$owner_env" --working-directory="$repo" \
        "$(command -v docker)" compose \
        -f "$repo/infra/environments/production/docker-compose.yml" --env-file "$app_env" \
        run --rm --no-deps -T --env DATABASE_URL --env DATABASE_SSL \
        --env DATABASE_SSL_REJECT_UNAUTHORIZED --entrypoint node app \
        --experimental-strip-types scripts/db/migrate.ts
}
on_error() {
    local result=$?
    trap - ERR
    printf '\nDeployment failed (exit %s). No Git or database rollback was attempted.\n' "$result" >&2
    if [[ ${app_stopped:-false} == true ]]; then
        printf 'The app may be stopped or unhealthy. Correct the error and rerun this script.\n' >&2
    fi
    exit "$result"
}
main() {
    local mode=native repo app_user=protocols service=protocols-analysis
    local owner_env=/etc/protocols-analysis/owner.env app_env=/etc/protocols-analysis/app.env
    local health_url=http://127.0.0.1:3200/protocols/api/health base_path=/protocols
    local node_bin app_stopped=false before after body attempt healthy=false
    repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
    while (( $# )); do
        case "$1" in
            --help|-h) usage; return 0 ;;
            --mode|--repo|--user|--service|--owner-env|--app-env|--health-url|--base-path)
                (( $# >= 2 )) || fail "Missing value for $1"
                case "$1" in
                    --mode) mode=$2 ;; --repo) repo=$2 ;; --user) app_user=$2 ;;
                    --service) service=$2 ;; --owner-env) owner_env=$2 ;;
                    --app-env) app_env=$2 ;; --health-url) health_url=$2 ;; --base-path) base_path=$2 ;;
                esac
                shift 2 ;;
            *) fail "Unknown option: $1" ;;
        esac
    done
    [[ $mode == native || $mode == docker ]] || fail 'Mode must be native or docker.'
    [[ $base_path == /* && $base_path != */ && $base_path != *' '* ]] || fail 'Use a base path such as /protocols, without a trailing slash.'
    require_root
    for command in git sudo flock systemd-run curl; do need "$command"; done
    repo=$(cd -- "$repo" && pwd -P)
    cd -- "$repo"
    [[ -f package.json && -d db/migrations ]] || fail 'Not a Protocols Analysis checkout.'
    [[ -f $owner_env && -r $owner_env ]] || fail "Missing readable owner environment: $owner_env"
    # One updater per checkout, shared across modes. No lock file in the worktree.
    local git_dir
    git_dir=$(as_app git rev-parse --absolute-git-dir)
    exec 9>"$git_dir/protocols-deploy.lock"
    flock -n 9 || fail 'Another deployment is running for this checkout.'
    trap on_error ERR
    [[ -z $(as_app git status --porcelain --untracked-files=normal) ]] || fail 'Checkout has local edits/untracked files. Reconcile them before deploying.'
    as_app git symbolic-ref --quiet HEAD >/dev/null || fail 'Checkout is on a detached HEAD.'
    as_app git rev-parse --abbrev-ref '@{upstream}' >/dev/null || fail 'Current branch has no upstream.'
    if [[ $mode == native ]]; then
        need systemctl; need node; need npm
        node_bin=$(command -v node)
        "$node_bin" --experimental-strip-types -e ''
        systemctl cat "$service" >/dev/null
    else
        need docker
        [[ -f $app_env && -r $app_env ]] || fail "Missing readable Compose environment: $app_env"
        docker compose version >/dev/null
        # Validate silently: expanded Compose configuration contains secrets.
        compose config --quiet
        [[ -n $(compose ps --status running -q db) ]] || fail 'Existing Compose db must already be running. This updater does not install or restart databases.'
    fi
    before=$(as_app git rev-parse HEAD)
    as_app git pull --ff-only
    after=$(as_app git rev-parse HEAD)
    printf 'Deploying Protocols %s -> %s (%s).\n' "${before:0:12}" "${after:0:12}" "$mode"
    # Rebuild even at the same revision: safely retries an interrupted deployment
    # and incorporates operator changes to environment/build configuration.
    if [[ $mode == native ]]; then
        systemctl stop "$service"
        app_stopped=true
        as_app npm ci --include=dev
        owner_native  # checksum validation + only pending migrations are applied
        as_app env NODE_ENV=production NEXT_PHASE=phase-production-build \
            NEXT_TELEMETRY_DISABLED=1 APP_BASE_PATH="$base_path" NEXT_PUBLIC_BASE_PATH="$base_path" \
            npm run build --workspace apps/web
        as_app mkdir -p apps/web/.next/standalone/apps/web/.next/static
        as_app cp -a apps/web/.next/static/. apps/web/.next/standalone/apps/web/.next/static/
        if [[ -d apps/web/public ]]; then
            as_app cp -a apps/web/public apps/web/.next/standalone/apps/web/
        fi
        [[ -f apps/web/.next/standalone/apps/web/server.js ]] || fail 'Standalone server was not produced; service remains stopped.'
        systemctl start "$service"
    else
        # Build first while the old app continues serving. Never pull/rebuild db.
        compose build app
        compose stop app
        app_stopped=true
        owner_docker
        compose up -d --no-deps app
    fi
    for (( attempt=1; attempt<=30; attempt++ )); do
        if body=$(curl --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 5 "$health_url" 2>/dev/null) &&
            printf '%s' "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
            healthy=true
            break
        fi
        sleep 2
    done
    [[ $healthy == true ]] || fail "Health check failed: $health_url. Inspect service/container logs; do not roll back a migrated database blindly."
    app_stopped=false
    printf 'Deployment complete; health check passed: %s\n' "$health_url"
    printf 'Also check login and CSS in your browser through nginx.\n'
    trap - ERR
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
    main "$@"
fi
