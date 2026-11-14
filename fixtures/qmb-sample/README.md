# Synthetic sample course (QMB 3250-like)

**Synthetic sample material written for Klierly testing. It is not actual University of Florida course content.** All text, data and numbers were written or generated for
testing and for the in-app demo. Nothing here is copied from a real course,
textbook or exam.

| File | What it is |
| --- | --- |
| `syllabus.md` | Fictional syllabus: four modules, objectives, dated schedule |
| `module1-simple-regression.pdf` / `.md` | Notes on simple regression (PDF with page provenance) |
| `module2-multiple-regression.docx` | Notes on multiple regression and model selection (with a table) |
| `module3-indicators-interactions.pptx` | Slides with speaker notes on indicators and interactions |
| `module4-forecasting.md` | Notes on time-series forecasting with a worked example |
| `store-sales.csv` | 60-row synthetic dataset (fixed seed) |
| `model-output.txt` / `.json` | Regression output excerpts computed from the CSV with statsmodels |
| `lecture-module2.vtt` | Four-minute synthetic lecture transcript with timestamps |
| `sample-course.json` | Authored topics, study notes and question bank for the demo (see `web/scripts`) |

Rebuild: `../../worker/.venv/bin/python build_fixtures.py` (deterministic).
