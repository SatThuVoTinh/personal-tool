import { collectRepositoryFailures } from "./repository-policy.mjs";

const failures = collectRepositoryFailures(process.cwd());

if (failures.length > 0) {
  console.error("Repository policy check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Repository policy check passed.");
}
