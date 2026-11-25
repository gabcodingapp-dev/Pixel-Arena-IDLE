#!/usr/bin/env node
/**
 * tools/gen_keystore.js
 *
 * Generates a release signing keystore for Pixel Arena Idle, in pure
 * JavaScript (node-forge), so it works on machines without a JDK.
 *
 * The output is a standard PKCS#12 file ("release.jks") holding an RSA-2048
 * self-signed certificate, sealed with 3DES + SHA-1. That is the exact format
 * the JDK's keytool emits and the Android Gradle Plugin expects, so
 * `keytool -list -keystore release.jks` reads it without conversion.
 *
 *   node tools/gen_keystore.js
 *   node tools/gen_keystore.js --alias pixelarena --password "hunter2" \
 *        --cn "Pixel Arena Idle" --out release.jks --force
 *   node tools/gen_keystore.js --recreate-if-missing   # CI-friendly, no-op if present
 *   node tools/gen_keystore.js --print-base64          # for the KEYSTORE_BASE64 secret
 *
 * IMPORTANT: the keystore is the app's identity. If you lose it you can never
 * ship an update to the same Play listing again. Back it up somewhere safe.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");

function resolveForge() {
  const tries = [
    "node-forge",
    path.join("/tmp/node_modules", "node-forge"),
    path.join(ROOT, "node_modules", "node-forge"),
  ];
  for (const t of tries) {
    try { return require(t); } catch (e) { /* next */ }
  }
  console.error(
    "node-forge is required to generate a keystore:\n  npm install --no-save node-forge"
  );
  process.exit(2);
}

const forge = resolveForge();

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const out = {
    alias: "pixelarena",
    password: null,
    out: path.join(ROOT, "release.jks"),
    cn: "Pixel Arena Idle",
    org: "Pixel Arena",
    days: 365 * 30,
    force: false,
    recreateIfMissing: false,
    printBase64: false,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--alias": out.alias = next(); break;
      case "--password": out.password = next(); break;
      case "--out": out.out = path.resolve(next()); break;
      case "--cn": out.cn = next(); break;
      case "--org": out.org = next(); break;
      case "--days": out.days = parseInt(next(), 10); break;
      case "--force": out.force = true; break;
      case "--recreate-if-missing": out.recreateIfMissing = true; break;
      case "--print-base64": out.printBase64 = true; break;
      case "--quiet": out.quiet = true; break;
      case "-h":
      case "--help":
        console.log(
          "usage: node tools/gen_keystore.js [--alias NAME] [--password PASS]\n" +
          "         [--out PATH] [--cn NAME] [--org ORG] [--days N]\n" +
          "         [--force] [--recreate-if-missing] [--print-base64]"
        );
        process.exit(0);
        break;
      default:
        if (a.startsWith("--")) { console.error("Unknown option: " + a); process.exit(2); }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ keys */
function makeKeyPair(bits) {
  // node-forge's JS RSA keygen is slow but dependency-free.
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: bits || 2048, workers: -1 }, (err, pair) => {
      if (err) return reject(err);
      resolve(pair);
    });
  });
}

function makeCert(pair, opts) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  // A positive, non-sequential serial; random to avoid collisions between
  // separately generated keystores.
  cert.serialNumber = "01" + crypto.randomBytes(14).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day skew
  cert.validity.notAfter = new Date(Date.now() + opts.days * 24 * 60 * 60 * 1000);

  const attrs = [
    { name: "commonName", value: opts.cn },
    { name: "organizationName", value: opts.org },
    { name: "organizationalUnitName", value: "Android" },
    { name: "countryName", value: "PH" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // self-signed

  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: false, codeSigning: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: "com.pixelarena.idle" }] },
  ]);

  cert.sign(pair.privateKey, forge.md.sha256.create());
  return cert;
}

function makePkcs12(pair, cert, password, alias) {
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    pair.privateKey,
    [cert],
    password,
    {
      algorithm: "3des", // keytool-compatible; reads on JDK 8+ and Android
      friendlyName: alias,
      generateLocalKeyId: true,
      useMac: true,
    }
  );
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  // forge returns a binary string; write real bytes.
  return Buffer.from(der, "binary");
}

/* ----------------------------------------------------------------- verify */
/**
 * Re-open the PKCS#12 we just built and prove the password, MAC, key and
 * certificate all round-trip. This is the closest we can get to
 * `keytool -list` without a JVM, and it catches the failure that actually
 * bites people: a keystore that builds but can't be used to sign.
 */
function verify(p12Buffer, password, alias) {
  const asn1 = forge.asn1.fromDer(p12Buffer.toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

  // forge returns bags keyed by OID, with the alias inside bag.attributes;
  // flatten them the way keytool reports aliases.
  function flatten(bagsByOid) {
    const out = [];
    for (const oid of Object.keys(bagsByOid)) {
      for (const bag of bagsByOid[oid] || []) {
        const fn = bag.attributes && bag.attributes.friendlyName;
        out.push({ alias: Array.isArray(fn) ? fn[0] : fn, bag });
      }
    }
    return out;
  }

  const keyBags = flatten(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }));
  const certBags = flatten(p12.getBags({ bagType: forge.pki.oids.certBag }));
  const keyEntries = keyBags.length;
  const certEntries = certBags.length;
  const foundAlias = keyBags.concat(certBags).some((e) => e.alias === alias);
  if (keyEntries < 1) throw new Error("no private key bag in keystore");
  if (certEntries < 1) throw new Error("no certificate bag in keystore");
  if (!foundAlias) throw new Error('alias "' + alias + '" not found in keystore');

  // Wrong password must be rejected (MAC check).
  let rejected = false;
  try {
    forge.pkcs12.pkcs12FromAsn1(asn1, false, password + "-wrong");
  } catch (e) {
    rejected = true;
  }
  if (!rejected) throw new Error("keystore accepted an incorrect password");

  // Confirm the certificate really belongs to the key.
  const certBeg = certBags[0].bag.cert;
  const keyBeg = keyBags[0].bag.key;
  if (!certBeg || !keyBeg) throw new Error("empty key or certificate entry");
  const certPub = certBeg.publicKey;
  const keyPub = forge.pki.rsa.setPublicKey(keyBeg.n, keyBeg.e);
  if (certPub.n.compareTo(keyPub.n) !== 0) {
    throw new Error("certificate public key does not match the private key");
  }

  return {
    keyEntries,
    certEntries,
    subject: certBeg.subject.getField("CN").value,
    issuer: certBeg.issuer.getField("CN").value,
    notAfter: certBeg.validity.notAfter,
    bits: keyBeg.n.bitLength(),
  };
}

/* ------------------------------------------------------------------- main */
(async function main() {
  const opts = parseArgs(process.argv);

  if (fs.existsSync(opts.out)) {
    if (opts.force) {
      if (!opts.quiet) console.log("  existing keystore overwritten (--force)");
    } else if (opts.recreateIfMissing) {
      if (!opts.quiet) console.log("  keystore already present, leaving it alone");
      if (opts.printBase64) {
        process.stdout.write(fs.readFileSync(opts.out).toString("base64") + "\n");
      }
      return;
    } else {
      console.error(
        "Refusing to overwrite " + opts.out + "\n" +
        "  A keystore is your app's permanent identity — overwriting it means no\n" +
        "  future update can be installed over an existing release.\n" +
        "  Pass --force only if you are certain."
      );
      process.exit(1);
    }
  }

  // Random strong password when not supplied, so a default never ships.
  const password = opts.password || crypto.randomBytes(18).toString("base64")
    .replace(/[^A-Za-z0-9]/g, "").slice(0, 22);

  if (!opts.quiet) {
    console.log("Pixel Arena Idle — release keystore");
    console.log("  alias      " + opts.alias);
    console.log("  validity   " + opts.days + " days");
    console.log("  generating RSA-2048 key pair (a few seconds)...");
  }

  const pair = await makeKeyPair(2048);
  const cert = makeCert(pair, opts);
  const p12 = makePkcs12(pair, cert, password, opts.alias);

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, p12, { mode: 0o600 });

  const info = verify(p12, password, opts.alias);

  // Sidecar properties file: the Android build picks this up automatically,
  // and it keeps the password out of the keystore itself.
  const propsPath = path.join(path.dirname(opts.out), "keystore.properties");
  fs.writeFileSync(
    propsPath,
    [
      "# Generated by tools/gen_keystore.js.",
      "# For a public repo, prefer repository secrets over committing this.",
      "storeFile=" + path.basename(opts.out),
      "storePassword=" + password,
      "keyAlias=" + opts.alias,
      "keyPassword=" + password,
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  if (!opts.quiet) {
    console.log("");
    console.log("  ✓ " + path.relative(ROOT, opts.out) + "  (" + p12.length + " bytes)");
    console.log("  ✓ " + path.relative(ROOT, propsPath));
    console.log("");
    console.log("  verified: " + info.certEntries + " certificate, " + info.keyEntries +
      " private key, " + info.bits + "-bit RSA");
    console.log("  subject:  CN=" + info.subject + ", O=" + opts.org);
    console.log("  valid to: " + info.notAfter.toISOString().slice(0, 10));
    console.log("");
    console.log("  store password: " + password);
    console.log("");
    console.log("  Local builds now sign automatically:  npm run apk:release");
    console.log("  For CI, add these repository secrets (Settings → Secrets → Actions):");
    console.log("    KEYSTORE_BASE64   = base64 of " + path.basename(opts.out));
    console.log("    KEYSTORE_PASSWORD = " + password);
    console.log("    KEY_ALIAS         = " + opts.alias);
    console.log("    KEY_PASSWORD      = " + password);
    console.log("");
    console.log("  To print the base64 value:  node tools/gen_keystore.js --print-base64");
    console.log("");
    console.log("  ⚠  Back this file up. If it is lost, you cannot update the app again.");
  }

  if (opts.printBase64) process.stdout.write(p12.toString("base64") + "\n");
})().catch((err) => {
  console.error("keystore generation failed: " + (err && err.message));
  process.exit(1);
});
