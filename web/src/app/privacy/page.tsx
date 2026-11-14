import Link from "next/link";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm"><Link className="link" href="/">Klierly</Link></p>
      <h1 className="mt-3 text-3xl font-semibold">Privacy policy — draft</h1>
      <p className="notice notice-warn mt-4 text-sm">This is a plain-language draft for a private, self-hosted test version. It has not been reviewed by a lawyer and must be before any public launch.</p>
      <div className="mt-6 space-y-6 font-serif text-[1.05rem] leading-relaxed [&_h2]:font-sans [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-6">
        <section><h2>What Klierly is</h2><p>A study tool. You import course material you are allowed to use, and Klierly turns it into a searchable library, a study plan and practice questions. It is not connected to your university, and it is not a tool for completing graded work.</p></section>
        <section><h2>What is stored</h2><ul>
          <li>Your account: name, email and a salted hash of your password.</li>
          <li>What you import: the original files, the text extracted from them, and a search index of that text.</li>
          <li>What you do: courses, modules, topics, study plans, practice answers, timing, mistake tags and question reports.</li>
          <li>If you connect an AI provider: its address, model name, and your API key encrypted on the server; counts of requests and tokens.</li>
        </ul><p>All of it is tied to your account. Other users cannot see it, there is no shared library, and nothing you import is published.</p></section>
        <section><h2>Where your data goes</h2><ul>
          <li><strong>The Klierly server</strong> (the machine running this app) stores everything above in its database and upload folder.</li>
          <li><strong>The parsing service</strong> runs on the same server. It receives each file to extract text and keeps nothing.</li>
          <li><strong>Your AI provider, only if you connect one and only when you click Generate:</strong> the course name, topic names and a few short excerpts of your material are sent to the address you entered. Your name, email, answers and whole documents are not sent. What the provider does with those excerpts is governed by its terms, not by Klierly. You can turn this off for an individual course.</li>
          <li><strong>The browser extension, if you install it:</strong> when you click it and confirm an import, the visible text of that one page, its title and address go to your Klierly server. Nothing is sent before you confirm, and it does not read passwords, cookies, grades or other tabs.</li>
        </ul><p>Klierly does not sell data, show ads, or use your material to train models.</p></section>
        <section><h2>Your responsibilities</h2><p>Import only material you have the right to use this way. Course content can be covered by copyright and by your institution&apos;s rules; some instructors do not permit sharing it with outside services, including AI providers. Do not import exams, quizzes or answer keys you are not allowed to keep, and never use Klierly during a graded assessment.</p></section>
        <section><h2>Deleting your data</h2><ul>
          <li>Delete a single source from its page: the file, extracted text and index entries are removed, along with questions that relied only on it.</li>
          <li>Delete a course from its settings: everything in it is removed.</li>
          <li>Delete your account from Settings: every course, file, result, token and saved key is removed.</li>
        </ul><p>Deletion is immediate in the live database and upload folder. Copies in server backups, if the operator keeps any, disappear when those backups expire.</p></section>
        <section><h2>Security</h2><p>Passwords are hashed, API keys are encrypted at rest, sessions use HTTP-only cookies, uploads are type-checked and size-limited, and server logs exclude document text and credentials. No system is perfectly secure; do not import anything you could not afford to have exposed.</p></section>
        <section><h2>Student records</h2><p>Klierly is not operated on behalf of a university and does not receive official education records. If that ever changes, FERPA and institutional agreements would apply and this policy would need to be rewritten.</p></section>
      </div>
    </main>
  );
}
