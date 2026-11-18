/** Shared by the browser and server so a passkey approval covers one operation and its targets. */
const fields: Record<string, string[]> = {
  "account-create": ["email", "name"],
  "account-recover": ["userId"],
  "account-disable": ["userId", "disabled"],
  "class-member": ["userId", "classId", "approved"],
  "class-sharing": ["classId", "enabled"],
  "class-moderate": ["itemId", "action"],
  "extension-token": ["label"],
  "passkey-remove": ["passkeyId"],
  "passkey-add": [],
  "account-delete": [],
};

export function validConfirmationScope(scope: string) {
  const [operation, digest] = scope.split(":");
  return Object.hasOwn(fields, operation) && (fields[operation].length ? scope === `${operation}:${digest}` && /^[a-f0-9]{64}$/.test(digest ?? "") : scope === operation);
}

export async function confirmationScope(operation: string, form: Pick<FormData, "get">) {
  if (!Object.hasOwn(fields, operation)) throw new Error("Unknown confirmation operation.");
  if (!fields[operation].length) return operation;
  const values = fields[operation].map((field) => {
    const value = String(form.get(field) ?? "").trim();
    return field === "email" ? value.toLowerCase() : value;
  });
  const bytes = new TextEncoder().encode(JSON.stringify(values));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `${operation}:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
