# Mumbai Fuel Price Analysis

Generated on 2026-03-24.

## 1. Project objective

This report analyses daily Mumbai retail selling prices for petrol and diesel using the Excel files available in the `Fuel price` folder. The workflow combined historical files, cleaned and merged the Mumbai series, performed descriptive analysis and exploratory data analysis, and then trained lag-based machine learning models for both fuels.

## 2. Data sources used

- `Fuel price/Daily Retail Selling Price of Petrol (in 2017-18).xlsx`
- `Fuel price/Daily Retail Selling Price of Petrol (in 2018-19).xlsx`
- `Fuel price/Daily Retail Selling Price of Petrol & Diesel (in 2019-20).xlsx` for Mumbai petrol
- `Fuel price/Petrol Price 2020-2026.xlsx`
- `Fuel price/Daily Retail Selling Price of Diesel (in 2017-18).xlsx`
- `Fuel price/Daily Retail Selling Price of Diesel (in 2018-19).xlsx`
- `Fuel price/Daily Retail Selling Price of Diesel (in 2019-20) (1).xlsx`
- `Fuel price/Diesel Price 2020-2026.xlsx`

## 3. How the analysis was performed

1. Historical Excel files were parsed directly from workbook XML.
2. Mumbai rows were filtered from the multi-city yearly sheets.
3. Single-series sheets were converted from Excel date serials to calendar dates when needed.
4. Petrol and diesel were merged on common Mumbai dates.
5. Descriptive analysis, seasonality analysis, spread analysis, and correlation analysis were performed.
6. Separate ridge regression models were trained for petrol and diesel using lag periods of 1, 7, 14, and 30 days, plus rolling averages, seasonal features, and lagged cross-fuel information.
7. Model performance was evaluated on a time-based holdout set and compared with a lag-one baseline.

## 4. Descriptive statistics

### Petrol

- Date range: 2017-06-16 to 2026-03-06
- Summary: {"count":3186,"mean":95.31,"median":103.44,"std":12.94,"min":73.23,"q1":80.59,"q3":106.31,"max":120.51,"iqr":25.72,"cv":0.14}
- Outliers by IQR rule: {"lower":42.01,"upper":144.89,"count":0,"percentage":0}

### Diesel

- Date range: 2017-06-16 to 2026-03-06
- Summary: {"count":3186,"mean":83.44,"median":90.03,"std":12.27,"min":58.19,"q1":70.09,"q3":94.27,"max":106.62,"iqr":24.18,"cv":0.15}
- Outliers by IQR rule: {"lower":33.83,"upper":130.54,"count":0,"percentage":0}

### Data quality

- Common Mumbai dates used in merged analysis: 3186
- Missing petrol values after merge: 0
- Missing diesel values after merge: 0
- Duplicate dates after merge: 0

## 5. Exploratory data analysis

- The long-run monthly trend chart shows that petrol and diesel move closely together, but petrol stays consistently above diesel.
- The month-wise charts help highlight recurring annual patterns and periods of higher average prices.
- The spread chart tracks how the price difference between petrol and diesel evolved through time.
- The correlation heatmap quantifies how strongly the two fuels move together and how daily changes co-move.

## 6. Machine learning models

### Petrol model

- Algorithm: ridge regression
- Features: lag 1, lag 7, lag 14, lag 30, rolling averages, diesel lags, spread lags, day of week, and month seasonality
- Train rows: 2524
- Test rows: 632
- Ridge regression metrics: {"mae":0.01,"rmse":0.03,"r2":0.9204}
- Lag one baseline metrics: {"mae":0,"rmse":0.03,"r2":0.9314}
- Residual summary: {"count":632,"mean":0,"median":-0.01,"std":0.03,"min":-0.78,"q1":-0.01,"q3":0,"max":0.08,"iqr":0.01,"cv":-14.3}

### Diesel model

- Algorithm: ridge regression
- Features: lag 1, lag 7, lag 14, lag 30, rolling averages, petrol lags, spread lags, day of week, and month seasonality
- Train rows: 2524
- Test rows: 632
- Ridge regression metrics: {"mae":0.02,"rmse":0.09,"r2":0.9302}
- Lag one baseline metrics: {"mae":0,"rmse":0.09,"r2":0.9335}
- Residual summary: {"count":632,"mean":-0.01,"median":-0.01,"std":0.09,"min":-2.19,"q1":-0.02,"q3":0,"max":0.12,"iqr":0.02,"cv":-9.77}

## 7. Interpretation of results

- Strong performance against the lag-one baseline indicates that the richer lag structure improves short-term price prediction.
- Petrol and diesel remain tightly connected, so cross-fuel lags are useful explanatory variables.
- Diagnostic scatter plots and actual-versus-predicted charts should be read together with RMSE and R2 before drawing forecasting conclusions.

## 8. Output files

- HTML report: `fuel_analysis_output/report.html`
- PDF report: `fuel_analysis_output/mumbai_fuel_price_report.pdf`
- JSON summary: `fuel_analysis_output/summary.json`
- Charts: `fuel_analysis_output/charts/`
