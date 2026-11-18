import { AccountInvitationForm } from "@/components/account-invitation-form";
import { setAccountDisabled, approveClassMember } from "@/app/actions/accounts";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { classSharingSwitchAction, moderateAction } from "@/app/actions/sharing";
import { ActionForm, Submit } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { classOverview, moderationQueue } from "@/lib/classes";
import { env } from "@/lib/env";

export const metadata = { title: "Operator" };

const usd = (micro: number) => `$${(micro / 1e6).toFixed(micro < 1e5 ? 4 : 2)}`;

/** Cost and usage monitoring for the managed AI provider. Visible only to ADMIN_EMAILS. Counts only — no content. */
export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  const accounts = await db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, isAdmin: schema.users.isAdmin, disabled: schema.users.disabled }).from(schema.users).orderBy(asc(schema.users.createdAt));
  const memberships = await db.select({ userId: schema.users.id, email: schema.users.email, classId: schema.classSpaces.id, label: schema.classSpaces.label, approved: schema.classMembers.approved })
    .from(schema.classMembers).innerJoin(schema.users, eq(schema.users.id, schema.classMembers.userId))
    .innerJoin(schema.classSpaces, eq(schema.classSpaces.id, schema.classMembers.classId));
  const m = env.managedAi;
  const [days, users, [month]] = await Promise.all([
    db.execute<{ day: string; requests: number; failed: number; cached: number; tokens: number; micro: number; strong: number }>(sql`
      select to_char(created_at, 'YYYY-MM-DD') as day, count(*) filter (where not cached)::int as requests, count(*) filter (where not ok)::int as failed,
             count(*) filter (where cached)::int as cached, coalesce(sum(coalesce(prompt_tokens,0) + coalesce(completion_tokens,0)), 0)::int as tokens,
             coalesce(sum(cost_micro_usd), 0)::int as micro, count(*) filter (where tier = 'strong')::int as strong
      from ai_usage where provider = 'managed' and created_at > now() - interval '14 days' group by 1 order by 1 desc`),
    db.execute<{ email: string; requests: number; tokens: number; micro: number; last: Date }>(sql`
      select u.email, count(*) filter (where not a.cached)::int as requests, coalesce(sum(coalesce(a.prompt_tokens,0) + coalesce(a.completion_tokens,0)), 0)::int as tokens,
             coalesce(sum(a.cost_micro_usd), 0)::int as micro, max(a.created_at) as last
      from ai_usage a join users u on u.id = a.user_id
      where a.provider = 'managed' and a.created_at >= date_trunc('month', now()) group by u.email order by micro desc, requests desc limit 50`),
    db.execute<{ requests: number; micro: number }>(sql`
      select count(*) filter (where not cached)::int as requests, coalesce(sum(cost_micro_usd), 0)::int as micro
      from ai_usage where provider = 'managed' and created_at >= date_trunc('month', now())`).then((r) => r.rows),
  ]);
  const [queue, classes] = await Promise.all([moderationQueue(), classOverview()]);
  const pricesKnown = m ? m.price.routine.in + m.price.routine.out > 0 : false;

  return (
    <div className="space-y-6">
      <section className="panel p-5 space-y-4">
        <h1 className="text-2xl font-semibold">Account administration</h1>
        <p>Review requests sent to gabriel.klier@ufl.edu. Approve the email address from the request, then reply with its private enrollment link.</p>
        <AccountInvitationForm />
        {accounts.map((account) => <div key={account.id} className="border-t border-line pt-4 space-y-3">
          <p>{account.name} · {account.email} · {account.isAdmin ? "Administrator" : account.disabled ? "Disabled" : "Approved"}</p>
          {!account.isAdmin && <>
            {!account.disabled && <AccountInvitationForm userId={account.id} />}
            <ActionForm action={setAccountDisabled}>
              <input type="hidden" name="userId" value={account.id} /><input type="hidden" name="disabled" value={String(!account.disabled)} />
              <Submit className="btn btn-sm">{account.disabled ? "Enable account" : "Disable account and revoke access"}</Submit>
            </ActionForm>
          </>}
        </div>)}
      </section>
      <section className="panel p-5 space-y-3"><h2 className="text-lg font-semibold">Class membership approvals</h2><p className="text-sm">Verify enrollment independently before approving access to shared summaries.</p>
        {memberships.map((member) => <ActionForm key={`${member.classId}:${member.userId}`} action={approveClassMember}>
          <p>{member.email} · {member.label} · {member.approved ? "Approved" : "Awaiting approval"}</p>
          <input type="hidden" name="userId" value={member.userId} /><input type="hidden" name="classId" value={member.classId} /><input type="hidden" name="approved" value={String(!member.approved)} />
          <Submit className="btn btn-sm">{member.approved ? "Revoke membership" : "Approve verified membership"}</Submit>
        </ActionForm>)}
      </section>
      <div><h1 className="text-2xl font-semibold">Operator: managed AI</h1><p className="mt-1 text-muted">Requests, tokens and estimated spend for the Klierly-managed provider. No prompts, answers or course text are stored here.</p></div>

      {!m ? (
        <p className="notice notice-warn"><strong>The managed provider is not configured.</strong> Students see “AI is not set up” unless they connect their own. Set <code>MANAGED_AI_BASE_URL</code>, <code>MANAGED_AI_API_KEY</code> and <code>MANAGED_AI_MODEL</code> on the server (see <code>.env.example</code>). No real inference is active.</p>
      ) : (
        <section className="panel p-5 text-sm">
          <h2 className="text-base font-semibold">Configuration</h2>
          <dl className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="text-muted">Endpoint</dt><dd>{new URL(m.baseUrl).host}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Routine model</dt><dd>{m.model}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Stronger model (retries only)</dt><dd>{m.strongModel ?? "not set"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Per student</dt><dd className="tnum">{m.userDailyRequests}/day · {m.userMonthlyTokens.toLocaleString("en-US")} tokens/month</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">All students</dt><dd className="tnum">{m.globalDailyRequests}/day · {m.globalMonthlyUsd > 0 ? `$${m.globalMonthlyUsd}/month budget stop` : "no budget stop"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">This month</dt><dd className="tnum" data-testid="month-total">{month?.requests ?? 0} requests · {pricesKnown ? usd(month?.micro ?? 0) : "cost unknown"}</dd></div>
          </dl>
          {!pricesKnown && <p className="mt-3 text-warn">Token prices are not set (<code>MANAGED_AI_PRICE_IN_PER_MTOK</code>, <code>MANAGED_AI_PRICE_OUT_PER_MTOK</code>), so spend cannot be estimated and the monthly budget stop cannot trigger. The request and token limits still apply.</p>}
          <p className="mt-3 text-muted">Estimates use the provider&apos;s reported token counts and your configured prices. Your provider&apos;s invoice is the source of truth.</p>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold">Last 14 days</h2>
        {days.rows.length === 0 ? <p className="mt-1 text-muted">No managed AI requests yet.</p> : (
          <div className="panel mt-2 overflow-x-auto"><table className="w-full min-w-[36rem] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th className="px-4 py-2 font-medium">Day</th><th className="px-3 py-2 font-medium">Requests</th><th className="px-3 py-2 font-medium">Failed</th><th className="px-3 py-2 font-medium">From cache</th><th className="px-3 py-2 font-medium">Stronger model</th><th className="px-3 py-2 font-medium">Tokens</th><th className="px-3 py-2 font-medium">Est. cost</th></tr></thead>
            <tbody className="tnum divide-y divide-line">{days.rows.map((d) => <tr key={d.day}><td className="px-4 py-2">{d.day}</td><td className="px-3 py-2">{d.requests}</td><td className="px-3 py-2">{d.failed}</td><td className="px-3 py-2">{d.cached}</td><td className="px-3 py-2">{d.strong}</td><td className="px-3 py-2">{d.tokens.toLocaleString("en-US")}</td><td className="px-3 py-2">{pricesKnown ? usd(d.micro) : "—"}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Students this month</h2>
        {users.rows.length === 0 ? <p className="mt-1 text-muted">Nobody has used the managed provider this month.</p> : (
          <div className="panel mt-2 overflow-x-auto"><table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th className="px-4 py-2 font-medium">Account</th><th className="px-3 py-2 font-medium">Requests</th><th className="px-3 py-2 font-medium">Tokens</th><th className="px-3 py-2 font-medium">Est. cost</th><th className="px-3 py-2 font-medium">Last used</th></tr></thead>
            <tbody className="divide-y divide-line">{users.rows.map((u) => <tr key={u.email}><td className="px-4 py-2">{u.email}</td><td className="tnum px-3 py-2">{u.requests}</td><td className="tnum px-3 py-2">{u.tokens.toLocaleString("en-US")}</td><td className="tnum px-3 py-2">{pricesKnown ? usd(u.micro) : "—"}</td><td className="tnum px-3 py-2">{new Date(u.last).toLocaleDateString("en-US")}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <section data-testid="class-moderation">
        <h2 className="text-lg font-semibold">Class libraries</h2>
        <p className="mt-1 text-sm text-muted">Classes, how many students claimed membership, and how many summaries are shared. Turn sharing off for a class if an instructor or school asks.</p>
        {classes.length === 0 ? <p className="mt-2 text-muted">No class has been joined yet.</p> : (
          <div className="panel mt-2 overflow-x-auto"><table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th className="px-4 py-2 font-medium">Class</th><th className="px-3 py-2 font-medium">Members</th><th className="px-3 py-2 font-medium">Shared</th><th className="px-3 py-2 font-medium">Sharing</th></tr></thead>
            <tbody className="divide-y divide-line">{classes.map((c) => (
              <tr key={c.id}><td className="px-4 py-2">{c.label}<span className="ml-2 text-xs text-muted">{c.host}</span></td><td className="tnum px-3 py-2">{c.members}</td><td className="tnum px-3 py-2">{c.items}</td>
                <td className="px-3 py-2"><ActionForm action={classSharingSwitchAction} className="flex items-center gap-2"><input type="hidden" name="classId" value={c.id} /><input type="hidden" name="enabled" value={c.sharing_enabled ? "0" : "1"} /><span className={`badge ${c.sharing_enabled ? "badge-good" : "badge-warn"}`}>{c.sharing_enabled ? "On" : "Off"}</span><Submit className="btn btn-sm" pendingText="…">{c.sharing_enabled ? "Turn off" : "Turn on"}</Submit></ActionForm></td></tr>
            ))}</tbody>
          </table></div>
        )}
        <h3 className="mt-5 text-base font-semibold">Reported or hidden items</h3>
        {queue.length === 0 ? <p className="mt-1 text-muted">Nothing is waiting for review.</p> : (
          <ul className="mt-2 space-y-3">{queue.map((q) => (
            <li key={q.id} className="panel p-4 text-sm">
              <p className="font-semibold">{q.title} <span className="font-normal text-muted">· {q.label} · {q.reports} {q.reports === 1 ? "report" : "reports"} · {q.status}</span></p>
              <p className="mt-1">{q.body.overview}</p>
              {q.reasons.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted">{q.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              <div className="mt-3 flex gap-2">
                {(["restore", "hide", "remove"] as const).map((a) => (
                  <ActionForm key={a} action={moderateAction}><input type="hidden" name="itemId" value={q.id} /><input type="hidden" name="action" value={a} /><Submit className={a === "remove" ? "btn btn-danger btn-sm" : "btn btn-sm"} pendingText="…">{a === "restore" ? "Restore" : a === "hide" ? "Hide" : "Remove"}</Submit></ActionForm>
                ))}
              </div>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
