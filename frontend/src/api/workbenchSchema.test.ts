import { describe, expect, it } from "vitest";
import response from "../test/semantic-assist-response.json";
import { SemanticAssistSchema } from "./workbenchSchema";

describe("real semantic-assist response consumer contract", () => {
  it("accepts an omitted optional category from the validated local-model proposal", () => {
    const proposal = SemanticAssistSchema.parse(response);
    expect(proposal.semanticModel.metrics).toHaveLength(1);
    expect(proposal.semanticModel.metrics[0].category).toBeUndefined();
    expect(proposal.semanticModel.metrics[0].compatibleDimensions).toContain(
      "station",
    );
  });
  it("rejects explicit null optional strings and missing mandatory business fields", () => {
    const invalidCategory = structuredClone(response);
    Object.assign(invalidCategory.semanticModel.metrics[0], { category: null });
    const invalid = SemanticAssistSchema.safeParse(invalidCategory);
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues[0].path).toEqual([
        "semanticModel",
        "metrics",
        0,
        "category",
      ]);
    }
    const missingExpression = structuredClone(response);
    Reflect.deleteProperty(
      missingExpression.semanticModel.metrics[0],
      "expression",
    );
    expect(SemanticAssistSchema.safeParse(missingExpression).success).toBe(
      false,
    );
  });
});
