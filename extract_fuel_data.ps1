$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$fuelDir = Join-Path $root 'Fuel price'
$outDir = Join-Path $root 'fuel_analysis_output\prepared_data'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Get-ZipEntryText {
    param(
        [string]$XlsxPath,
        [string]$EntryName
    )
    $zipPath = "$XlsxPath.zip"
    Copy-Item $XlsxPath $zipPath -Force
    try {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        $entry = $archive.GetEntry($EntryName)
        if (-not $entry) { return '' }
        $reader = New-Object System.IO.StreamReader($entry.Open())
        try { return $reader.ReadToEnd() } finally { $reader.Close() }
    }
    finally {
        if ($archive) { $archive.Dispose() }
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-SharedStrings {
    param([string]$Xml)
    $strings = @()
    if (-not $Xml) { return $strings }
    $matches = [regex]::Matches($Xml, '<si>([\s\S]*?)</si>')
    foreach ($m in $matches) {
        $textMatches = [regex]::Matches($m.Groups[1].Value, '<t[^>]*>([\s\S]*?)</t>')
        $text = ($textMatches | ForEach-Object { $_.Groups[1].Value }) -join ''
        $strings += $text.Replace('&amp;','&').Replace('&lt;','<').Replace('&gt;','>').Replace('&quot;','"').Replace('&#39;',"'")
    }
    return $strings
}

function Get-SheetRows {
    param(
        [string]$SheetXml,
        [string[]]$SharedStrings
    )
    $rows = @()
    $rowMatches = [regex]::Matches($SheetXml, '<row[^>]*>([\s\S]*?)</row>')
    foreach ($rowMatch in $rowMatches) {
        $rowXml = $rowMatch.Groups[1].Value
        $row = [ordered]@{}
        $cellMatches = [regex]::Matches($rowXml, '<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)</c>')
        foreach ($cellMatch in $cellMatches) {
            $col = $cellMatch.Groups[1].Value
            $attrs = $cellMatch.Groups[2].Value
            $cellXml = $cellMatch.Groups[3].Value
            $type = ''
            if ($attrs -match 't="([^"]+)"') { $type = $matches[1] }
            $value = ''
            if ($cellXml -match '<v>([\s\S]*?)</v>') {
                $value = $matches[1]
            } elseif ($cellXml -match '<t[^>]*>([\s\S]*?)</t>') {
                $value = $matches[1]
            }
            if ($type -eq 's' -and $value -match '^\d+$') {
                $value = $SharedStrings[[int]$value]
            }
            $row[$col] = $value
        }
        $rows += [pscustomobject]$row
    }
    return $rows
}

function Convert-ExcelSerialToDate {
    param([double]$Serial)
    return ([datetime]'1899-12-30').AddDays($Serial).ToString('yyyy-MM-dd')
}

function Export-Series {
    param(
        [string]$FileName,
        [string]$Mode,
        [string]$OutCsv
    )
    $path = Join-Path $fuelDir $FileName
    $shared = Get-SharedStrings (Get-ZipEntryText -XlsxPath $path -EntryName 'xl/sharedStrings.xml')
    $sheet = Get-ZipEntryText -XlsxPath $path -EntryName 'xl/worksheets/sheet1.xml'
    $rows = Get-SheetRows -SheetXml $sheet -SharedStrings $shared
    $data = foreach ($row in $rows | Select-Object -Skip 1) {
        if ($Mode -eq 'multi_city') {
            if ($row.B -eq 'Mumbai') {
                [pscustomobject]@{
                    date = $row.A
                    price = [double]$row.C
                    source = $FileName
                }
            }
        } else {
            [pscustomobject]@{
                date = Convert-ExcelSerialToDate([double]$row.A)
                price = [double]$row.B
                source = $FileName
            }
        }
    }
    $data | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $OutCsv
}

Export-Series -FileName 'Daily Retail Selling Price of Petrol (in 2017-18).xlsx' -Mode 'multi_city' -OutCsv (Join-Path $outDir 'petrol_2017_18.csv')
Export-Series -FileName 'Daily Retail Selling Price of Petrol (in 2018-19).xlsx' -Mode 'multi_city' -OutCsv (Join-Path $outDir 'petrol_2018_19.csv')
Export-Series -FileName 'Daily Retail Selling Price of Petrol & Diesel (in 2019-20).xlsx' -Mode 'multi_city' -OutCsv (Join-Path $outDir 'petrol_2019_20.csv')
Export-Series -FileName 'Petrol Price 2020-2026.xlsx' -Mode 'single_series' -OutCsv (Join-Path $outDir 'petrol_2020_2026.csv')
Export-Series -FileName 'Daily Retail Selling Price of Diesel (in 2017-18).xlsx' -Mode 'multi_city' -OutCsv (Join-Path $outDir 'diesel_2017_18.csv')
Export-Series -FileName 'Daily Retail Selling Price of Diesel (in 2018-19).xlsx' -Mode 'multi_city' -OutCsv (Join-Path $outDir 'diesel_2018_19.csv')
Export-Series -FileName 'Daily Retail Selling Price of Diesel (in 2019-20) (1).xlsx' -Mode 'multi_city' -OutCsv (Join-Path $outDir 'diesel_2019_20.csv')
Export-Series -FileName 'Diesel Price 2020-2026.xlsx' -Mode 'single_series' -OutCsv (Join-Path $outDir 'diesel_2020_2026.csv')

Write-Output "Prepared fuel CSV files written to $outDir"
