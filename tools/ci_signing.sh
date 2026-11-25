#!/usr/bin/env bash
#
# tools/ci_signing.sh
#
# Resolves the release signing identity for a build, in priority order:
#
#   1. Repository secrets — KEYSTORE_BASE64 (+ password / alias / key password)
#   2. A committed keystore.properties (the project's dev identity)
#   3. A freshly generated key, so a release build is always signable
#
# Writes the resolved credentials to $GITHUB_ENV (when running in Actions) or
# prints them for local use, then verifies the keystore with keytool when a
# JDK is available.
#
# Exits non-zero rather than producing an unverifiable artifact.
set -euo pipefail

OUT_DIR="${SIGNING_DIR:-.}"
KS_PATH="$OUT_DIR/release.jks"
PROPS="$OUT_DIR/keystore.properties"

BASE64_SRC=""
[ -n "${KEYSTORE_BASE64:-}" ] && BASE64_SRC="secrets"

if [ "$BASE64_SRC" = "secrets" ]; then
  echo "signing: using keystore from repository secrets"
  printf '%s' "$KEYSTORE_BASE64" | base64 -d > "$KS_PATH"
  STORE_PW="${KEYSTORE_PASSWORD:-}"
  ALIAS="${KEY_ALIAS:-}"
  KEY_PW="${KEY_PASSWORD:-${KEYSTORE_PASSWORD:-}}"
  SOURCE="secrets"

elif [ -f "$PROPS" ]; then
  echo "signing: using $PROPS (project dev identity)"
  STORE_PW="$(sed -n 's/^storePassword=//p' "$PROPS" | head -1)"
  ALIAS="$(sed -n 's/^keyAlias=//p' "$PROPS" | head -1)"
  KEY_PW="$(sed -n 's/^keyPassword=//p' "$PROPS" | head -1)"
  KS_NAME="$(sed -n 's/^storeFile=//p' "$PROPS" | head -1)"
  if [ -n "$KS_NAME" ] && [ -f "$OUT_DIR/$KS_NAME" ]; then
    KS_PATH="$OUT_DIR/$KS_NAME"
  fi
  SOURCE="keystore.properties"

else
  echo "signing: no secrets or properties found — generating a project key"
  node tools/gen_keystore.js --quiet --force --out "$KS_PATH"
  STORE_PW="$(sed -n 's/^storePassword=//p' "$PROPS" | head -1)"
  ALIAS="$(sed -n 's/^keyAlias=//p' "$PROPS" | head -1)"
  KEY_PW="$(sed -n 's/^keyPassword=//p' "$PROPS" | head -1)"
  SOURCE="generated"
fi

# --- validate before touching Gradle ------------------------------------------
if [ ! -f "$KS_PATH" ]; then
  echo "::error::signing keystore not found at $KS_PATH"; exit 1
fi
if [ -z "${STORE_PW:-}" ] || [ -z "${ALIAS:-}" ]; then
  echo "::error::signing password or alias is empty (source: ${SOURCE:-unknown})"; exit 1
fi
# Record the source without leaking the password.
echo "signing: source=$SOURCE alias=$ALIAS keystore=$(basename "$KS_PATH")"

# --- export for Gradle -------------------------------------------------------
export_vars() {
  echo "KEYSTORE_PATH=$(cd "$(dirname "$KS_PATH")" && pwd)/$(basename "$KS_PATH")"
  echo "KEYSTORE_PASSWORD=$STORE_PW"
  echo "KEY_ALIAS=$ALIAS"
  echo "KEY_PASSWORD=$KEY_PW"
}
if [ -n "${GITHUB_ENV:-}" ]; then
  export_vars >> "$GITHUB_ENV"
  echo "signing: wrote credentials to \$GITHUB_ENV"
else
  export_vars
fi

# --- verify the keystore really loads ---------------------------------------
if command -v keytool >/dev/null 2>&1; then
  echo "--- keytool ---"
  keytool -list -keystore "$KS_PATH" -storepass "$STORE_PW" -alias "$ALIAS" \
    -storetype PKCS12 2>&1 | tee /tmp/keytool.out
  if ! grep -q "PrivateKeyEntry" /tmp/keytool.out; then
    echo "::error::keytool did not report a PrivateKeyEntry for alias '$ALIAS'"
    exit 1
  fi
  echo "signing: key verified by keytool"
else
  echo "signing: keytool unavailable, skipping JDK-side verification"
  node -e '
    const fs=require("fs"), forge=require("node-forge");
    const [file, pw, alias]=process.argv.slice(1);
    const p12=forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(fs.readFileSync(file).toString("binary")), false, pw);
    const keys=p12.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag});
    const n=Object.values(keys).flat().filter(b=>{
      const f=b.attributes&&b.attributes.friendlyName;
      return (Array.isArray(f)?f[0]:f)===alias;
    }).length;
    if(!n){ console.error("alias not found: "+alias); process.exit(1); }
    console.log("signing: key verified by node-forge ("+n+" entry)");
  ' "$KS_PATH" "$STORE_PW" "$ALIAS"
fi
