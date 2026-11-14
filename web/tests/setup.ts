import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { loadEnv } from "../scripts/load-env";

loadEnv();
// Tests always run against the dedicated test database and a throwaway upload dir.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!.replace(/\/courselab(\?|$)/, "/courselab_test$1");
if (!/courselab_test/.test(process.env.DATABASE_URL)) throw new Error("Refusing to run tests against a non-test database.");
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "courselab-test-"));
process.env.ALLOW_PRIVATE_AI_ENDPOINTS = "true";
