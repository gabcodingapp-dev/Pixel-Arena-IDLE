#!/usr/bin/env node
/**
 * tools/keystore_fingerprint.js
 *
 * Prints the SHA-256 fingerprint of the certificate inside a keystore, in the
 * same format `apksigner verify --print-certs` and `keytool -list` use.
 *
 * This exists so CI can assert an invariant instead of logging a value:
 * the APK must be signed by the certificate in release.jks, not by the debug
 * key or a regenerated one. A mismatch fails the build.
 *
 *   node tools/keystore_fingerprint.js [--keystore release.jks] [--password ...]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");

function resolveForge() {
  for (const t of ["node-forge", path.join(ROOT, "node_modules", "node-forge")]) {
    try { return require(t); } catch (e) { /* next */ }
  }
  console.error("node-forge not found: npm install");
  process.exit(2);
}

const forge = resolveForge();

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
}

const propsPath = path.join(ROOT, args.properties || "keystore.properties");
const props = {};
if (fs.existsSync(propsPath)) {
  for (const line of fs.readFileSync(propsPath, "utf8").split("\n")) {
    const m = /^(\w+)=(.*)$/.exec(line.trim());
    if (m) props[m[1]] = m[2];
  }
}

const keystore = path.resolve(ROOT, args.keystore || props.storeFile || "release.jks");
const password = args.password || props.storePassword || process.env.KEYSTORE_PASSWORD;

if (!fs.existsSync(keystore)) {
  console.error("keystore not found: " + keystore);
  process.exit(1);
}
if (!password) {
  console.error("no keystore password (set KEYSTORE_PASSWORD or keystore.properties)");
  process.exit(1);
}

const p12 = forge.pkcs12.pkcs12FromAsn1(
  forge.asn1.fromDer(fs.readFileSync(keystore).toString("binary")),
  false,
  password
);
const certBags = Object.values(p12.getBags({ bagType: forge.pki.oids.certBag })).flat();
if (!certBags.length) {
  console.error("no certificate in keystore");
  process.exit(1);
}
const cert = certBags[0].cert;

// apksigner hashes the DER-encoded certificate itself.
const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
const digest = crypto.createHash("sha256").update(der).digest("hex").toUpperCase();

// keytool-style colon-separated form, and the compact form apksigner prints.
const colon = digest.match(/../g).join(":");
const cn = cert.subject.getField("CN") ? cert.subject.getField("CN").value : "";

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ sha256: digest, colon, subject: cn }, null, 2));
} else {
  console.log(digest);
}
