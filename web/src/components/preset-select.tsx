"use client";

const NAVIGATOR = { baseUrl: "https://api.ai.it.ufl.edu/v1", model: "llama-3.1-8b-instruct" };
// Google lists model names that change; the model is deliberately left for the student to copy from AI Studio.
const GOOGLE = { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "" };

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
      const own = [NAVIGATOR, GOOGLE].find((x) => x.baseUrl === base.value);
      const next = e.target.value === "navigator-experimental" ? NAVIGATOR : e.target.value === "google-ai-studio" ? GOOGLE : null;
      // Replace the address only if it is empty or still another preset's own; never overwrite what the student typed.
      if (next) { if (!base.value || own) base.value = next.baseUrl; if (!model.value || (own && model.value === own.model)) model.value = next.model; }
      else if (own) { base.value = ""; if (model.value === own.model) model.value = ""; }
    }}>
      <option value="openai-compatible">OpenAI-compatible API (any provider or a self-hosted model)</option>
      <option value="navigator-experimental">UF NaviGator Toolkit (experimental)</option>
      <option value="google-ai-studio">Google AI Studio (Gemini API)</option>
    </select>
  );
}
