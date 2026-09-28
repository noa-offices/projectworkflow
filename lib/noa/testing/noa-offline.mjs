// Loaded in every canonical test worker, before application imports. Tests can install local
// provider/fetch stubs, but real TCP/TLS connections and native fetch remain forbidden.
import { Socket } from "node:net";
import { syncBuiltinESMExports } from "node:module";
const blocked = () => { throw new Error("NOA canonical tests forbid network access"); };
Socket.prototype.connect = blocked;
globalThis.fetch = blocked;
syncBuiltinESMExports();
