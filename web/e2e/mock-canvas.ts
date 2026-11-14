/**
 * A SYNTHETIC stand-in for a Canvas course site, for extension tests only.
 * It imitates the general shape of Canvas's Modules page and item pages as
 * best we know it; passing against this mock does NOT prove compatibility
 * with a real Canvas instance (UF's or anyone's).
 *
 * Every course route requires a session cookie set by /login, so the tests
 * exercise the "student is signed in, in their own tab" situation.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const SAMPLE = path.resolve(__dirname, "../../fixtures/qmb-sample");
const C = "/courses/77";

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>
<header id="header"><nav><a href="/">Dashboard</a> <a href="${C}/grades">MOCK-GLOBAL-NAV-GRADES</a></nav></header>
<nav id="section-tabs"><a href="${C}">Home</a> <a href="${C}/modules">Modules</a> <a href="${C}/grades">Grades</a> <a href="${C}/users">People</a></nav>
<div id="content">${body}</div><footer id="footer">MOCK-FOOTER</footer></body></html>`;

const item = (id: number, cls: string, title: string, opts: { link?: boolean; locked?: boolean } = {}) =>
  `<li id="context_module_item_${id}" class="context_module_item ${cls}${opts.locked ? " locked" : ""}"><div class="ig-row"><span class="type_icon"><i class="icon-x"></i></span>
   <div class="ig-info"><div class="module-item-title"><span class="item_name">${opts.link === false ? `<span class="title locked_title">${title}</span>` : `<a class="ig-title title item_link" href="${C}/modules/items/${id}">${title}</a>`}</span></div></div>
   <span class="type" style="display:none">${cls}</span></div></li>`;

const modulesPage = () => shell("Course Modules: QMB 3250 (mock)", `
<div id="context_modules">
  <div class="context_module" id="context_module_11" data-module-id="11" aria-label="Module 1: Simple Linear Regression">
    <div class="ig-header header"><h2><span class="name" title="Module 1: Simple Linear Regression">Module 1: Simple Linear Regression</span></h2></div>
    <div class="content"><ul class="ig-list items context_module_items">
      ${item(100, "context_module_sub_header", "Read first")}
      ${item(101, "wiki_page", "Module 1 overview")}
      ${item(102, "attachment", "Module 1 notes (PDF)")}
      ${item(103, "quiz", "Quiz 1: Simple regression")}
      ${item(104, "external_url", "Publisher website")}
    </ul></div>
  </div>
  <div class="context_module" id="context_module_12" data-module-id="12" aria-label="Module 2: Multiple Regression and Model Building">
    <div class="ig-header header"><h2><span class="name">Module 2: Multiple Regression and Model Building</span></h2></div>
    <div class="content"><ul class="ig-list items context_module_items">
      ${item(201, "wiki_page", "Module 2 overview")}
      ${item(202, "attachment", "Module 2 notes (Word)")}
      ${item(203, "assignment", "Homework 2")}
      ${item(204, "discussion_topic", "Week 2 discussion")}
      ${item(205, "attachment", "Lecture 2 recording")}
      ${item(206, "attachment", "Instructor slides (no download)")}
      ${item(207, "context_external_tool", "Lecture video player")}
    </ul></div>
  </div>
  <div class="context_module" id="context_module_13" data-module-id="13" aria-label="Module 3: Indicator Variables and Interactions">
    <div class="ig-header header"><i class="icon-lock locked_icon" title="Locked until November 23"></i><h2><span class="name">Module 3: Indicator Variables and Interactions</span></h2></div>
    <div class="content"><ul class="ig-list items context_module_items">
      ${item(301, "wiki_page", "Module 3 overview", { link: false, locked: true })}
      ${item(302, "attachment", "Module 3 slides", { link: false, locked: true })}
    </ul></div>
  </div>
  <div class="context_module" id="context_module_blank" style="display:none"><div class="ig-header"><span class="name">TEMPLATE-MODULE</span></div>
    <ul class="context_module_items">${item(999, "wiki_page", "TEMPLATE-ITEM")}</ul></div>
</div>`);

// Wiki pages render their body shortly after load, like a client-rendered LMS page.
const wikiPage = (title: string, html: string) => shell(`${title}: QMB 3250 (mock)`, `
<div id="wiki_page_show"><h1 class="page-title">${title}</h1><div class="show-content user_content"></div></div>
<aside id="right-side">MOCK-SIDEBAR-TODO</aside>
<script>setTimeout(function () { document.querySelector('.show-content').innerHTML = ${JSON.stringify(html)}; }, 250);</script>`);

const filePage = (id: number, name: string, download: boolean) => shell(`${name}: QMB 3250 (mock)`, `
<h2>${name}</h2>${download ? `<span><a href="${C}/files/${id}/download?download_frd=1">Download ${name}</a></span>` : "<p>Preview only. Downloading has been disabled for this file.</p>"}
<div id="doc_preview">MOCK-PREVIEW-FRAME</div>`);

const TARGETS: Record<number, string> = {
  101: `${C}/pages/module-1-overview`, 102: `${C}/files/501`, 103: `${C}/quizzes/7`, 201: `${C}/pages/module-2-overview`, 202: `${C}/files/502`,
  203: `${C}/assignments/9`, 204: `${C}/discussion_topics/4`, 205: `${C}/files/503`, 206: `${C}/files/504`,
};
const FILES: Record<number, { name: string; source: string | null; type: string }> = {
  501: { name: "module1-simple-regression.pdf", source: "module1-simple-regression.pdf", type: "application/pdf" },
  502: { name: "module2-multiple-regression.docx", source: "module2-multiple-regression.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  503: { name: "lecture2.mp4", source: null, type: "video/mp4" },
  504: { name: "instructor-slides.pptx", source: "module3-indicators-interactions.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
};

export type MockCanvas = { server: http.Server; requests: string[]; state: { version: number; mediasite: { posts: { resourceId?: string; queryString?: unknown; xhr: string | undefined }[]; captionGets: number } } };

export function startMockCanvas(port: number): Promise<MockCanvas> {
  const requests: string[] = [];
  const state = { version: 1, mediasite: { posts: [] as { resourceId?: string; queryString?: unknown; xhr: string | undefined }[], captionGets: 0 } };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const p = url.pathname;
    const html = (body: string, status = 200) => res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(body);
    if (p === "/login") return res.writeHead(302, { "Set-Cookie": "mock_canvas_session=signed-in; Path=/; HttpOnly; SameSite=Lax", Location: C }).end();
    if (!/mock_canvas_session=signed-in/.test(req.headers.cookie ?? "")) return res.writeHead(302, { Location: "/login-form" }).end();
    requests.push(p);
    // The real REST API must never be called by the extension.
    if (p.startsWith("/api/")) return res.writeHead(418).end("the extension must not call the LMS API");
    if (p === C) return html(shell("QMB 3250 (mock)", "<h1>QMB 3250 – Statistics for Business Decisions (mock course home)</h1>"));
    if (p === `${C}/modules`) return html(modulesPage());
    const itemMatch = /^\/courses\/77\/modules\/items\/(\d+)$/.exec(p);
    if (itemMatch && TARGETS[Number(itemMatch[1])]) return res.writeHead(302, { Location: TARGETS[Number(itemMatch[1])] }).end();
    if (p === `${C}/pages/module-1-overview`) return html(wikiPage("Module 1 overview", "<h2>What this module covers</h2><p>Synthetic mock course page for Klierly tests; not real course content.</p><p>The slope b1 is the estimated change in the average response for a one-unit increase in x. A residual is the observed value minus the predicted value.</p><div style='display:none'>MOCK-HIDDEN-ANSWER-KEY</div>"));
    if (p === `${C}/pages/module-2-overview`) return html(wikiPage("Module 2 overview", `<h2>Partial slopes</h2><p>Synthetic mock course page for Klierly tests; not real course content.</p><p>Each coefficient in a multiple regression is a partial slope, holding the other predictors in the model fixed.</p>${state.version > 1 ? "<p>UPDATED-BY-INSTRUCTOR: adjusted R-squared increases only when a new predictor improves the fit by more than chance.</p>" : ""}`));
    // A course page whose lecture is a Mediasite player embedded from another site (UF's usual arrangement).
    if (p === `${C}/pages/lecture-22`) return html(wikiPage("Module 22 lecture", `<h2>Lecture</h2><p>Synthetic mock lecture page for Klierly tests.</p><iframe src="http://127.0.0.1:${port + 1}/Mediasite/Play/abc123?autostart=false" width="480" height="270" title="Mediasite player"></iframe>`));
    // A lecture page: one player on the page itself, one embedded from another site (the usual LMS arrangement).
    if (p === `${C}/pages/lecture-21`) return html(wikiPage("Module 21 lecture", `<h2>Lecture video</h2><p>Synthetic mock lecture page for Klierly tests.</p><video controls width="320"><track kind="captions" srclang="en" label="English" src="${C}/media/lecture.vtt"></video><iframe src="http://127.0.0.1:${port + 1}/player" width="320" height="200" title="Embedded player"></iframe>`));
    if (p === `${C}/media/lecture.vtt`) return res.writeHead(200, { "Content-Type": "text/vtt" }).end(fs.readFileSync(path.join(SAMPLE, "lecture-module2.vtt")));
    const fileMatch = /^\/courses\/77\/files\/(\d+)(\/download)?$/.exec(p);
    if (fileMatch && FILES[Number(fileMatch[1])]) {
      const f = FILES[Number(fileMatch[1])];
      if (!fileMatch[2]) return html(filePage(Number(fileMatch[1]), f.name, Number(fileMatch[1]) !== 504));
      if (Number(fileMatch[1]) === 504) return res.writeHead(403).end("download disabled");
      const data = f.source ? fs.readFileSync(path.join(SAMPLE, f.source)) : Buffer.from("not a real video");
      return res.writeHead(200, { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${f.name}"`, "Content-Length": data.length }).end(data);
    }
    if (p === `${C}/quizzes/7`) return html(shell("Quiz 1", "<h1>Quiz 1</h1><form id='submit_quiz_form'><div class='question'><input type='radio' name='q1'> MOCK-QUIZ-CONTENT</div><button>Submit Quiz</button></form>"));
    html(shell("Not found", "<h1>Page not found</h1>"), 404);
  });
  // A separate "video platform" origin, like the third-party players course sites embed.
  const mediasiteBase = `http://127.0.0.1:${port + 1}`;
  const PRESENTATIONS: Record<string, { Title: string; Transcripts: { CaptionsUrl: string }[] }> = {
    abc123: { Title: "Mock Mediasite lecture: rank tests", Transcripts: [{ CaptionsUrl: `${mediasiteBase}/Mediasite/captions/abc123.vtt` }, { CaptionsUrl: `${mediasiteBase}/Mediasite/captions/second-language.vtt` }] },
    ttml1: { Title: "Mock Mediasite lecture: timed text", Transcripts: [{ CaptionsUrl: `${mediasiteBase}/Mediasite/captions/ttml1.xml` }] },
    none1: { Title: "Mock Mediasite lecture without captions", Transcripts: [] },
  };
  const player = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", mediasiteBase);
    const play = /^\/Mediasite\/Play\/([^/]+)$/.exec(u.pathname);
    if (play) return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><html><head><title>Mock Mediasite player</title></head><body><div id="ServicePath" style="display:none">/Mediasite/PlayerService/PlayerService.svc/json</div><h1>Mock Mediasite player</h1></body></html>`);
    if (req.method === "POST" && u.pathname === "/Mediasite/PlayerService/PlayerService.svc/json/GetPlayerOptions") {
      let raw = ""; req.on("data", (c) => { raw += c; });
      return req.on("end", () => {
        let body: { getPlayerOptionsRequest?: { ResourceId?: string; QueryString?: unknown } } = {};
        try { body = JSON.parse(raw); } catch { /* answered below */ }
        const r = body.getPlayerOptionsRequest;
        state.mediasite.posts.push({ resourceId: r?.ResourceId, queryString: r?.QueryString, xhr: req.headers["x-requested-with"] as string | undefined });
        if (!r?.ResourceId || !/application\/json/.test(req.headers["content-type"] ?? "")) return res.writeHead(400).end("bad request");
        const pres = PRESENTATIONS[r.ResourceId];
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ d: pres ? { Presentation: pres } : {} }));
      });
    }
    if (u.pathname === "/Mediasite/captions/abc123.vtt") { state.mediasite.captionGets++; return res.writeHead(200, { "Content-Type": "text/vtt" }).end("WEBVTT\n\n00:00:02.000 --> 00:00:06.000\nMEDIASITE-TRANSCRIPT-LINE the Wilcoxon rank sum test compares two independent groups using ranks.\n\n00:00:06.000 --> 00:00:10.000\nThe Kruskal-Wallis test handles three or more groups.\n"); }
    if (u.pathname === "/Mediasite/captions/ttml1.xml") { state.mediasite.captionGets++; return res.writeHead(200, { "Content-Type": "application/xml" }).end('<?xml version="1.0" encoding="utf-8"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:04.000">TTML-LINE ranks replace the raw values &amp; keep their order.</p><p begin="00:00:04.000" end="00:00:08.000">Ties receive the average of their ranks.</p></div></body></tt>'); }
    if (req.url === "/captions.vtt") return res.writeHead(200, { "Content-Type": "text/vtt" }).end("WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nEMBEDDED-PLAYER-CAPTION the Wilcoxon rank-sum test compares two independent groups using ranks.\n\n00:00:05.000 --> 00:00:09.500\nThe Kruskal-Wallis test extends the idea to three or more groups.\n");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><html><head><title>Mock player</title></head><body><video controls><track kind="subtitles" srclang="en" label="English (auto)" src="/captions.vtt"></video></body></html>`);
  });
  server.on("close", () => player.close());
  return new Promise((resolve) => player.listen(port + 1, "127.0.0.1", () => server.listen(port, "127.0.0.1", () => resolve({ server, requests, state }))));
}
