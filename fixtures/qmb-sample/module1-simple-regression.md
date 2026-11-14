# Module 1: Simple Linear Regression

> Synthetic sample material written for CourseLab testing. It is not actual University of Florida course content.

## The least-squares line

Simple linear regression describes how the average value of a response variable y changes with one predictor x. The fitted line is written y-hat = b0 + b1 x, where b0 is the intercept and b1 is the slope.

The least-squares method chooses b0 and b1 so that the sum of squared residuals is as small as possible. A residual is the observed value minus the predicted value, e = y - y-hat. Squaring keeps positive and negative misses from cancelling and penalizes large misses more heavily.

The least-squares line always passes through the point of means (x-bar, y-bar), and its residuals always sum to zero.

## Interpreting the slope and intercept

The slope b1 is the estimated change in the average response for a one-unit increase in x. It describes an association in the data; by itself it does not prove that changing x causes y to change.

Example. For the store-sales sample data, weekly sales (in thousand dollars) were regressed on advertising spend (in thousand dollars). The fitted line is sales-hat = 12.823 + 2.989 ad_spend. Each additional thousand dollars of advertising is associated with an average increase of about 2.989 thousand dollars in weekly sales.

The intercept b0 is the predicted response when x equals zero. It has a practical meaning only when x = 0 lies inside, or close to, the range of the observed data. Predicting far outside the observed range of x is called extrapolation and is unreliable.

## R-squared and the root mean square error

R-squared is the proportion of the variation in y that is explained by the regression: R-squared = 1 - SSE/SST, where SSE is the sum of squared residuals and SST is the total sum of squares around the mean of y.

R-squared lies between 0 and 1. In simple regression it equals the square of the correlation between x and y. A high R-squared does not show that the model is appropriate; always look at a residual plot.

The root mean square error (RMSE), also called the standard error of the regression, estimates the typical size of a residual in the units of y. In simple regression RMSE = square root of SSE/(n - 2).

## Testing the slope

To test whether x is useful as a linear predictor, test the null hypothesis that the population slope is zero. The test statistic is the t ratio: t = b1 divided by the standard error of b1. In simple regression it has n - 2 degrees of freedom.

The p-value is the probability of obtaining a t ratio at least as extreme as the one observed if the null hypothesis were true. A small p-value (commonly below 0.05) is evidence against the null hypothesis. A p-value is not the probability that the null hypothesis is true.

Example. In the store-sales output the slope of ad_spend is 2.989 with standard error 0.31, so the t ratio is about 9.63. The p-value is below 0.0001, so there is very strong evidence that the slope is not zero.

A 95% confidence interval for the slope is b1 plus or minus the critical t value times the standard error of b1. If the interval does not contain zero, the slope is significant at the 5% level.

## Residual assumptions

Inference in regression relies on four conditions: the relationship is linear, the errors are independent, the errors have constant variance, and the errors are approximately normally distributed.

A residual plot with a curved pattern suggests the relationship is not linear. A funnel shape, where the spread of residuals grows with the fitted values, signals non-constant variance, also called heteroscedasticity.
