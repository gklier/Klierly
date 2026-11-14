"use client";

const NAVIGATOR = { baseUrl: "https://api.ai.it.ufl.edu/v1", model: "llama-3.1-8b-instruct" };

/**
 * Provider type picker. Choosing UF NaviGator fills in the address and example model from UF's own
 * quickstart (only into empty fields, or fields still holding the other preset's values) and
 * choosing the generic type clears them again. The API key is never prefilled.
 */
export function PresetSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select id="preset" name="preset" className="input" defaultValue={defaultValue} onChange={(e) => {
      const base = document.getElementById("baseUrl") as HTMLInputElement | null;
      const model = document.getElementById("model") as HTMLInputElement | null;
      if (!base || !model) return;
      if (e.target.value === "navigator-experimental") {
        if (!base.value) base.value = NAVIGATOR.baseUrl;
        if (!model.value) model.value = NAVIGATOR.model;
      } else {
        if (base.value === NAVIGATOR.baseUrl) base.value = "";
        if (model.value === NAVIGATOR.model) model.value = "";
      }
    }}>
      <option value="openai-compatible">OpenAI-compatible API (any provider or a self-hosted model)</option>
      <option value="navigator-experimental">UF NaviGator Toolkit (experimental)</option>
    </select>
  );
}
