import dotenv from "dotenv";

// Must be the first import in any script entry point. tsx compiles to
// CommonJS, and TypeScript hoists all `import` declarations (as `require()`
// calls, in listed order) ahead of any other top-level statement — so a
// bare `dotenv.config()` call written between two imports would actually
// run AFTER both, not between them. Putting the side effect inside its own
// imported module and listing it first guarantees it runs before any
// later-listed import (e.g. src/lib/db/connection.ts, which reads
// process.env.DATABASE_URL at its own module top level).
dotenv.config({ path: ".env.local" });
