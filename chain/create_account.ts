import { KeyPair, keyStores } from "near-api-js";
import { homedir } from "node:os";
const id = process.argv[2];
const ks = new keyStores.UnencryptedFileSystemKeyStore(`${homedir()}/.near-credentials`);
if (await ks.getKey("testnet", id)) { console.log("exists", id); process.exit(0); }
const kp = KeyPair.fromRandom("ed25519");
const r = await fetch("https://helper.nearprotocol.com/account", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
});
console.log(r.status, (await r.text()).slice(0, 300));
if (r.ok) await ks.setKey("testnet", id, kp);
