#!/usr/bin/env node
import { runValidationAgainstBaseUrl } from "../src/hermes/validationJob.js";

const baseUrl = process.env.PCC_BASE_URL || "http://localhost:3000";

const result = await runValidationAgainstBaseUrl(baseUrl, {
  provider: process.env.HERMES_PROVIDER || "lmstudio",
  model: process.env.HERMES_MODEL || "qwen3.6-35b-a3b-mtp",
  endpoint: process.env.HERMES_ENDPOINT || "http://localhost:1234/v1",
  jobName: process.env.HERMES_JOB_NAME || "hermes-connectivity-validation"
});

if (result.validationSignalCreated) {
  console.log(`Hermes validation succeeded: ${result.validationId} -> ${result.importedSignalIds.join(", ")}`);
  process.exit(0);
}

console.error(`Hermes validation failed: ${JSON.stringify(result)}`);
process.exit(1);
