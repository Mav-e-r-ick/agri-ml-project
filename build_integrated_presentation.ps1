$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataPath = Join-Path $root 'integrated_mandi_output\presentation_data.json'
$outputPath = Join-Path $root 'integrated_mandi_output\integrated_mandi_presentation.pptx'

$payload = Get-Content $dataPath -Raw | ConvertFrom-Json
$summary = $payload.summary
$charts = $payload.charts

$ppLayoutTitle = 1
$ppLayoutText = 2
$ppSaveAsOpenXMLPresentation = 24
$msoFalse = 0
$msoTrue = -1

$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = $msoTrue
$presentation = $ppt.Presentations.Add()

function Add-TitleSlide {
    param($pres, $title, $subtitle)
    $slide = $pres.Slides.Add(1, $ppLayoutTitle)
    $slide.Shapes.Title.TextFrame.TextRange.Text = $title
    $slide.Shapes.Item(2).TextFrame.TextRange.Text = $subtitle
}

function Add-BulletsSlide {
    param($pres, [int]$index, $title, [string[]]$bullets)
    $slide = $pres.Slides.Add($index, $ppLayoutText)
    $slide.Shapes.Title.TextFrame.TextRange.Text = $title
    $text = ($bullets | ForEach-Object { [char]0x2022 + ' ' + $_ }) -join "`r`n"
    $slide.Shapes.Item(2).TextFrame.TextRange.Text = $text
    $slide.Shapes.Item(2).TextFrame.TextRange.Font.Size = 20
}

function Add-ChartSlide {
    param($pres, [int]$index, $title, [string[]]$imagePaths, [string[]]$bullets)
    $slide = $pres.Slides.Add($index, $ppLayoutText)
    $slide.Shapes.Title.TextFrame.TextRange.Text = $title
    $slide.Shapes.Item(2).Delete()
    $y = 80
    foreach ($img in $imagePaths) {
        if (Test-Path $img) {
            $slide.Shapes.AddPicture($img, $msoFalse, $msoTrue, 25, $y, 630, 220) | Out-Null
            $y += 225
        }
    }
    if ($bullets.Count -gt 0) {
        $box = $slide.Shapes.AddTextbox(1, 680, 110, 230, 380)
        $box.TextFrame.TextRange.Text = ($bullets | ForEach-Object { [char]0x2022 + ' ' + $_ }) -join "`r`n"
        $box.TextFrame.TextRange.Font.Size = 18
    }
}

Add-TitleSlide -pres $presentation -title 'Integrated Onion and Tomato Mandi Price Intelligence' -subtitle "Pune district crop prices with nearby weather and Mumbai fuel drivers`r`nGenerated on $(Get-Date -Format 'yyyy-MM-dd')"

Add-BulletsSlide -pres $presentation -index 2 -title 'Data and Modeling Workflow' -bullets @(
    "Daily Pune district onion and tomato mandi prices were aggregated across markets.",
    "Weather features were built from Pune plus nearby districts: Ahmednagar, Nashik, Satara, Kalyan, and Mumbai.",
    "Mumbai petrol and diesel prices were added as logistics cost signals.",
    "Onion used longer lag windows because it is less perishable.",
    "Tomato used shorter lag windows because it is highly perishable.",
    "Models used 80 percent training, 20 percent test, and five fold time series cross validation."
)

Add-ChartSlide -pres $presentation -index 3 -title 'Exploratory Data Analysis' -imagePaths @($charts.combinedTrend, $charts.seasonality) -bullets @(
    "Integrated common dates: $($summary.commonDates)",
    "Study window: $($summary.dateRange.start) to $($summary.dateRange.end)",
    "Both crops show strong seasonality and distinct fluctuation patterns."
)

Add-ChartSlide -pres $presentation -index 4 -title 'Correlation Structure and Key Drivers' -imagePaths @($charts.onionCorr, $charts.tomatoCorr) -bullets @(
    "Heatmaps summarize crop, fuel, and weather correlations.",
    "Ridge regression was used to reduce multicollinearity sensitivity.",
    "Cross commodity effects were included in both crop models."
)

Add-ChartSlide -pres $presentation -index 5 -title 'Onion Predictive Model' -imagePaths @($charts.onionPred) -bullets @(
    "Best lambda: $($summary.onion.bestLambda)",
    "R2: $($summary.onion.metrics.r2)",
    "RMSE: $($summary.onion.metrics.rmse)",
    "Baseline RMSE: $($summary.onion.baseline.rmse)",
    "Onion uses lag 1, 7, 14, 30, and 60 plus rolling windows."
)

Add-ChartSlide -pres $presentation -index 6 -title 'Tomato Predictive Model' -imagePaths @($charts.tomatoPred) -bullets @(
    "Best lambda: $($summary.tomato.bestLambda)",
    "R2: $($summary.tomato.metrics.r2)",
    "RMSE: $($summary.tomato.metrics.rmse)",
    "Baseline RMSE: $($summary.tomato.baseline.rmse)",
    "Tomato uses shorter lags to reflect perishability and fast market response."
)

Add-ChartSlide -pres $presentation -index 7 -title 'Diagnostics and Future Forecast' -imagePaths @($charts.forecast) -bullets @(
    "Forecast horizon: $($summary.forecast.onion[0].date) to $($summary.forecast.onion[-1].date)",
    "Onion forecast softens over the horizon.",
    "Tomato forecast also weakens, indicating urgency in dispatch decisions."
)

Add-BulletsSlide -pres $presentation -index 8 -title 'Prescriptive Analysis and Recommendations' -bullets $summary.prescriptive

$presentation.SaveAs($outputPath, $ppSaveAsOpenXMLPresentation)
$presentation.Close()
$ppt.Quit()

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null

Write-Output "Presentation saved to $outputPath"
