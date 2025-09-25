import { pgGenerate } from "drizzle-dbml-generator";
import * as schema from "./db/schema";
import path from "path";
import "dotenv/config";

async function generateDbml() {
  const dbml = pgGenerate({
    schema,
    out: path.join(__dirname, "../schema.dbml"), // Optional: specify output file path
    // other options like 'createReferencesFromRelations' can be added here
  });

  console.log("DBML generated successfully!");
  // If 'out' option is not provided, the DBML string is returned and can be used directly
  // console.log(dbml);
}

generateDbml();
