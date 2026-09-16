// Turns a plaintext admin passcode into the hashed form ADMIN_USERS accepts,
// so the deployed secret no longer contains anything that can be typed into
// the login box.
//
//   npx tsx scripts/hash-admin-passcode.ts 'Ben' 'their-passcode'
//
// Prints one `Name:scrypt$...` entry. Join several with commas to build the
// whole ADMIN_USERS value. Plaintext entries keep working, so this can be
// done one person at a time.
//
// The passcode is read from argv, which means it lands in shell history --
// prefix the command with a space if the shell is configured to skip those,
// and rotate anything that was ever plaintext in a deployed env var anyway.

import { randomBytes, scrypt } from "node:crypto";

// Cost parameters. N is the work factor; 2^16 takes a few hundred ms on a
// laptop, which is invisible on a login and ruinous for anyone grinding
// guesses offline against a leaked env var.
const N = 65536;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

async function main() {
  const [name, passcode] = process.argv.slice(2);

  if (!name || !passcode) {
    console.error(
      "Usage: npx tsx scripts/hash-admin-passcode.ts '<Name>' '<passcode>'"
    );
    process.exit(1);
  }
  if (name.includes(":") || name.includes(",")) {
    console.error("A name cannot contain ':' or ',' -- they separate entries.");
    process.exit(1);
  }
  if (passcode.length < 12) {
    // The hash protects a leaked env var, not a guessable passcode. A short
    // one is still brute-forceable through the login box.
    console.error(
      `Refusing: that passcode is ${passcode.length} characters. Use at least 12.`
    );
    process.exit(1);
  }

  const salt = randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(passcode, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 256 * N * R }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });

  const entry = `${name}:scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;

  console.log("\nAdd this to ADMIN_USERS (comma-separate multiple people):\n");
  console.log(entry);
  console.log(
    "\nThe passcode itself is not stored anywhere by this script. Keep it safe;" +
      "\nit cannot be recovered from the hash."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
