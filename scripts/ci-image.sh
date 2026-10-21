#!/usr/bin/env bash
set -Eeuo pipefail
: "${REVISION:?Set the source revision}"
[[ $REVISION =~ ^[a-f0-9]{40}$ ]]
name="orbat-smoke-${GITHUB_RUN_ID:-local}"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# This Dockerfile packages the existing standalone build; it never rebuilds it.
docker build -f deploy/runtime.Dockerfile --build-arg "APP_REVISION=$REVISION" -t orbat-ci:tested .
docker run -d --name "$name" --network none --memory 768m --cpus 1 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e ADMIN_ACCESS_KEY=disposable-ci-key -e SITE_ORIGIN=https://ci.invalid \
  -e ORBAT_DISABLE_AUTO_RENEW=true orbat-ci:tested >/dev/null
ready=false
for ((n=0;n<45;n++)); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ $ready != true ]]; then docker logs --tail 80 "$name"; exit 1; fi
docker exec -e "EXPECT_REVISION=$REVISION" -e SMOKE_LOGIN=true "$name" node scripts/smoke.mjs
