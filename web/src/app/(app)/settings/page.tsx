import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteAccountAction, removeProvider, revokeExtensionToken, saveProvider, testProvider } from "@/app/actions/settings";
import { ActionForm, Submit } from "@/components/forms";
import { TokenForm } from "@/components/token-form";
import { aiStatus, getProvider, usageToday } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [provider, used, ai, [month], tokens] = await Promise.all([
    getProvider(user.id), usageToday(user.id), aiStatus(user.id),
    db.select({ n: sql<number>`count(*) filter (where not cached)::int`, cached: sql<number>`count(*) filter (where cached)::int`, failed: sql<number>`count(*) filter (where not ok)::int`, pt: sql<number>`coalesce(sum(prompt_tokens), 0)::int`, ct: sql<number>`coalesce(sum(completion_tokens), 0)::int` })
      .from(schema.aiUsage).where(and(eq(schema.aiUsage.userId, user.id), gte(schema.aiUsage.createdAt, since))),
    db.select().from(schema.extensionTokens).where(eq(schema.extensionTokens.userId, user.id)).orderBy(desc(schema.extensionTokens.createdAt)),
  ]);
  const host = provider ? new URL(provider.baseUrl).host : null;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div><h1 className="text-2xl font-semibold">Settings</h1><p className="mt-1 text-muted">Signed in as {user.name} ({user.email}).</p></div>

      <section id="ai" className="scroll-mt-20" aria-labelledby="ai-h">
        <h2 id="ai-h" className="text-lg font-semibold">AI connection</h2>
        {ai.kind === "managed" && (
          <div className="panel mt-3 p-4 text-sm" data-testid="managed-ai">
            <p><strong>{ai.label} is included</strong> <span className={`badge ml-1 ${ai.available ? "badge-good" : "badge-warn"}`}>{ai.available ? "Ready" : "Allowance used up"}</span></p>
            <p className="mt-1 text-muted">You do not need a key. Klierly writes new questions and study notes from your materials with a provider it pays for, within a free allowance.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><p className="text-muted">Requests today</p><p className="tnum font-semibold">{ai.usedToday} of {ai.dailyLimit}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-2"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (ai.usedToday / Math.max(1, ai.dailyLimit)) * 100)}%` }} /></div></div>
              <div><p className="text-muted">Monthly allowance</p><p className="tnum font-semibold">{Math.round((ai.tokensThisMonth / Math.max(1, ai.monthlyTokenLimit)) * 100)}% used</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-2"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (ai.tokensThisMonth / Math.max(1, ai.monthlyTokenLimit)) * 100)}%` }} /></div></div>
            </div>
            {!ai.available && <p className="mt-3 text-warn">{ai.reason}</p>}
            <p className="mt-3 text-muted">When you click Generate, the course name, topic names and up to 6 short excerpts per topic go to Klierly&apos;s provider at {ai.host}. Nothing else is sent, and you can switch AI off per course in its settings.</p>
          </div>
        )}
        {!ai.kind && <p className="notice mt-3 text-sm">{ai.reason}</p>}
        <p className="mt-3 text-sm text-muted">{ai.kind === "managed" || provider ? "Optional: use your own provider instead. " : ""}Any provider with an OpenAI-compatible API (a <code>/chat/completions</code> endpoint) works. When your own provider is connected it is used instead of the included one, with your own limits.</p>

        {provider && (
          <div className="panel mt-3 p-4 text-sm">
            <p><strong>{host}</strong> · model <strong>{provider.model}</strong> · key ending <span className="tnum">{provider.keyHint}</span>
              {provider.lastTestAt && <span className={`badge ml-2 ${provider.lastTestOk ? "badge-good" : "badge-bad"}`}>{provider.lastTestOk ? "Last test passed" : "Last test failed"}</span>}
              {provider.preset === "navigator-experimental" && <span className="badge badge-warn ml-2">Experimental</span>}</p>
            <p className="mt-1 text-muted"><span className="tnum">{used}/{provider.dailyRequestLimit}</span> requests today · last 30 days: <span className="tnum">{month?.n ?? 0}</span> requests ({month?.failed ?? 0} failed, {month?.cached ?? 0} served from cache), about <span className="tnum">{((month?.pt ?? 0) + (month?.ct ?? 0)).toLocaleString("en-US")}</span> tokens as reported by the provider.</p>
            <p className="mt-1 text-muted">Klierly cannot see your provider&apos;s prices or remaining credit. Check your usage on the provider&apos;s own dashboard; the daily limit here is your safeguard against surprises.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionForm action={testProvider}><Submit className="btn btn-sm" pendingText="Testing…">Test connection</Submit></ActionForm>
              <ActionForm action={removeProvider}><Submit className="btn btn-sm btn-danger" pendingText="Removing…">Remove provider</Submit></ActionForm>
            </div>
          </div>
        )}

        <ActionForm action={saveProvider} className="panel mt-3 space-y-4 p-5">
          <h3 className="font-semibold">{provider ? "Change your own connection" : "Connect your own provider (optional)"}</h3>
          <div>
            <label className="label" htmlFor="preset">Type</label>
            <select id="preset" name="preset" className="input" defaultValue={provider?.preset ?? "openai-compatible"}>
              <option value="openai-compatible">OpenAI-compatible API (any provider or a self-hosted model)</option>
              <option value="navigator-experimental">UF NaviGator Toolkit — experimental, unverified</option>
            </select>
            <p className="help"><strong>NaviGator:</strong> marked experimental. Before using it, confirm in UF&apos;s current terms that your personal allocation may be used with a third-party tool like this, and take the base URL and model ID from UF&apos;s own documentation. Klierly does not assume either.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="baseUrl">Base URL</label><input id="baseUrl" name="baseUrl" className="input" required placeholder="https://api.example.com/v1" defaultValue={provider?.baseUrl ?? ""} autoComplete="off" />
              <p className="help">Ends before <code>/chat/completions</code>.{env.allowPrivateAiEndpoints ? " http://localhost is allowed for a model running on your own machine." : ""}</p></div>
            <div><label className="label" htmlFor="model">Model ID</label><input id="model" name="model" className="input" required maxLength={120} placeholder="as listed by your provider" defaultValue={provider?.model ?? ""} autoComplete="off" /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div><label className="label" htmlFor="apiKey">API key</label><input id="apiKey" name="apiKey" type="password" className="input" autoComplete="off" placeholder={provider ? `Saved (ending ${provider.keyHint}) — leave empty to keep it` : "Paste the key from your provider"} required={!provider} />
              <p className="help">Stored encrypted on this server, never sent back to your browser, never written to logs. A ChatGPT or Claude <em>subscription login</em> is not an API key — providers issue API keys separately.</p></div>
            <div><label className="label" htmlFor="limit">Daily request limit</label><input id="limit" name="dailyRequestLimit" type="number" min={1} max={1000} className="input" defaultValue={provider?.dailyRequestLimit ?? 60} /></div>
          </div>
          <div className="notice text-sm">
            <p className="font-semibold">What is sent to this provider</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Only when you click Generate: the course name, topic names, and up to 6 excerpts (about 1,400 characters each) of your imported material per topic.</li>
              <li>Never: whole documents, your name or email, your answers, or anything from other courses.</li>
              <li>The provider&apos;s own terms decide whether it stores or trains on that text. Check them, and check that your course allows it. You can switch this off per course.</li>
            </ul>
            <label className="mt-2 flex items-start gap-2.5"><input type="checkbox" name="disclosure" required className="mt-1 size-4 accent-[var(--accent)]" /><span>I understand that excerpts of my course material will be sent to the provider at this address.</span></label>
          </div>
          <Submit pendingText="Saving…">Save connection</Submit>
        </ActionForm>
      </section>

      <section id="extension" className="scroll-mt-20" aria-labelledby="ext-h">
        <h2 id="ext-h" className="text-lg font-semibold">Browser extension</h2>
        <p className="mt-1 text-sm text-muted">The optional extension imports the visible text of a course page you choose, after showing you a preview. Pair it with a token instead of your password. A token can only list your courses and add imports. It is not affiliated with or endorsed by any LMS or university, and it never asks for LMS credentials.</p>
        <div className="panel mt-3 p-4">
          {tokens.length === 0 ? <p className="text-sm text-muted">No pairing tokens yet.</p> : (
            <ul className="divide-y divide-line text-sm">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{t.label} <span className="text-muted">· created {t.createdAt.toLocaleDateString("en-US")} · {t.lastUsedAt ? `last used ${t.lastUsedAt.toLocaleDateString("en-US")}` : "never used"}</span></span>
                  <form action={revokeExtensionToken}><input type="hidden" name="tokenId" value={t.id} /><button className="btn btn-sm btn-danger">Revoke</button></form>
                </li>
              ))}
            </ul>
          )}
          <TokenForm />
          <p className="help mt-3">Server address to enter in the extension: <code className="select-all">{env.appUrl}</code></p>
        </div>
      </section>

      <section aria-labelledby="priv-h">
        <h2 id="priv-h" className="text-lg font-semibold">Privacy and your data</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Your materials, questions and results are visible only to your account. There is no shared library and nothing is published.</li>
          <li>Nothing is used to train models by Klierly, and nothing is sold.</li>
          <li>Delete a source on its page, a course in its settings, or everything below. Deletion removes files, extracted text and the search index.</li>
        </ul>
        <p className="mt-2 text-sm"><Link className="link" href="/privacy">Read the privacy policy draft and exact data flows</Link></p>
      </section>

      <section className="panel p-5" aria-labelledby="del-h">
        <h2 id="del-h" className="text-base font-semibold">Delete account</h2>
        <p className="mt-1 text-sm text-muted">Permanently deletes your account, every course, all uploaded files and indexed content, your AI connection and pairing tokens. This cannot be undone.</p>
        <ActionForm action={deleteAccountAction} className="mt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="del-pw">Confirm with your password</label><input id="del-pw" name="password" type="password" className="input w-64" required autoComplete="current-password" /></div>
            <Submit className="btn btn-danger" pendingText="Deleting…">Delete my account and all data</Submit>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
