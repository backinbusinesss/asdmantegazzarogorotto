// Crea o sostituisce gli utenti dell'area admin.
// Chiede utente e password nel terminale (la password non viene mostrata),
// ne calcola l'hash e lo salva come secret ADMIN_USERS su Cloudflare.
// Le password non vengono mai scritte su file né mostrate.
//
// Uso (dalla cartella worker):  node scripts/admin-users.mjs
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import readline from "node:readline";

const ITER = 100000;
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function ask(question, hidden = false) {
  if (!hidden) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    });
  }
  // input nascosto: mostra un asterisco per carattere
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length) { value = value.slice(0, -1); process.stdout.write("\b \b"); }
          continue;
        }
        if (ch >= " ") { value += ch; process.stdout.write("*"); }
      }
    };
    stdin.on("data", onData);
  });
}

const users = {};
console.log("\nUtenti dell'area admin. Inserisci TUTTI gli utenti che devono avere accesso:");
console.log("quelli non inseriti adesso non potranno più entrare.\n");
for (;;) {
  const name = (await ask("Nome utente (invio vuoto per finire): ")).trim().toLowerCase();
  if (!name) break;
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) { console.log("  Usa 3-32 caratteri: lettere, numeri, punto, trattino.\n"); continue; }
  const p1 = await ask(`Password per ${name}: `, true);
  if (p1.length < 10) { console.log("  Password troppo corta: almeno 10 caratteri.\n"); continue; }
  const p2 = await ask("Ripeti la password: ", true);
  if (p1 !== p2) { console.log("  Le password non coincidono, riprova.\n"); continue; }
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(p1, salt, ITER, 32, "sha256");
  users[name] = `pbkdf2$${ITER}$${b64url(salt)}$${b64url(hash)}`;
  console.log(`  Utente "${name}" pronto.\n`);
}

if (!Object.keys(users).length) { console.log("Nessun utente inserito: non cambio niente."); process.exit(1); }

const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(cmd, ["--yes", "wrangler@4", "secret", "put", "ADMIN_USERS"], {
  input: JSON.stringify(users), stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32",
});
if (r.status === 0) console.log(`\nFatto: ${Object.keys(users).length} utenti admin attivi (${Object.keys(users).join(", ")}).`);
process.exit(r.status ?? 1);
