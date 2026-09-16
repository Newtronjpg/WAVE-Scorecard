// Turns a plaintext admin passcode into the hashed form ADMIN_USERS accepts,
// so the deployed secret no longer contains anything that can be typed into
// the login box.
//
//   npx tsx scripts/hash-admin-passcode.ts 'Ben'
//
// Prints one `Name:scrypt$...` entry. Join several with commas to build the
// whole ADMIN_USERS value. Plaintext entries keep working, so this can be
// done one person at a time.
//
// The passcode is PROMPTED FOR, not passed as an argument, and is not echoed
// as it is typed. An argument would be recorded in shell history and visible
// in the process list to anyone else on the machine -- a poor way to handle
// the one secret this script exists to protect. It is asked for twice,
// because hashing a typo would lock the real passcode out.

import { createInterface } from "node:readline";
import { randomBytes, scrypt } from "node:crypto";

// Piped stdin (a test, or `printf ... | npx tsx ...`) has nothing to echo to,
// and the muting trick below needs a real terminal to work at all. One shared
// reader serves every prompt from the piped lines, because opening a second
// interface over an already-consumed stdin simply never yields a line.
let pipedLines: Promise<string[]> | null = null;
let pipedIndex = 0;

function readPipedLines(): Promise<string[]> {
  pipedLines ??= new Promise((resolve) => {
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines));
  });
  return pipedLines;
}

/** Reads a line without echoing it. */
async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const lines = await readPipedLines();
    return lines[pipedIndex++] ?? "";
  }

  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // readline has no public "don't echo" switch; overriding the writer is
    // the standard way, and it is why terminal: true is required above.
    const writable = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = writable._writeToOutput.bind(rl);
    let muted = false;
    writable._writeToOutput = (s: string) => {
      if (!muted) original(s);
    };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

// Cost parameters. N is the work factor; 2^16 takes a few hundred ms on a
// laptop, which is invisible on a login and ruinous for anyone grinding
// guesses offline against a leaked env var.
const N = 65536;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

async function main() {
  const [name] = process.argv.slice(2);

  if (!name) {
    console.error("Usage: npx tsx scripts/hash-admin-passcode.ts '<Name>'");
    console.error("The passcode is asked for, not passed on the command line.");
    process.exit(1);
  }
  if (name.includes(":") || name.includes(",")) {
    console.error("A name cannot contain ':' or ',' -- they separate entries.");
    process.exit(1);
  }

  const passcode = await promptHidden(`Passcode for ${name} (not shown): `);
  const again = await promptHidden("Type it again to confirm: ");

  if (passcode !== again) {
    // Hashing a typo would lock out the passcode people actually use, and the
    // hash cannot be read back to find out what was hashed.
    console.error("Those do not match. Nothing was written; run it again.");
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
