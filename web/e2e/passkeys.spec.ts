import { expect, test } from "@playwright/test";
import { enrollTestAccount, testDatabase } from "./passkey-helper";

test("passkey enrollment, sign-in, role isolation, revocation and token expiry", async ({ page, request }) => {
  await page.goto("/register");
  await expect(page.getByRole("link", { name: "gabriel.klier@ufl.edu" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.goto("/enroll#token=invalid");
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await enrollTestAccount(page, "Passkey Tester", "passkey@e2e.test");
  await page.goto("/admin");
  expect((await page.goto("/admin"))?.status()).toBe(404);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL("/login");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

  const db = await testDatabase();
  try {
    const { rows } = await db.query("select id from users where email='passkey@e2e.test'");
    await db.query("insert into extension_tokens(user_id,token_hash,label,expires_at) values($1,encode(sha256('clx_expired_dummy_token_1234567890'::bytea),'hex'),'Expired test',now()-interval '1 second')", [rows[0].id]);
    const denied = await request.get("/api/ext/courses", { headers: { Authorization: "Bearer clx_expired_dummy_token_1234567890" } });
    expect(denied.status()).toBe(401);
    await db.query("update users set disabled=true where id=$1", [rows[0].id]);
  } finally { await db.end(); }
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("admin approves a requested account and disables its sessions", async ({ page }) => {
  await enrollTestAccount(page, "Administrator", "admin-auth@e2e.test");
  const db = await testDatabase();
  try { await db.query("update users set is_admin=true where email='admin-auth@e2e.test'"); } finally { await db.end(); }
  await page.goto("/admin");
  await page.getByLabel("Name", { exact: true }).fill("Approved Student");
  await page.getByLabel("Email", { exact: true }).fill("approved@e2e.test");
  await page.getByRole("button", { name: "Approve account", exact: true }).click();
  const link = page.getByLabel("Private enrollment link").first();
  await expect(link).toHaveValue(/\/enroll#token=/);
  const url = await link.inputValue();
  const other = await page.context().browser()!.newContext();
  const student = await other.newPage();
  const { virtualPasskey } = await import("./passkey-helper");
  await virtualPasskey(student);
  await student.goto(url);
  await student.getByRole("button", { name: "Create a passkey", exact: true }).click();
  await student.waitForURL("/");
  await student.goto(url);
  await student.getByRole("button", { name: "Create a passkey", exact: true }).click();
  await expect(student.getByRole("alert")).toBeVisible();
  const account = page.locator('div.border-t').filter({ hasText: "approved@e2e.test" });
  await account.getByRole("button", { name: "Disable account and revoke access", exact: true }).click();
  await expect(account).toContainText("Account disabled and access revoked.");
  await student.goto("/");
  await expect(student).toHaveURL(/\/login$/);
  await other.close();
});
