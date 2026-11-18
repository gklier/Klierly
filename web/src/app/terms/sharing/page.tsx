import Link from "next/link";
import { SHARING_TERMS_VERSION } from "@/lib/sharing-rules";

export const metadata = { title: "Class library terms" };

export default function SharingTerms() {
  const contact = process.env.TAKEDOWN_EMAIL?.trim();
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm"><Link className="link" href="/">Klierly</Link></p>
      <h1 className="mt-3 text-3xl font-semibold">Class library terms</h1>
      <p className="mt-1 text-sm text-muted">Version {SHARING_TERMS_VERSION}</p>
      <p className="notice notice-warn mt-4 text-sm">Plain-language terms for a private test version. They have not been reviewed by a lawyer. Nothing here is legal advice.</p>
      <div className="mt-6 space-y-6 font-serif text-[1.05rem] leading-relaxed [&_h2]:font-sans [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-6">
        <section><h2>What the class library is</h2><p>A place where students in the same class can share study summaries they made, written by an AI in its own words from their own notes and lecture material. It is not official course material and it can contain mistakes.</p></section>
        <section><h2>Who can see it</h2><ul>
          <li>Only people who say they are in the class. To join, the Klierly extension notes that you opened that class&apos;s Canvas course page. It reads the course number and name from the page address and title, nothing else, and sends them to Klierly.</li>
          <li>Klierly cannot confirm enrolment, because it does not connect to Canvas. Treat everything you share as something a non-classmate could see.</li>
          <li>Your claim expires after about four months unless you open the course in Canvas again.</li>
          <li>Shared items do not show your name. Operators can see who shared what.</li>
        </ul></section>
        <section><h2>What you may share</h2><ul>
          <li>Only AI summaries Klierly created for you, shared one at a time and only when you choose.</li>
          <li>Never copies of slides, documents, transcripts, recordings, quotes, exams, quizzes, graded work or answer keys. Klierly never shares your original files or extracted text, and refuses summaries that reuse long runs of the source&apos;s own wording or whose source looks like an exam.</li>
          <li>You confirm that you have the right to use that material for studying, that your instructor or school does not prohibit sharing study notes, and that you are not sharing anything from a graded assessment.</li>
        </ul></section>
        <section><h2>Taking things down</h2><ul>
          <li>You can take down anything you shared at any time. Leaving a class removes everything you shared there.</li>
          <li>Any member can report an item. Two reports from different students hide it until an operator reviews it. Operators can hide or remove anything and can turn sharing off for a class, for example if an instructor asks.</li>
          {contact && <li>Instructors or rights holders can ask for removal at <a className="link" href={`mailto:${contact}`}>{contact}</a>.</li>}
        </ul></section>
        <section><h2>What Klierly does with it</h2><p>Shared summaries are stored with your server operator&apos;s database and shown only inside the class library. They are not published elsewhere, not sold and not used to train models.</p></section>
        <section><h2>No guarantees</h2><p>Summaries are AI-generated and may be wrong or incomplete. Use them to study, not as a substitute for your own notes or the course materials.</p></section>
      </div>
    </main>
  );
}
