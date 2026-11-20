/** Mistake categories a student can tag a wrong answer with. Shared by server and client code. */
export const REASONS: { id: string; label: string; help: string }[] = [
  { id: "knowledge-gap", label: "Didn't know it", help: "The concept or formula was missing" },
  { id: "incorrect-setup", label: "Wrong setup", help: "Used the wrong method or plugged in the wrong values" },
  { id: "calculation-error", label: "Calculation slip", help: "Right method, arithmetic went wrong" },
  { id: "interpretation", label: "Misread it", help: "Misinterpreted the question or the output" },
  { id: "careless-error", label: "Careless", help: "Knew it, rushed" },
];
