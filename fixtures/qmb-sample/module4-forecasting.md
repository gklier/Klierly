# Module 4: Time-Series Forecasting

> Synthetic sample material written for CourseLab testing. It is not actual University of Florida course content.

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

Weekly demand for five weeks was 120, 132, 128, 140, 136 units.

Three-week moving average. The forecast for week 6 is (128 + 140 + 136)/3 = 134.67 units.

Exponential smoothing with alpha = 0.3 and F(1) = 120. The forecasts are F(2) = 120.00, F(3) = 123.60, F(4) = 124.92, F(5) = 129.444 and F(6) = 131.41 units.

Accuracy of exponential smoothing over weeks 2 to 5. The errors are 12.000, 4.400, 15.080, 6.556. MAD = 9.509, MSE = 108.44 and MAPE = 7.03%.

## Trend and seasonal forecasts

A linear trend model fits y-hat = b0 + b1 t, where t is the period number. To forecast, substitute the future period number for t.

With a multiplicative seasonal model, the forecast is the trend value multiplied by the seasonal index for that season. A seasonal index of 1.20 means the season is typically 20% above the trend; an index of 0.85 means it is typically 15% below the trend.
