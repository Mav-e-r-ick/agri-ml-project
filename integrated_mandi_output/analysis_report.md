# Integrated Onion and Tomato Mandi Price Intelligence Report

Generated on 2026-03-24.

## Objective

This study integrates Pune district onion and tomato mandi prices with nearby district weather information and Mumbai fuel prices in order to explain price fluctuations, predict future prices, and provide prescriptive guidance.

## Method

1. Daily average modal prices were computed across available Pune district markets.
2. Weather variables were aggregated across Pune and nearby districts using cross-city averages and ranges.
3. Mumbai petrol and diesel prices were joined by date.
4. Onion and tomato were modeled separately with crop-specific lag structures.
5. The first 80 percent of model rows were used for training and the last 20 percent for testing.
6. Five fold time-series cross-validation was used to select the ridge penalty.
7. Ridge regression was used to reduce multicollinearity risk from correlated lag and exogenous features.

## Descriptive analysis

- Onion summary: {"count":19754,"mean":1573.77,"median":1275,"std":1170.06,"min":6,"q1":900,"q3":1900,"max":75000,"iqr":1000,"cv":0.74}
- Onion outliers: {"lower":-600,"upper":3400,"count":1353,"percentage":6.85}
- Onion data quality: {"missingModal":0,"duplicateRows":6}
- Tomato summary: {"count":18760,"mean":1587.95,"median":1250,"std":1173.37,"min":10,"q1":850,"q3":2000,"max":15000,"iqr":1150,"cv":0.74}
- Tomato outliers: {"lower":-875,"upper":3725,"count":1000,"percentage":5.33}
- Tomato data quality: {"missingModal":0,"duplicateRows":2}

## Predictive analysis

- Onion model metrics: {"mae":150.79,"rmse":247.88,"r2":0.9371}
- Onion baseline metrics: {"mae":153.45,"rmse":274.88,"r2":0.9227}
- Tomato model metrics: {"mae":199.71,"rmse":287.84,"r2":0.894}
- Tomato baseline metrics: {"mae":216.39,"rmse":310.88,"r2":0.8764}

## Prescriptive analysis

- Onion is forecasted to soften over the next two weeks, so traders should consider faster release, especially if holding costs and shrinkage risk increase.
- Tomato is forecasted to weaken or remain fragile, so the prescriptive action is to prioritize immediate harvesting, sorting, and dispatch to reduce spoilage losses.
- Current low rainfall conditions suggest transport friction is not the main constraint, so price planning can focus more on demand and arrivals.
- Higher Mumbai fuel prices imply transport cost pressure, so grouping shipments and optimizing route density can help protect margins.
