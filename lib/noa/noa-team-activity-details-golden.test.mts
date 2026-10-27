import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const activity = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8").replace(/\r\n/g, "\n");
const semantic = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");

const functionBody = (name: string) => {
  const start = activity.indexOf(`async function ${name}(`);
  assert.ok(start > -1, `${name} exists`);
  const end = activity.indexOf("\n}\n", start);
  return activity.slice(start, end);
};

test("a team + events semantic request goes to the team_catch_up kind", () => {
  assert.ok(semantic.includes('detail?: "events";'), "NoaSemanticRequest gets one optional closed detail field");
  const override = activity.slice(activity.indexOf("function semanticActivityOverride("), activity.indexOf("// N2B1: narrow, historical/event-oriented phrasing"));
  assert.ok(override.includes('if (subject?.type === "team") return semanticRequest.detail === "events" ? { kind: "team_catch_up" } : { kind: "team_summary" };'));
  assert.ok(activity.includes('| "team_catch_up"'));
});

test("team_catch_up sits in isTeamKind, behind requireSettingsManager(), before any read", () => {
  const entry = activity.slice(activity.indexOf("export async function fetchNoaUserActivityCapability("));
  const teamKindIndex = entry.indexOf("const isTeamKind =");
  const gateIndex = entry.indexOf("await requireSettingsManager();");
  const dispatchIndex = entry.indexOf('if (kind === "team_catch_up") return teamCatchUpAnswer(supabase, message);');
  assert.ok(teamKindIndex > -1 && gateIndex > -1 && dispatchIndex > -1);
  assert.ok(entry.slice(teamKindIndex, gateIndex).includes('kind === "team_catch_up"'), "listed in isTeamKind");
  assert.ok(teamKindIndex < gateIndex && gateIndex < dispatchIndex);
  assert.ok(entry.slice(gateIndex, dispatchIndex).includes("return TEAM_UNAUTHORIZED_RESULT;"), "a non-manager gets TEAM_UNAUTHORIZED_RESULT before any read");
  assert.ok(entry.indexOf("teamCatchUpAnswer(") > gateIndex, "no team catch-up read before the gate");
});

test("teamCatchUpAnswer has no created_by filter, uses the team row cap and team wording", () => {
  const body = functionBody("teamCatchUpAnswer");
  assert.ok(!body.includes("created_by"));
  assert.ok(body.includes('.from("audit_activity_log")') && body.includes(".limit(MAX_TEAM_AUDIT_ROWS)"));
  assert.ok(body.includes("buildCatchUpResult("));
  assert.ok(body.includes("the team"));
  assert.ok(!/\byou\b|\byour\b/i.test(body.replace(/\/\/.*$/gm, "")), "no own-activity wording");
});

test("the team answer says when the 100-row cap may have cut the list", () => {
  const body = functionBody("teamCatchUpAnswer");
  assert.ok(body.includes("rows.length >= MAX_TEAM_AUDIT_ROWS"));
  assert.ok(body.includes("may be missing"));
});

test("own 'what changed today' still goes to own catch-up, unchanged", () => {
  assert.ok(activity.includes("const CATCH_UP_PATTERNS = [/\\bwhat changed\\b/, /\\bwhat happened\\b/, /\\bcatch me up\\b/];"));
  assert.ok(activity.includes('return "catch_up";'));
  assert.ok(activity.includes('if (kind === "catch_up") return catchUpAnswer(supabase, userId, message);'));
  const own = functionBody("catchUpAnswer");
  assert.ok(own.includes('.eq("created_by", userId)') && own.includes(".limit(MAX_ACTIVITY_LOG_ROWS)"));
});
