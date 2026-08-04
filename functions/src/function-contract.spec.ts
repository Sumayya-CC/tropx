import * as fns from "./index";

/**
 * Prompt 5 (functions/src/index.ts file split) 5.0 preconditions gate.
 *
 * Firebase identifies a deployed function by its export name — a renamed,
 * dropped, or reconfigured (trigger type/document path/schedule/region/
 * secret) export during the split is a delete-and-recreate of a LIVE
 * production function, not a harmless refactor. The plan (see project
 * memory "Roadmap: Prompt 4/5 + 5H tiering") is to split index.ts one
 * domain module at a time and, after each phase, diff every exported
 * function's real contract against a baseline captured before the split
 * started. This is that baseline, captured as a Jest snapshot.
 *
 * The contract is read from each CloudFunction's own `__endpoint`
 * (ManifestEndpoint — the same metadata firebase-functions uses internally
 * to build the deploy manifest), not hand-transcribed, so this can't drift
 * out of sync with what actually gets deployed. Exports are discovered by
 * duck-typing `__endpoint` rather than a hardcoded name list — a future
 * split phase that accidentally drops or forgets to re-export a function
 * shows up here as a snapshot diff (the function silently disappears from
 * the list) without this file itself needing to be updated by hand.
 *
 * Deliberately excluded from the contract: `availableMemoryMb`/
 * `minInstances`/`maxInstances`/`concurrency`/`labels`/etc — every field
 * this repo's functions leave at their firebase-functions default (null/
 * empty). Only fields this codebase actually sets are asserted, so this
 * snapshot doesn't silently start failing on an unrelated firebase-functions
 * version bump that changes an unrelated default.
 *
 * On a genuine, intended contract change (e.g. a schedule time move),
 * update via `npx jest function-contract -u` from functions/ and review the
 * resulting .snap diff like any other code change — it should describe
 * exactly the one field that was meant to change, nothing else.
 */

interface DeployedFunction {
  __endpoint: {
    region?: string[];
    timeoutSeconds?: number | null;
    secretEnvironmentVariables?: Array<{ key: string }>;
    callableTrigger?: unknown;
    eventTrigger?: {
      eventType: string;
      eventFilterPathPatterns?: { document?: string };
    };
    scheduleTrigger?: { schedule: string; timeZone?: string };
  };
}

function isDeployedFunction(value: unknown): value is DeployedFunction {
  return (
    typeof value === "function" &&
    value !== null &&
    "__endpoint" in value
  );
}

function normalizeContract(name: string, fn: DeployedFunction) {
  const ep = fn.__endpoint;
  const contract: Record<string, unknown> = {
    name,
    region: [...(ep.region ?? [])].sort(),
    secrets: (ep.secretEnvironmentVariables ?? [])
      .map((s) => s.key)
      .sort(),
  };
  if (ep.timeoutSeconds != null) {
    contract["timeoutSeconds"] = ep.timeoutSeconds;
  }
  if (ep.callableTrigger) {
    contract["trigger"] = "callable";
  } else if (ep.eventTrigger) {
    contract["trigger"] = "firestore";
    contract["eventType"] = ep.eventTrigger.eventType;
    contract["document"] = ep.eventTrigger.eventFilterPathPatterns?.document;
  } else if (ep.scheduleTrigger) {
    contract["trigger"] = "schedule";
    contract["schedule"] = ep.scheduleTrigger.schedule;
    contract["timeZone"] = ep.scheduleTrigger.timeZone;
  } else {
    contract["trigger"] = "unknown";
  }
  return contract;
}

describe("function contract baseline (Prompt 5, 5.0 preconditions gate)", () => {
  it("every exported Cloud Function's trigger/region/secret contract matches the pre-split baseline", () => {
    const contracts = Object.entries(fns)
      .filter((entry): entry is [string, DeployedFunction] => isDeployedFunction(entry[1]))
      .map(([name, fn]) => normalizeContract(name, fn))
      .sort((a, b) => (a["name"] as string).localeCompare(b["name"] as string));

    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts).toMatchSnapshot();
  });
});
