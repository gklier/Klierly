# Download one course

Open the course's **Materials** page and choose **Download course ZIP**. The same button is in **Course settings**. You must be signed in to the account that owns the course.

The ZIP contains:

- `START_HERE.md`: a readable index and instructions for another tool.
- `STUDY_PROMPT.txt`: an optional prompt for active recall, varied questions and source-based feedback.
- `course.json` and `course/`: course details, modules, topics, objectives and dates.
- `materials/originals/`: the original uploaded files and stored web/paste captures.
- `materials/text/`: readable Markdown extraction, with excerpt IDs and available page, slide or timestamp locations.
- `materials/manifest.json`: filenames, module mapping, hashes, source locations and extraction status.
- `study/`: study notes, your question bank with answers, study plan and planned sessions, your generated source summaries, and separately labelled AI-added background explanations.

Provider credentials, passkeys, authentication sessions and extension pairing tokens are not exported. The archive also omits other students' class-library content and your answer history. Original material may itself contain private information; review it and your course's rules before handing it to another tool.

Unzip the archive before uploading if the other tool cannot read ZIP files. Start with the index, scope, study notes and the relevant extracted text; large courses may exceed another service's file or context limits. The export does not send anything to Claude or another provider automatically.

Missing originals are explicitly marked in the manifest and index. Queued or failed documents still include their available originals and extraction status; they are not represented as fully parsed. Files are streamed instead of loading the whole course into server memory. Only one export per account runs at a time, with a limit on repeated starts.

This is a portable study bundle, not a full database backup or an automatic re-import format. Changes made during a download may appear at slightly different moments in its files. Source URLs retain their origin and path but omit query strings, credentials and fragments.
