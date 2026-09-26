export type NoaAgentCompositionRecipeId = "project_brief" | "client_brief" | "quotation_brief";
export type NoaAgentCompositionSection = {
  heading: string;
  facts: string[];
  sourceStepId: string;
};
export type NoaAgentComposition =
  | { status: "failed"; reason: "invalid_recipe" | "invalid_plan" | "execution_mismatch" | "recipe_scope" | "primary_unavailable" }
  | { status: "complete" | "partial"; title: string; summary: string; sections: NoaAgentCompositionSection[]; sourceSteps: string[]; partial: boolean; omissions: string[] };
