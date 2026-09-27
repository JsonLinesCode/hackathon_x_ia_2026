import { expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { DraftIntentSchema } from "@repo/types";
it("keeps journey and time-window union branches disjoint for the real SDK", () => { expect(zodTextFormat(DraftIntentSchema, "trip_draft_intent")).toMatchObject({ type: "json_schema", strict: true }); });
