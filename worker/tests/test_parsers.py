import io

from .conftest import AUTH, BAD, SAMPLE


def all_text(body):
    return "\n".join(s["text"] for s in body["segments"])


def test_health_needs_no_token(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok" and "pdf" in r.json()["parsers"]


def test_token_required(client):
    r = client.post("/parse", files={"file": ("a.txt", b"hello")})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "unauthorized"
    assert client.post("/numeric/compute", json={"fn": "mean", "args": {"values": [1]}}).status_code == 401


def test_pdf_pages_and_headings(parse):
    r = parse(SAMPLE / "module1-simple-regression.pdf")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["parser"] == "pdf" and body["confidence"] >= 0.9
    pages = {s["page"] for s in body["segments"]}
    assert pages == {1, 2, 3}
    headings = {s["heading"] for s in body["segments"]}
    assert "Testing the slope" in headings and "Residual assumptions" in headings
    seg = next(s for s in body["segments"] if "p-value is the probability" in " ".join(s["text"].split()))
    assert seg["page"] == 2 and seg["heading"] == "Testing the slope"
    assert all(s["slide"] is None and s["t_start_ms"] is None for s in body["segments"])


def test_docx_headings_and_table(parse):
    body = parse(SAMPLE / "module2-multiple-regression.docx").json()
    assert body["parser"] == "docx"
    assert any(s["heading"] == "Multicollinearity" and "variance inflation factor" in s["text"] for s in body["segments"])
    tables = [s for s in body["segments"] if s["kind"] == "table"]
    assert len(tables) == 1
    rows = tables[0]["text"].split("\n")
    assert rows[0] == "Criterion | Better when | Penalty for extra predictors"
    assert "BIC | Smaller | ln(n) per parameter" in rows


def test_pptx_slides_and_notes(parse):
    body = parse(SAMPLE / "module3-indicators-interactions.pptx").json()
    assert body["parser"] == "pptx"
    slides = {s["slide"] for s in body["segments"]}
    assert slides == set(range(1, 9))
    s5 = [s for s in body["segments"] if s["slide"] == 5]
    assert any(s["heading"] == "Interaction terms" and "product of two predictors" in s["text"] for s in s5)
    assert any(s["heading"] == "Interaction terms (speaker notes)" for s in s5)


def test_markdown_sections_and_table(parse):
    body = parse(SAMPLE / "syllabus.md").json()
    assert body["parser"] == "markdown"
    assert any(s["kind"] == "table" and "December 4, 2026 | Exam 1" in s["text"] for s in body["segments"])
    assert any((s["heading"] or "").startswith("Module 3") for s in body["segments"])
    assert "**" not in all_text(body)


def test_csv_table(parse):
    body = parse(SAMPLE / "store-sales.csv").json()
    assert body["parser"] == "csv"
    assert "sales" in body["segments"][0]["text"] and "60" in body["segments"][0]["text"]
    table = next(s for s in body["segments"] if s["kind"] == "table")
    assert table["text"].split("\n")[0] == "sales | ad_spend | price | promo | region_urban"
    assert len(table["text"].split("\n")) == 61


def test_vtt_timestamps(parse):
    body = parse(SAMPLE / "lecture-module2.vtt").json()
    assert body["parser"] == "vtt"
    segs = body["segments"]
    assert len(segs) >= 4
    assert segs[0]["t_start_ms"] == 0 and segs[0]["t_end_ms"] > 0
    assert all(a["t_end_ms"] <= b["t_start_ms"] + 1000 for a, b in zip(segs, segs[1:]))
    assert segs[-1]["t_end_ms"] == 239_000
    assert "-->" not in all_text(body)


def test_srt(parse):
    srt = b"1\n00:00:01,000 --> 00:00:04,000\nHello regression.\n\n2\n00:01:10,500 --> 00:01:12,000\nSecond cue.\n"
    body = parse(name="a.srt", data=srt).json()
    assert body["segments"][0]["t_start_ms"] == 1000
    assert body["segments"][-1]["t_end_ms"] == 72_000


def test_xlsx(parse):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Scores"
    ws.append(["x", "y"]); ws.append([1, 2.5]); ws.append([2, 3.5])
    buf = io.BytesIO(); wb.save(buf)
    body = parse(name="data.xlsx", data=buf.getvalue()).json()
    table = next(s for s in body["segments"] if s["kind"] == "table")
    assert table["heading"] == "Scores" and table["text"].split("\n")[:2] == ["x | y", "1 | 2.5"]


def test_html_strips_scripts_and_hidden(parse):
    html = b"""<html><head><title>Lesson</title><script>alert('x')</script><style>p{}</style></head><body>
    <nav>Home Grades</nav><h1>Residuals</h1><p>A residual is observed minus predicted.</p>
    <div style="display:none">secret hidden text</div><form><input type="password" value="hunter2"></form></body></html>"""
    body = parse(name="page.html", data=html).json()
    text = all_text(body)
    assert "observed minus predicted" in text
    for bad in ("alert", "secret hidden", "hunter2", "Grades", "<p>"):
        assert bad not in text
    assert body["segments"][0]["heading"] == "Residuals"


def test_parse_text(client):
    r = client.post("/parse-text", headers=AUTH, json={"text": "# Topic\n\nBody text here.", "format": "markdown", "title": "Pasted"})
    assert r.status_code == 200 and r.json()["parser"] == "paste-markdown" and r.json()["title"] == "Pasted"
    assert r.json()["segments"][0]["heading"] == "Topic"
    assert client.post("/parse-text", headers=AUTH, json={"text": "   ", "format": "plain"}).json()["detail"]["code"] == "empty_document"
    assert client.post("/parse-text", headers=AUTH, json={"text": "x", "format": "rtf"}).status_code == 400


def test_unsupported_and_mismatch(parse):
    r = parse(BAD / "malware.exe")
    assert r.status_code == 415 and r.json()["detail"]["code"] == "unsupported_type"
    r = parse(name="archive.zip", data=b"PK\x03\x04junk")
    assert r.status_code == 415 and r.json()["detail"]["code"] == "unsupported_type"
    r = parse(BAD / "not-a-pdf.pdf")
    assert r.status_code == 415 and r.json()["detail"]["code"] == "type_mismatch"
    r = parse(name="notes.txt", data=(SAMPLE / "module1-simple-regression.pdf").read_bytes())
    assert r.status_code == 415 and r.json()["detail"]["code"] == "type_mismatch"
    r = parse(name="deck.pptx", data=(SAMPLE / "module2-multiple-regression.docx").read_bytes())
    assert r.status_code == 415 and r.json()["detail"]["code"] == "type_mismatch"


def test_empty_and_oversize(parse):
    r = parse(BAD / "empty.txt")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "empty_document"
    r = parse(name="big.txt", data=b"a" * (2 * 1024 * 1024 + 10))
    assert r.status_code == 413 and r.json()["detail"]["code"] == "too_large"


def test_encrypted_pdf(parse):
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter(clone_from=PdfReader(str(SAMPLE / "module1-simple-regression.pdf")))
    w.encrypt("secret")
    buf = io.BytesIO(); w.write(buf)
    r = parse(name="locked.pdf", data=buf.getvalue())
    assert r.status_code == 422 and r.json()["detail"]["code"] == "encrypted"


def test_blank_pdf_is_empty_not_invented(parse):
    from pypdf import PdfWriter
    w = PdfWriter(); w.add_blank_page(width=612, height=792)
    buf = io.BytesIO(); w.write(buf)
    r = parse(name="scan.pdf", data=buf.getvalue())
    assert r.status_code == 422 and r.json()["detail"]["code"] == "empty_document"


def test_caption_spacing_artifacts_are_repaired_without_changing_wording(parse):
    vtt = (b"WEBVTT\n\n00:00:00.750 --> 00:00:04.870\nwe will use jump to\ncompute the test statistic and p -value\n\n"
           b"00:00:05.000 --> 00:00:09.000\nthe online and the in -store scores, a t -test, right -click on a PC\n\n"
           b"00:00:10.000 --> 00:00:12.000\nthat negative 0 .286 is our D bar, and 5 -10 is a range, not a minus sign: a - b\n")
    body = parse(name="lecture.vtt", data=vtt).json()
    text = body["segments"][0]["text"]
    for fixed in ["p-value", "in-store", "t-test", "right-click", "negative 0.286", "5-10", "a - b"]:
        assert fixed in text, fixed
    for broken in ["p -value", "in -store", "0 .286"]:
        assert broken not in text, broken
    assert "jump" in text and "online and the in-store" in text  # recognition errors and wording are left alone
    assert body["segments"][0]["t_start_ms"] == 750
