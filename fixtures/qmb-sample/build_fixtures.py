"""Build the SYNTHETIC sample course used by CourseLab tests and the demo.

Everything here is original sample material written for CourseLab testing.
It is NOT actual University of Florida (or any university's) course content.

Run with the worker's virtualenv:  ../../worker/.venv/bin/python build_fixtures.py
Deterministic: fixed random seed, no timestamps in outputs.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

HERE = Path(__file__).parent
DISCLAIMER = ("Synthetic sample material written for CourseLab testing. "
              "It is not actual University of Florida course content.")

# ------------------------------------------------------------------ dataset
rng = np.random.default_rng(3250)
n = 60
ad = np.round(rng.uniform(5, 30, n), 1)
price = np.round(rng.uniform(8, 14, n), 2)
promo = (rng.uniform(size=n) < 0.4).astype(int)
urban = (rng.uniform(size=n) < 0.5).astype(int)
sales = np.round(40 + 2.5 * ad - 3.0 * price + 6 * promo + 1.2 * ad * promo + 4 * urban + rng.normal(0, 6, n), 1)
df = pd.DataFrame({"sales": sales, "ad_spend": ad, "price": price, "promo": promo, "region_urban": urban})
df.to_csv(HERE / "store-sales.csv", index=False)


def fit(xcols: dict[str, np.ndarray]) -> dict:
    X = sm.add_constant(pd.DataFrame(xcols))
    res = sm.OLS(df["sales"], X).fit()
    k = len(xcols)
    terms = [{"name": "Intercept" if name == "const" else name, "estimate": float(res.params[name]),
              "std_error": float(res.bse[name]), "t": float(res.tvalues[name]), "p": float(res.pvalues[name])}
             for name in X.columns]
    return {"n": int(res.nobs), "k": k, "r2": float(res.rsquared), "adj_r2": float(res.rsquared_adj),
            "rmse": float(np.sqrt(res.mse_resid)), "sse": float(res.ssr), "sst": float(res.centered_tss),
            "ssr_model": float(res.ess), "f": float(res.fvalue), "f_p": float(res.f_pvalue), "terms": terms}


model_a = fit({"ad_spend": df["ad_spend"]})
model_b = fit({"ad_spend": df["ad_spend"], "price": df["price"], "promo": df["promo"],
               "ad_spend*promo": df["ad_spend"] * df["promo"]})
(HERE / "model-output.json").write_text(json.dumps({"note": DISCLAIMER, "model_a": model_a, "model_b": model_b}, indent=2) + "\n")


def pfmt(p: float) -> str:
    return "<.0001" if p < 0.0001 else f"{p:.4f}"


def report(title: str, m: dict) -> str:
    dfe = m["n"] - m["k"] - 1
    lines = [title, "", "Summary of Fit",
             f"  RSquare                      {m['r2']:.4f}",
             f"  RSquare Adj                  {m['adj_r2']:.4f}",
             f"  Root Mean Square Error       {m['rmse']:.3f}",
             f"  Observations                 {m['n']}", "",
             "Analysis of Variance",
             "  Source     DF    Sum of Squares    Mean Square    F Ratio    Prob > F",
             f"  Model      {m['k']:<5} {m['ssr_model']:<17.2f} {m['ssr_model'] / m['k']:<14.2f} {m['f']:<10.2f} {pfmt(m['f_p'])}",
             f"  Error      {dfe:<5} {m['sse']:<17.2f} {m['sse'] / dfe:<14.2f}",
             f"  C. Total   {m['n'] - 1:<5} {m['sst']:<17.2f}", "",
             "Parameter Estimates",
             "  Term              Estimate    Std Error    t Ratio    Prob>|t|"]
    for t in m["terms"]:
        lines.append(f"  {t['name']:<17} {t['estimate']:<11.3f} {t['std_error']:<12.3f} {t['t']:<10.2f} {pfmt(t['p'])}")
    return "\n".join(lines)


(HERE / "model-output.txt").write_text(
    "REGRESSION OUTPUT EXCERPTS (store-sales.csv)\n\n" + DISCLAIMER + "\n"
    "The layout imitates the style of common statistical software reports; it was produced by a script, not by any commercial package.\n"
    "Response: sales (thousand dollars per week). n = 60 stores.\n\n"
    + report("MODEL A: sales = b0 + b1 ad_spend", model_a) + "\n\n\n"
    + report("MODEL B: sales = b0 + b1 ad_spend + b2 price + b3 promo + b4 ad_spend*promo", model_b) + "\n")

A = {t["name"]: t for t in model_a["terms"]}
B = {t["name"]: t for t in model_b["terms"]}
r = lambda v, d=3: round(v, d)  # noqa: E731
b0, b_ad, b_price, b_promo, b_int = (r(B[k]["estimate"]) for k in ["Intercept", "ad_spend", "price", "promo", "ad_spend*promo"])
a0, a1 = r(A["Intercept"]["estimate"]), r(A["ad_spend"]["estimate"])

# ------------------------------------------------------------------ syllabus
(HERE / "syllabus.md").write_text(f"""# QMB 3250-like Sample Course: Statistics for Business Decisions (Synthetic Syllabus)

> {DISCLAIMER} Instructor names, dates, weights and policies below are fictional.

## Course description

This sample course covers regression modeling and forecasting for business decisions. Students learn to fit models, read statistical software output, and explain results in plain business language.

## Modules

Module 1: Simple Linear Regression
Module 2: Multiple Regression and Model Building
Module 3: Indicator Variables and Interactions
Module 4: Time-Series Forecasting

## Learning objectives

### Module 1: Simple Linear Regression

Learning objectives:
- Interpret the slope and intercept of a fitted least-squares line in context.
- Explain what R-squared and the root mean square error measure.
- Use a t ratio and p-value to test whether a slope differs from zero.

### Module 2: Multiple Regression and Model Building

Learning objectives:
- Interpret a partial slope while holding the other predictors fixed.
- Compare models using adjusted R-squared, AIC and BIC.
- Recognize multicollinearity and explain why it inflates standard errors.

### Module 3: Indicator Variables and Interactions

Learning objectives:
- Code a categorical predictor with indicator variables and identify the baseline category.
- Interpret the coefficient of an indicator variable as a shift relative to the baseline.
- Explain how an interaction term changes the slope of another predictor.

### Module 4: Time-Series Forecasting

Learning objectives:
- Distinguish trend, seasonal and irregular components of a time series.
- Compute moving-average and exponential-smoothing forecasts.
- Compare forecasting methods using MAD, MSE and MAPE.

## Schedule

| Date | Item |
| --- | --- |
| October 26, 2026 | Module 1 opens |
| November 9, 2026 | Module 2 opens |
| November 20, 2026 | Homework 2 due |
| November 23, 2026 | Module 3 opens |
| December 4, 2026 | Exam 1 — covers Modules 1–3 |
| December 7, 2026 | Module 4 opens |
| December 15, 2026 | Final Exam — covers Modules 1–4 |

Exam 1: December 4, 2026 — covers Modules 1–3.

Final Exam: December 15, 2026 — covers Modules 1–4.

## Grading (fictional)

Homework 20%, Exam 1 35%, Final Exam 45%.
""")

# ------------------------------------------------------------------ module 1
t_a1 = A["ad_spend"]["t"]
M1 = [
    ("The least-squares line", [
        "Simple linear regression describes how the average value of a response variable y changes with one predictor x. The fitted line is written y-hat = b0 + b1 x, where b0 is the intercept and b1 is the slope.",
        "The least-squares method chooses b0 and b1 so that the sum of squared residuals is as small as possible. A residual is the observed value minus the predicted value, e = y - y-hat. Squaring keeps positive and negative misses from cancelling and penalizes large misses more heavily.",
        "The least-squares line always passes through the point of means (x-bar, y-bar), and its residuals always sum to zero.",
    ]),
    ("Interpreting the slope and intercept", [
        "The slope b1 is the estimated change in the average response for a one-unit increase in x. It describes an association in the data; by itself it does not prove that changing x causes y to change.",
        f"Example. For the store-sales sample data, weekly sales (in thousand dollars) were regressed on advertising spend (in thousand dollars). The fitted line is sales-hat = {a0} + {a1} ad_spend. Each additional thousand dollars of advertising is associated with an average increase of about {a1} thousand dollars in weekly sales.",
        "The intercept b0 is the predicted response when x equals zero. It has a practical meaning only when x = 0 lies inside, or close to, the range of the observed data. Predicting far outside the observed range of x is called extrapolation and is unreliable.",
    ]),
    ("R-squared and the root mean square error", [
        "R-squared is the proportion of the variation in y that is explained by the regression: R-squared = 1 - SSE/SST, where SSE is the sum of squared residuals and SST is the total sum of squares around the mean of y.",
        "R-squared lies between 0 and 1. In simple regression it equals the square of the correlation between x and y. A high R-squared does not show that the model is appropriate; always look at a residual plot.",
        "The root mean square error (RMSE), also called the standard error of the regression, estimates the typical size of a residual in the units of y. In simple regression RMSE = square root of SSE/(n - 2).",
    ]),
    ("Testing the slope", [
        "To test whether x is useful as a linear predictor, test the null hypothesis that the population slope is zero. The test statistic is the t ratio: t = b1 divided by the standard error of b1. In simple regression it has n - 2 degrees of freedom.",
        "The p-value is the probability of obtaining a t ratio at least as extreme as the one observed if the null hypothesis were true. A small p-value (commonly below 0.05) is evidence against the null hypothesis. A p-value is not the probability that the null hypothesis is true.",
        f"Example. In the store-sales output the slope of ad_spend is {a1} with standard error {r(A['ad_spend']['std_error'])}, so the t ratio is about {t_a1:.2f}. The p-value is below 0.0001, so there is very strong evidence that the slope is not zero.",
        "A 95% confidence interval for the slope is b1 plus or minus the critical t value times the standard error of b1. If the interval does not contain zero, the slope is significant at the 5% level.",
    ]),
    ("Residual assumptions", [
        "Inference in regression relies on four conditions: the relationship is linear, the errors are independent, the errors have constant variance, and the errors are approximately normally distributed.",
        "A residual plot with a curved pattern suggests the relationship is not linear. A funnel shape, where the spread of residuals grows with the fitted values, signals non-constant variance, also called heteroscedasticity.",
    ]),
]

# ------------------------------------------------------------------ module 2
M2 = [
    ("The multiple regression model", [
        "Multiple regression uses several predictors at once: y-hat = b0 + b1 x1 + b2 x2 + ... + bk xk, where k is the number of predictors.",
        "Each coefficient is a partial slope. It is the estimated change in the average response for a one-unit increase in that predictor, holding the other predictors in the model fixed. The same variable can have a different coefficient in a different model because the set of variables being held fixed has changed.",
    ]),
    ("Adjusted R-squared", [
        "R-squared never decreases when a predictor is added, even a useless one. It therefore cannot be used on its own to choose between models with different numbers of predictors.",
        "Adjusted R-squared corrects for model size: adjusted R-squared = 1 - (1 - R-squared)(n - 1)/(n - k - 1). It increases only when a new predictor improves the fit by more than would be expected by chance, and it can decrease when a weak predictor is added.",
    ]),
    ("The overall F test", [
        "The overall F test asks whether the model as a whole is useful. The null hypothesis is that all k slope coefficients are zero. The F ratio is the model mean square divided by the error mean square, with k and n - k - 1 degrees of freedom.",
        "A small p-value for the F ratio shows that at least one predictor is useful. It does not show that every predictor is useful; the individual t ratios address each predictor separately.",
    ]),
    ("Multicollinearity", [
        "Multicollinearity occurs when predictors are strongly correlated with one another. It inflates the standard errors of the affected coefficients, which makes their t ratios smaller and their estimates unstable, although the predictions of the model as a whole can remain accurate.",
        "The variance inflation factor (VIF) measures the problem for each predictor: VIF = 1/(1 - R-squared of that predictor regressed on the other predictors). A common rule of thumb treats a VIF above 10 as a sign of serious multicollinearity.",
    ]),
    ("Model-selection criteria", [
        "Several criteria balance goodness of fit against model complexity. For adjusted R-squared, larger is better. For AIC and BIC, smaller is better.",
        "For least-squares models, AIC can be computed (up to a constant) as n ln(SSE/n) + 2(k + 1) and BIC as n ln(SSE/n) + (k + 1) ln(n). Because ln(n) is larger than 2 once n is at least 8, BIC penalizes extra predictors more heavily than AIC and tends to choose smaller models.",
        "Mallows Cp compares each candidate model with the full model; a good candidate has Cp close to its number of parameters, k + 1.",
    ]),
    ("Stepwise selection caveats", [
        "Stepwise procedures add or remove predictors automatically based on a criterion. They are convenient but they search many models, so the reported p-values of the final model are too optimistic. Stepwise results should be treated as suggestions and checked against subject-matter knowledge and fresh data.",
    ]),
]
M2_TABLE = [["Criterion", "Better when", "Penalty for extra predictors"],
            ["R-squared", "Larger", "None"],
            ["Adjusted R-squared", "Larger", "Mild"],
            ["AIC", "Smaller", "2 per parameter"],
            ["BIC", "Smaller", "ln(n) per parameter"]]

# ------------------------------------------------------------------ module 3
pred_no = b0 + b_ad * 20 + b_price * 10
pred_yes = pred_no + b_promo + b_int * 20
SLIDES = [
    ("Indicator variables", ["A categorical predictor cannot be entered into a regression as text.",
                             "An indicator variable (also called a dummy variable) takes the value 1 when an observation is in a category and 0 otherwise.",
                             "In the store-sales data, promo = 1 for weeks with a promotion and promo = 0 for weeks without one."],
     f"{DISCLAIMER} Remind students that 0 and 1 are labels for group membership, not quantities."),
    ("The baseline category", ["A categorical variable with c categories needs c - 1 indicator variables.",
                               "The category that receives no indicator is the baseline category (also called the reference category).",
                               "Including an indicator for every category together with the intercept creates perfect multicollinearity, known as the dummy variable trap."],
     "Every indicator coefficient is a comparison with the baseline category."),
    ("Interpreting an indicator coefficient", ["The coefficient of an indicator variable is the estimated difference in the average response between that category and the baseline category, holding the other predictors fixed.",
                                               "Without an interaction, an indicator shifts the intercept: the two groups have parallel lines."], None),
    ("Interaction terms", ["An interaction term is the product of two predictors, for example ad_spend*promo.",
                           "An interaction lets the slope of one predictor depend on the value of the other.",
                           "With the model y-hat = b0 + b1 x + b2 d + b3 x d, the slope of x is b1 when d = 0 and b1 + b3 when d = 1."],
     "If the interaction is significant, interpret the main effects with care: the effect of the indicator depends on the value of x."),
    ("Worked example: the fitted model", [f"Model B from the regression output: sales-hat = {b0} + {b_ad} ad_spend + ({b_price}) price + {b_promo} promo + {b_int} ad_spend*promo.",
                                          f"Without a promotion the slope of ad_spend is {b_ad}.",
                                          f"With a promotion the slope of ad_spend is {b_ad} + {b_int} = {r(b_ad + b_int)}."],
     "The interaction coefficient is the difference between the two advertising slopes."),
    ("Worked example: a prediction", ["Predict weekly sales for a store with ad_spend = 20 and price = 10.",
                                      f"No promotion: {b0} + {b_ad}(20) + ({b_price})(10) = {pred_no:.2f} thousand dollars.",
                                      f"With promotion: add {b_promo} + {b_int}(20), giving {pred_yes:.2f} thousand dollars.",
                                      f"At ad_spend = 20 the estimated promotion effect is {b_promo} + {b_int}(20) = {pred_yes - pred_no:.2f} thousand dollars."],
     "The promotion effect is not a single number: it grows with advertising spend because of the interaction."),
    ("Testing an interaction", ["Test the interaction with the t ratio of the product term.",
                                "If the interaction is not significant, a simpler parallel-lines model may be adequate.",
                                "Keep the main effects in the model whenever their interaction is included."], None),
]

# ------------------------------------------------------------------ module 4
series = [120, 132, 128, 140, 136]
alpha = 0.3
F = [series[0]]
for y in series:
    F.append(alpha * y + (1 - alpha) * F[-1])
ma3 = sum(series[-3:]) / 3
errs = [series[i] - F[i] for i in range(1, 5)]
mad = sum(abs(e) for e in errs) / 4
mse = sum(e * e for e in errs) / 4
mape = sum(abs(e) / series[i] for i, e in zip(range(1, 5), errs)) / 4 * 100
(HERE / "module4-forecasting.md").write_text(f"""# Module 4: Time-Series Forecasting

> {DISCLAIMER}

## Components of a time series

A time series is a variable recorded at regular intervals. Its behavior is usually described with three components. The trend is the long-run upward or downward movement. The seasonal component is a pattern that repeats over a fixed period, such as higher retail sales every December. The irregular component is the unpredictable variation that remains.

## Moving averages

A moving-average forecast for the next period is the mean of the most recent k observations. A larger k produces a smoother forecast that reacts more slowly to real changes; a smaller k reacts faster but passes through more noise.

Moving averages lag behind a trend, so they suit series without a strong trend or seasonal pattern.

## Exponential smoothing

Simple exponential smoothing updates the forecast with the recursion F(t+1) = alpha Y(t) + (1 - alpha) F(t), where Y(t) is the actual value in period t, F(t) is the forecast for period t, and alpha is the smoothing constant between 0 and 1.

A value of alpha close to 1 puts most of the weight on the latest observation, so the forecast responds quickly. A value of alpha close to 0 gives a smooth forecast that responds slowly. The first forecast is usually set equal to the first actual value.

## Measuring forecast accuracy

A forecast error is the actual value minus the forecast. Three common summaries are used. MAD, the mean absolute deviation, is the average of the absolute errors. MSE, the mean squared error, is the average of the squared errors and penalizes large errors more heavily. MAPE, the mean absolute percentage error, is the average of the absolute errors expressed as percentages of the actual values, so it can be compared across series with different units.

When comparing two methods on the same series, the method with the smaller MAD, MSE or MAPE has been more accurate.

## Worked example

Weekly demand for five weeks was {", ".join(map(str, series))} units.

Three-week moving average. The forecast for week 6 is ({series[2]} + {series[3]} + {series[4]})/3 = {ma3:.2f} units.

Exponential smoothing with alpha = {alpha} and F(1) = {series[0]}. The forecasts are F(2) = {F[1]:.2f}, F(3) = {F[2]:.2f}, F(4) = {F[3]:.2f}, F(5) = {F[4]:.3f} and F(6) = {F[5]:.2f} units.

Accuracy of exponential smoothing over weeks 2 to 5. The errors are {", ".join(f"{e:.3f}" for e in errs)}. MAD = {mad:.3f}, MSE = {mse:.2f} and MAPE = {mape:.2f}%.

## Trend and seasonal forecasts

A linear trend model fits y-hat = b0 + b1 t, where t is the period number. To forecast, substitute the future period number for t.

With a multiplicative seasonal model, the forecast is the trend value multiplied by the seasonal index for that season. A seasonal index of 1.20 means the season is typically 20% above the trend; an index of 0.85 means it is typically 15% below the trend.
""")

# ------------------------------------------------------------------ transcript
cues = [
    "Welcome back. This is a synthetic sample lecture written for CourseLab testing. Today we read a regression output table from top to bottom.",
    "Start with the summary of fit. R-square tells you the share of the variation in the response that the model explains.",
    "Right below it you will see R-square adjusted. Use the adjusted value when you compare models that have different numbers of predictors.",
    "Root mean square error is in the units of the response. Think of it as the typical size of a prediction miss.",
    "Next is the analysis of variance table. The F ratio tests whether the model as a whole is useful.",
    "The null hypothesis for the F test says that every slope is zero. A tiny probability value means at least one predictor matters.",
    "Now the parameter estimates. Each row is one term in the model: the estimate, its standard error, the t ratio and the p-value.",
    "The t ratio is simply the estimate divided by its standard error. Check it yourself with a calculator; it builds trust in the table.",
    "A p-value below five percent means the term is significant at the five percent level, given that the other terms are in the model.",
    "Remember that each estimate is a partial slope. It holds the other predictors fixed.",
    "Do not rank the importance of predictors by the size of their coefficients. The coefficients depend on the units of each variable.",
    "Finally, always look at the residual plot before you trust any of these numbers. A curved pattern or a funnel shape means the model needs work.",
]
def ts(sec: int) -> str:
    return f"00:{sec // 60:02d}:{sec % 60:02d}.000"
vtt = ["WEBVTT", "", f"NOTE {DISCLAIMER}", ""]
for i, c in enumerate(cues):
    vtt += [f"{ts(i * 20)} --> {ts(i * 20 + 19)}", c, ""]
(HERE / "lecture-module2.vtt").write_text("\n".join(vtt))

# ------------------------------------------------------------------ renderers
def to_md(title: str, sections) -> str:
    out = [f"# {title}", "", f"> {DISCLAIMER}", ""]
    for h, paras in sections:
        out += [f"## {h}", ""]
        for p in paras:
            out += [p, ""]
    return "\n".join(out)


(HERE / "module1-simple-regression.md").write_text(to_md("Module 1: Simple Linear Regression", M1))


def build_pdf():
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer
    st = getSampleStyleSheet()
    doc = SimpleDocTemplate(str(HERE / "module1-simple-regression.pdf"), pagesize=letter, invariant=1,
                            title="Module 1: Simple Linear Regression", author="CourseLab synthetic sample")
    flow = [Paragraph("Module 1: Simple Linear Regression", st["Title"]), Paragraph(DISCLAIMER, st["Italic"]), Spacer(1, 12)]
    for i, (h, paras) in enumerate(M1):
        if i in (2, 4):
            flow.append(PageBreak())
        flow.append(Paragraph(h, st["Heading2"]))
        for p in paras:
            flow += [Paragraph(p, st["BodyText"]), Spacer(1, 6)]
    doc.build(flow)


def build_docx():
    from docx import Document
    d = Document()
    d.core_properties.title = "Module 2: Multiple Regression and Model Building"
    d.add_heading("Module 2: Multiple Regression and Model Building", 0)
    d.add_paragraph(DISCLAIMER)
    for h, paras in M2:
        d.add_heading(h, 1)
        for p in paras:
            d.add_paragraph(p)
        if h == "Model-selection criteria":
            t = d.add_table(rows=len(M2_TABLE), cols=3)
            for i, row in enumerate(M2_TABLE):
                for j, cell in enumerate(row):
                    t.cell(i, j).text = cell
    d.save(str(HERE / "module2-multiple-regression.docx"))


def build_pptx():
    from pptx import Presentation
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = "Module 3: Indicator Variables and Interactions"
    s.placeholders[1].text = DISCLAIMER
    for title, bullets, notes in SLIDES:
        s = prs.slides.add_slide(prs.slide_layouts[1])
        s.shapes.title.text = title
        tf = s.placeholders[1].text_frame
        tf.text = bullets[0]
        for b in bullets[1:]:
            tf.add_paragraph().text = b
        if notes:
            s.notes_slide.notes_text_frame.text = notes
    prs.save(str(HERE / "module3-indicators-interactions.pptx"))


build_pdf(); build_docx(); build_pptx()

(HERE / "README.md").write_text(f"""# Synthetic sample course (QMB 3250-like)

**{DISCLAIMER}** All text, data and numbers were written or generated for
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
""")
print(json.dumps({"a": {"b0": a0, "b1": a1, "se": A["ad_spend"]["std_error"], "t": t_a1, "r2": model_a["r2"], "rmse": model_a["rmse"], "sse": model_a["sse"], "sst": model_a["sst"]},
                  "b": {t["name"]: [round(t["estimate"], 3), round(t["std_error"], 3), round(t["t"], 2), t["p"]] for t in model_b["terms"]},
                  "b_fit": {k: model_b[k] for k in ["r2", "adj_r2", "rmse", "sse", "sst", "f"]},
                  "pred_no": pred_no, "pred_yes": pred_yes, "F": F, "ma3": ma3, "mad": mad, "mse": mse, "mape": mape}, indent=1))
