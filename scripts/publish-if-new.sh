#!/usr/bin/env bash
# Publish guard for the release workflow.
#
# Every push to `main` triggers changesets/action with a publish input. The
# action's "is there anything to publish" check doesn't reliably detect that
# the local package.json version is already on the registry, so it calls our
# publish command unconditionally. When the version IS already published,
# npm correctly rejects with "You cannot publish over the previously
# published versions: X.Y.Z" and the workflow surfaces as a CI failure email
# even though the system is healthy.
#
# This script short-circuits the publish when local + remote versions
# match, treating the docs-only / workflow-only commit case as a clean
# no-op. When versions differ (i.e., a Version Packages PR was just
# merged), it runs the real `npm publish` with the full OIDC + provenance
# flags.

set -euo pipefail

PACKAGE_NAME="@retenka/storefront-events-polyfill"

LOCAL_VERSION=$(node -p "require('./package.json').version")
# `npm view @scope/pkg@<version> version` returns the version string when it
# exists, empty when not. 2>/dev/null swallows the "not found" stderr noise.
REMOTE_VERSION=$(npm view "${PACKAGE_NAME}@${LOCAL_VERSION}" version 2>/dev/null || true)

echo "::notice::local=${LOCAL_VERSION} remote(for that exact version)=${REMOTE_VERSION:-<not published>}"

if [ "${LOCAL_VERSION}" = "${REMOTE_VERSION}" ]; then
  echo "::notice::Version ${LOCAL_VERSION} already on registry; skipping publish"
  exit 0
fi

echo "::notice::Publishing ${PACKAGE_NAME}@${LOCAL_VERSION} via OIDC trusted publishing"
exec npm publish --access public --provenance --loglevel verbose
