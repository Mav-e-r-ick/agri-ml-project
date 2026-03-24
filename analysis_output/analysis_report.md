# Agricultural Price Analysis

Generated on 2026-03-24.

## Data used

- Onion source: `Daily price market/Onion 2015-2025.csv`
- Tomato source: `Daily price market/Tomato 2015-2025.csv`
- Weather sources used for modeling: `Weather/Ahmednagar_Daily_20150101_20260314_018d22N_074d53E_LST.csv`, `Weather/Kalyan_Daily_20150101_20260314_019d24N_073d13E_LST.csv`, `Weather/Mumbai_Daily_20150101_20260314_018d97N_072d82E_LST.csv`, `Weather/Nashik_Weather_Daily_20150101_20260314_019d99N_073d78E_LST.csv`, `Weather/Pune_weather_Daily_20150101_20260314_018d62N_073d61E_LST.csv`, `Weather/Satara_Daily_20150101_20260314_017d69N_074d01E_LST.csv`
- Note: although the file names say 2015-2025, the actual CSV records extend through 2026-03-12 for both onion and tomato. I used the exact dates present in the files.

## Descriptive analysis

### Onion

- Records: 19,754
- Markets: 29
- Date range: 2015-01-01 to 2026-03-12
- Modal price summary: {"count":19754,"mean":1573.77,"median":1275,"std":1170.06,"min":6,"q1":900,"q3":1900,"max":75000,"iqr":1000,"cv":0.74}
- Min price summary: {"count":19754,"mean":1010.15,"median":800,"std":779.01,"min":4,"q1":500,"q3":1200,"max":25000,"iqr":700,"cv":0.77}
- Max price summary: {"count":19754,"mean":2061.44,"median":1600,"std":1623.15,"min":12,"q1":1200,"q3":2500,"max":105000,"iqr":1300,"cv":0.79}
- Price spread summary: {"count":19754,"mean":1051.29,"median":800,"std":1219.4,"min":0,"q1":450,"q3":1300,"max":80000,"iqr":850,"cv":1.16}
- Data quality summary: {"missingCounts":{"date":0,"market":0,"minPrice":0,"maxPrice":0,"modalPrice":0},"duplicateCount":0,"duplicatePercentage":0}
- Outlier summary using IQR rule on modal price: {"lower":-600,"upper":3400,"count":1353,"percentage":6.85}

### Tomato

- Records: 18,760
- Markets: 18
- Date range: 2015-01-01 to 2026-03-12
- Modal price summary: {"count":18760,"mean":1587.95,"median":1250,"std":1173.37,"min":10,"q1":850,"q3":2000,"max":15000,"iqr":1150,"cv":0.74}
- Min price summary: {"count":18760,"mean":1122.8,"median":900,"std":926.15,"min":1,"q1":500,"q3":1400,"max":15000,"iqr":900,"cv":0.82}
- Max price summary: {"count":18760,"mean":2007.92,"median":1500,"std":1535.1,"min":13,"q1":1000,"q3":2500,"max":40000,"iqr":1500,"cv":0.76}
- Price spread summary: {"count":18760,"mean":885.11,"median":600,"std":960.29,"min":0,"q1":400,"q3":1000,"max":37400,"iqr":600,"cv":1.08}
- Data quality summary: {"missingCounts":{"date":0,"market":0,"minPrice":0,"maxPrice":0,"modalPrice":0},"duplicateCount":0,"duplicatePercentage":0}
- Outlier summary using IQR rule on modal price: {"lower":-875,"upper":3725,"count":1000,"percentage":5.33}

## EDA highlights

- Onion: highest average among the busiest markets was Junnar (1802.96), strongest month was 11 (2421.45), weakest month was 4 (849.42), and the most volatile busy market was Junnar(Alephata) (2646.28).
- Tomato: highest average among the busiest markets was Pune(Manjri) APMC (2428.57), strongest month was 7 (2548.64), weakest month was 4 (948.99), and the most volatile busy market was Manchar (1686.97).

## Detailed EDA interpretation

### Onion

- The long-run monthly trend chart shows several sharp price spikes, which means onion prices are highly volatile and exposed to episodic shocks.
- The seasonality chart shows the highest average prices in November and lower average levels in April.
- The distribution chart is strongly right-skewed because a small number of extreme observations pull the mean above the median.
- The market comparison chart shows that price levels are not uniform across markets, which supports using market aggregation and weather features together.

### Tomato

- The monthly trend chart is smoother than onion in some periods, but it still includes clear upward bursts and sudden corrections.
- The seasonality chart shows the highest average prices in July and the weakest average month in April.
- The price distribution is also right-skewed, but the maximum observed tomato price is much lower than the onion maximum.
- Differences across the most active markets suggest local supply conditions still matter even inside the same district.

## Correlation analysis

- Onion correlation matrix is included in `analysis_output/charts/onion_correlation_heatmap.svg`
- Tomato correlation matrix is included in `analysis_output/charts/tomato_correlation_heatmap.svg`
- These matrices compare price with aggregated rainfall, temperature, humidity, wind speed, and root-zone soil wetness from all weather files.

## Missing values, duplicates, and outliers

- Missing values were checked for key columns including date, market, minimum price, maximum price, and modal price.
- Duplicate records were checked using date, market, variety, grade, and price columns together.
- Outliers were identified using the standard IQR rule on modal price.

## Machine learning model

- Model type: ridge regression
- Target: daily average modal price across available Pune markets
- Features: lagged prices, rolling average, month seasonality, day of week, six-location aggregated rainfall, temperature, humidity, wind speed, soil wetness, and cross-city weather spread measures

### Onion model

- Train rows: 3144
- Test rows: 787
- Ridge metrics: {"mae":131.69,"rmse":222.35,"r2":0.9396}
- Baseline using previous day only: {"mae":141.36,"rmse":249.56,"r2":0.924}
- Residual summary: {"count":787,"mean":10.67,"median":3.06,"std":222.09,"min":-938.29,"q1":-86.93,"q3":89.69,"max":2969.62,"iqr":176.61,"cv":20.82}

### Tomato model

- Train rows: 3156
- Test rows: 789
- Ridge metrics: {"mae":188.86,"rmse":274.64,"r2":0.8946}
- Baseline using previous day only: {"mae":198.72,"rmse":289.6,"r2":0.8828}
- Residual summary: {"count":789,"mean":16.72,"median":-6.17,"std":274.13,"min":-1088.87,"q1":-121.88,"q3":131.38,"max":1650.78,"iqr":253.25,"cv":16.4}

## Diagnostic analysis

- The prediction-versus-actual line charts show whether the model follows turning points over time.
- The scatter plots show how closely predictions align with the ideal 45-degree line.
- The residual histograms show whether errors are centered around zero or biased upward or downward.
- Overall, the new all-weather model should be judged against both its numeric metrics and these diagnostic visuals.

## Output files

- Dashboard: `analysis_output/report.html`
- Summary report: `analysis_output/analysis_report.md`
- Charts: `analysis_output/charts/`
- Model previews: `analysis_output/onion_model_preview.json`, `analysis_output/tomato_model_preview.json`
