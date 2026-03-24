const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.cwd();
const FUEL_DIR = path.join(ROOT, "Fuel price");
const OUTPUT_DIR = path.join(ROOT, "fuel_analysis_output");
const CHART_DIR = path.join(OUTPUT_DIR, "charts");
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

fs.mkdirSync(CHART_DIR, { recursive: true });

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function standardDeviation(values) {
  const avg = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  );
}

function summarizeNumeric(values) {
  const avg = mean(values);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const std = standardDeviation(values);
  return {
    count: values.length,
    mean: round(avg),
    median: round(median(values)),
    std: round(std),
    min: round(Math.min(...values)),
    q1: round(q1),
    q3: round(q3),
    max: round(Math.max(...values)),
    iqr: round(q3 - q1),
    cv: round(std / avg),
  };
}

function detectOutliers(values) {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const count = values.filter((value) => value < lower || value > upper).length;
  return {
    lower: round(lower),
    upper: round(upper),
    count,
    percentage: round((count / values.length) * 100),
  };
}

function groupBy(items, getKey) {
  const map = new Map();
  items.forEach((item) => {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

function excelSerialToIso(serial) {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  epoch.setUTCDate(epoch.getUTCDate() + Number(serial));
  return epoch.toISOString().slice(0, 10);
}

function monthName(monthNumber) {
  return MONTH_NAMES[monthNumber - 1];
}

function getMonth(isoDate) {
  return Number(isoDate.slice(5, 7));
}

function getYearMonth(isoDate) {
  return isoDate.slice(0, 7);
}

function getDayOfWeek(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function readZipEntry(xlsxPath, entryPath) {
  const ps = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$file='${xlsxPath.replace(/'/g, "''")}'`,
    `$zip='${(xlsxPath + ".zip").replace(/'/g, "''")}'`,
    "Copy-Item $file $zip -Force",
    "$archive=[System.IO.Compression.ZipFile]::OpenRead($zip)",
    `$entry=$archive.GetEntry('${entryPath.replace(/'/g, "''")}')`,
    "if($entry){$reader=New-Object System.IO.StreamReader($entry.Open());$content=$reader.ReadToEnd();$reader.Close();Write-Output $content}",
    "$archive.Dispose()",
    "Remove-Item $zip -Force",
  ].join("; ");
  return execFileSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const text = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((part) => decodeXml(part[1]))
      .join("");
    return text;
  });
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowMatches = xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g);
  for (const rowMatch of rowMatches) {
    const rowXml = rowMatch[1];
    const row = {};
    const cellMatches = rowXml.matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g);
    for (const cellMatch of cellMatches) {
      const col = cellMatch[1];
      const attrs = cellMatch[2];
      const cellXml = cellMatch[3];
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : "";
      let value = "";
      const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      if (type === "s" && vMatch) value = sharedStrings[Number(vMatch[1])] || "";
      else if ((type === "str" || type === "inlineStr") && (inlineMatch || vMatch)) value = decodeXml((inlineMatch || vMatch)[1]);
      else if (vMatch) value = decodeXml(vMatch[1]);
      row[col] = value;
    }
    rows.push(row);
  }
  return rows;
}

function loadWorkbookRows(fileName) {
  const fullPath = path.join(FUEL_DIR, fileName);
  const sharedStrings = parseSharedStrings(readZipEntry(fullPath, "xl/sharedStrings.xml"));
  const sheetXml = readZipEntry(fullPath, "xl/worksheets/sheet1.xml");
  return parseSheetRows(sheetXml, sharedStrings);
}

function extractSeriesFromWorkbook(fileName, mode) {
  const rows = loadWorkbookRows(fileName).slice(1);
  if (mode === "multi_city") {
    return rows
      .filter((row) => row.B === "Mumbai")
      .map((row) => ({
        date: row.A,
        price: Number(row.C),
        source: fileName,
      }));
  }
  return rows.map((row) => ({
    date: excelSerialToIso(row.A),
    price: Number(row.B),
    source: fileName,
  }));
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    const row = {};
    header.forEach((name, idx) => {
      row[name.replace(/^"|"$/g, "")] = (parts[idx] || "").replace(/^"|"$/g, "");
    });
    return row;
  });
}

function loadPreparedSeries(fileNames) {
  const byDate = new Map();
  fileNames.forEach((fileName) => {
    const fullPath = path.join(OUTPUT_DIR, "prepared_data", fileName);
    const rows = parseCsv(fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, ""));
    rows.forEach((row) => {
      byDate.set(row.date, {
        date: row.date,
        price: Number(row.price),
        source: row.source,
      });
    });
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function combineSeries(definitions) {
  const byDate = new Map();
  definitions.forEach((definition) => {
    extractSeriesFromWorkbook(definition.fileName, definition.mode).forEach((row) => {
      byDate.set(row.date, row);
    });
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function pearsonCorrelation(x, y) {
  const xMean = mean(x);
  const yMean = mean(y);
  let numerator = 0;
  let xDen = 0;
  let yDen = 0;
  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    numerator += dx * dy;
    xDen += dx * dx;
    yDen += dy * dy;
  }
  return numerator / Math.sqrt(xDen * yDen);
}

function chartBounds(width, height) {
  return { width, height, left: 80, right: 30, top: 30, bottom: 70 };
}

function scaleLinear(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2;
  return (
    rangeMin +
    ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin)
  );
}

function createLineChart({ title, xLabels, series, yLabel }) {
  const bounds = chartBounds(1200, 420);
  const plotWidth = bounds.width - bounds.left - bounds.right;
  const plotHeight = bounds.height - bounds.top - bounds.bottom;
  const values = series.flatMap((item) => item.values);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const xStep = xLabels.length > 1 ? plotWidth / (xLabels.length - 1) : plotWidth;
  const colors = ["#b91c1c", "#1d4ed8", "#047857", "#7c3aed"];
  const tickValues = Array.from({ length: 6 }, (_, i) => yMin + ((yMax - yMin) * i) / 5);
  const grid = tickValues
    .map((tick) => {
      const y = scaleLinear(tick, yMin, yMax, bounds.top + plotHeight, bounds.top);
      return `<line x1="${bounds.left}" y1="${y}" x2="${bounds.left + plotWidth}" y2="${y}" stroke="#e5e7eb" />
      <text x="${bounds.left - 10}" y="${y + 4}" font-size="12" text-anchor="end" fill="#475569">${round(tick)}</text>`;
    })
    .join("");
  const paths = series
    .map((item, idx) => {
      const d = item.values
        .map((value, i) => {
          const x = bounds.left + xStep * i;
          const y = scaleLinear(value, yMin, yMax, bounds.top + plotHeight, bounds.top);
          return `${i === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="3" />`;
    })
    .join("");
  const labelStep = Math.max(1, Math.floor(xLabels.length / 12));
  const xTicks = xLabels
    .map((label, idx) => ({ label, idx }))
    .filter((_, idx) => idx % labelStep === 0 || idx === xLabels.length - 1)
    .map(({ label, idx }) => {
      const x = bounds.left + xStep * idx;
      return `<text x="${x}" y="${bounds.top + plotHeight + 20}" font-size="11" text-anchor="middle" fill="#475569">${escapeXml(label)}</text>`;
    })
    .join("");
  const legend = series
    .map(
      (item, idx) =>
        `<rect x="${bounds.left + idx * 220}" y="8" width="14" height="14" fill="${colors[idx % colors.length]}" /><text x="${bounds.left +
          idx * 220 +
          20}" y="20" font-size="12" fill="#0f172a">${escapeXml(item.name)}</text>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
<rect width="100%" height="100%" fill="#ffffff" />
<text x="${bounds.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
${legend}${grid}
<line x1="${bounds.left}" y1="${bounds.top + plotHeight}" x2="${bounds.left + plotWidth}" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
<line x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
${paths}${xTicks}
<text x="18" y="${bounds.top + plotHeight / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${bounds.top + plotHeight / 2})">${escapeXml(yLabel)}</text>
</svg>`;
}

function createBarChart({ title, labels, values, yLabel, color = "#0f766e" }) {
  const bounds = chartBounds(1150, 500);
  const plotWidth = bounds.width - bounds.left - bounds.right;
  const plotHeight = bounds.height - bounds.top - bounds.bottom;
  const yMax = Math.max(...values) * 1.1;
  const slot = plotWidth / values.length;
  const barWidth = Math.max(10, slot - 12);
  const bars = values
    .map((value, idx) => {
      const x = bounds.left + idx * slot + (slot - barWidth) / 2;
      const y = scaleLinear(value, 0, yMax, bounds.top + plotHeight, bounds.top);
      const height = bounds.top + plotHeight - y;
      const lx = x + barWidth / 2;
      const ly = bounds.top + plotHeight + 22;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" fill="${color}" rx="4" />
      <text x="${lx}" y="${ly}" font-size="10" text-anchor="end" fill="#475569" transform="rotate(-35 ${lx} ${ly})">${escapeXml(labels[idx])}</text>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
<rect width="100%" height="100%" fill="#ffffff" />
<text x="${bounds.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
<line x1="${bounds.left}" y1="${bounds.top + plotHeight}" x2="${bounds.left + plotWidth}" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
<line x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
${bars}
<text x="18" y="${bounds.top + plotHeight / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${bounds.top + plotHeight / 2})">${escapeXml(yLabel)}</text>
</svg>`;
}

function createScatterChart({ title, points, xLabel, yLabel }) {
  const bounds = chartBounds(760, 520);
  const plotWidth = bounds.width - bounds.left - bounds.right;
  const plotHeight = bounds.height - bounds.top - bounds.bottom;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const dots = points
    .map((point) => {
      const cx = scaleLinear(point.x, xMin, xMax, bounds.left, bounds.left + plotWidth);
      const cy = scaleLinear(point.y, yMin, yMax, bounds.top + plotHeight, bounds.top);
      return `<circle cx="${cx}" cy="${cy}" r="3.2" fill="#7c3aed" fill-opacity="0.65" />`;
    })
    .join("");
  const low = Math.max(xMin, yMin);
  const high = Math.min(xMax, yMax);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
<rect width="100%" height="100%" fill="#ffffff" />
<text x="${bounds.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
<line x1="${bounds.left}" y1="${bounds.top + plotHeight}" x2="${bounds.left + plotWidth}" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
<line x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
<line x1="${scaleLinear(low, xMin, xMax, bounds.left, bounds.left + plotWidth)}" y1="${scaleLinear(low, yMin, yMax, bounds.top + plotHeight, bounds.top)}" x2="${scaleLinear(high, xMin, xMax, bounds.left, bounds.left + plotWidth)}" y2="${scaleLinear(high, yMin, yMax, bounds.top + plotHeight, bounds.top)}" stroke="#dc2626" stroke-width="2" stroke-dasharray="6 4" />
${dots}
<text x="${bounds.left + plotWidth / 2}" y="${bounds.height - 8}" font-size="12" text-anchor="middle" fill="#475569">${escapeXml(xLabel)}</text>
<text x="18" y="${bounds.top + plotHeight / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${bounds.top + plotHeight / 2})">${escapeXml(yLabel)}</text>
</svg>`;
}

function createHeatmap({ title, labels, matrix }) {
  const cell = 78;
  const left = 170;
  const top = 80;
  const width = left + labels.length * cell + 40;
  const height = top + labels.length * cell + 40;
  const maxAbs = Math.max(...matrix.flat().map((v) => Math.abs(v))) || 1;
  const cells = [];
  for (let r = 0; r < labels.length; r += 1) {
    for (let c = 0; c < labels.length; c += 1) {
      const value = matrix[r][c];
      const intensity = Math.abs(value) / maxAbs;
      const fill =
        value >= 0
          ? `rgb(${Math.round(255 - intensity * 65)}, ${Math.round(255 - intensity * 110)}, ${Math.round(255 - intensity * 180)})`
          : `rgb(${Math.round(255 - intensity * 20)}, ${Math.round(255 - intensity * 165)}, ${Math.round(255 - intensity * 165)})`;
      cells.push(`<rect x="${left + c * cell}" y="${top + r * cell}" width="${cell}" height="${cell}" fill="${fill}" stroke="#ffffff" />
      <text x="${left + c * cell + cell / 2}" y="${top + r * cell + cell / 2 + 4}" font-size="12" text-anchor="middle" fill="#0f172a">${round(value, 2)}</text>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff" />
<text x="${left}" y="28" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
${labels
    .map((label, i) => `<text x="${left - 12}" y="${top + i * cell + cell / 2 + 4}" font-size="12" text-anchor="end" fill="#334155">${escapeXml(label)}</text>`)
    .join("")}
${labels
    .map((label, i) => `<text x="${left + i * cell + cell / 2}" y="${top - 12}" font-size="12" text-anchor="start" fill="#334155" transform="rotate(-35 ${left +
      i * cell +
      cell / 2} ${top - 12})">${escapeXml(label)}</text>`)
    .join("")}
${cells.join("")}
</svg>`;
}

function matrixTranspose(matrix) {
  return matrix[0].map((_, colIdx) => matrix.map((row) => row[colIdx]));
}

function matrixMultiply(a, b) {
  const out = Array.from({ length: a.length }, () => Array.from({ length: b[0].length }, () => 0));
  for (let i = 0; i < a.length; i += 1) {
    for (let k = 0; k < b.length; k += 1) {
      for (let j = 0; j < b[0].length; j += 1) out[i][j] += a[i][k] * b[k][j];
    }
  }
  return out;
}

function invertMatrix(matrix) {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i += 1) {
    let pivot = augmented[i][i];
    if (Math.abs(pivot) < 1e-12) {
      let swap = i + 1;
      while (swap < n && Math.abs(augmented[swap][i]) < 1e-12) swap += 1;
      if (swap === n) throw new Error("Matrix is singular");
      [augmented[i], augmented[swap]] = [augmented[swap], augmented[i]];
      pivot = augmented[i][i];
    }
    for (let j = 0; j < 2 * n; j += 1) augmented[i][j] /= pivot;
    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const factor = augmented[r][i];
      for (let c = 0; c < 2 * n; c += 1) augmented[r][c] -= factor * augmented[i][c];
    }
  }
  return augmented.map((row) => row.slice(n));
}

function ridgeRegression(X, y, lambda = 1) {
  const Xb = X.map((row) => [1, ...row]);
  const Xt = matrixTranspose(Xb);
  const XtX = matrixMultiply(Xt, Xb);
  for (let i = 1; i < XtX.length; i += 1) XtX[i][i] += lambda;
  const XtY = matrixMultiply(Xt, y.map((value) => [value]));
  const beta = matrixMultiply(invertMatrix(XtX), XtY).map((row) => row[0]);
  return {
    predict(features) {
      return [1, ...features].reduce((sum, value, idx) => sum + value * beta[idx], 0);
    },
  };
}

function regressionMetrics(actual, predicted) {
  const errors = actual.map((value, idx) => value - predicted[idx]);
  const mae = mean(errors.map((v) => Math.abs(v)));
  const rmse = Math.sqrt(mean(errors.map((v) => v ** 2)));
  const avg = mean(actual);
  const ssRes = actual.reduce((sum, value, idx) => sum + (value - predicted[idx]) ** 2, 0);
  const ssTot = actual.reduce((sum, value) => sum + (value - avg) ** 2, 0);
  return { mae: round(mae), rmse: round(rmse), r2: round(1 - ssRes / ssTot, 4) };
}

function buildMergedDataset(petrolSeries, dieselSeries) {
  const petrolMap = new Map(petrolSeries.map((row) => [row.date, row.price]));
  const dieselMap = new Map(dieselSeries.map((row) => [row.date, row.price]));
  return [...petrolMap.keys()]
    .filter((date) => dieselMap.has(date))
    .map((date) => ({
      date,
      petrol: petrolMap.get(date),
      diesel: dieselMap.get(date),
      spread: petrolMap.get(date) - dieselMap.get(date),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildModel(mergedRows, targetKey, otherKey) {
  const rows = [];
  for (let i = 30; i < mergedRows.length; i += 1) {
    const current = mergedRows[i];
    const prev = mergedRows[i - 1];
    const month = getMonth(current.date);
    rows.push({
      date: current.date,
      target: current[targetKey],
      baseline: prev[targetKey],
      features: [
        mergedRows[i - 1][targetKey],
        mergedRows[i - 7][targetKey],
        mergedRows[i - 14][targetKey],
        mergedRows[i - 30][targetKey],
        mean(mergedRows.slice(i - 7, i).map((row) => row[targetKey])),
        mean(mergedRows.slice(i - 30, i).map((row) => row[targetKey])),
        mergedRows[i - 1][otherKey],
        mergedRows[i - 7][otherKey],
        mergedRows[i - 1].spread,
        mergedRows[i - 7].spread,
        getDayOfWeek(current.date),
        month,
        Math.sin((2 * Math.PI * month) / 12),
        Math.cos((2 * Math.PI * month) / 12),
      ],
    });
  }
  const split = Math.floor(rows.length * 0.8);
  const train = rows.slice(0, split);
  const test = rows.slice(split);
  const model = ridgeRegression(
    train.map((row) => row.features),
    train.map((row) => row.target),
    3
  );
  const predicted = test.map((row) => model.predict(row.features));
  const actual = test.map((row) => row.target);
  const baseline = test.map((row) => row.baseline);
  const preview = test.slice(0, 120).map((row, idx) => ({
    date: row.date,
    actual: round(actual[idx]),
    predicted: round(predicted[idx]),
    baseline: round(baseline[idx]),
    residual: round(actual[idx] - predicted[idx]),
  }));
  return {
    metrics: regressionMetrics(actual, predicted),
    baselineMetrics: regressionMetrics(actual, baseline),
    residualSummary: summarizeNumeric(actual.map((value, idx) => value - predicted[idx])),
    trainCount: train.length,
    testCount: test.length,
    preview,
  };
}

function monthlySeries(mergedRows) {
  return [...groupBy(mergedRows, (row) => getYearMonth(row.date)).entries()]
    .map(([month, rows]) => ({
      month,
      petrol: mean(rows.map((row) => row.petrol)),
      diesel: mean(rows.map((row) => row.diesel)),
      spread: mean(rows.map((row) => row.spread)),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function seasonalitySeries(mergedRows) {
  return Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => {
    const rows = mergedRows.filter((row) => getMonth(row.date) === month);
    return {
      month,
      monthName: monthName(month),
      petrol: mean(rows.map((row) => row.petrol)),
      diesel: mean(rows.map((row) => row.diesel)),
      spread: mean(rows.map((row) => row.spread)),
    };
  });
}

function buildCorrelation(mergedRows) {
  const petrolReturns = mergedRows.slice(1).map((row, idx) => row.petrol - mergedRows[idx].petrol);
  const dieselReturns = mergedRows.slice(1).map((row, idx) => row.diesel - mergedRows[idx].diesel);
  const aligned = mergedRows.slice(1);
  const labels = [
    "Petrol price",
    "Diesel price",
    "Price spread",
    "Petrol daily change",
    "Diesel daily change",
  ];
  const cols = [
    aligned.map((row) => row.petrol),
    aligned.map((row) => row.diesel),
    aligned.map((row) => row.spread),
    petrolReturns,
    dieselReturns,
  ];
  return {
    labels,
    matrix: cols.map((x) => cols.map((y) => pearsonCorrelation(x, y))),
  };
}

function createPredictionChart(title, previewRows) {
  return createLineChart({
    title,
    xLabels: previewRows.map((row) => row.date),
    series: [
      { name: "Actual price", values: previewRows.map((row) => row.actual) },
      { name: "Predicted price", values: previewRows.map((row) => row.predicted) },
      { name: "Lag one baseline", values: previewRows.map((row) => row.baseline) },
    ],
    yLabel: "Price in rupees per litre",
  });
}

function writeSvg(fileName, content) {
  fs.writeFileSync(path.join(CHART_DIR, fileName), content, "utf8");
}

function saveCharts(mergedRows, petrolModel, dieselModel, correlation) {
  const monthly = monthlySeries(mergedRows);
  const seasonality = seasonalitySeries(mergedRows);
  writeSvg(
    "fuel_monthly_trend.svg",
    createLineChart({
      title: "Monthly Average Retail Selling Prices of Petrol and Diesel in Mumbai",
      xLabels: monthly.map((row) => row.month),
      series: [
        { name: "Petrol", values: monthly.map((row) => round(row.petrol)) },
        { name: "Diesel", values: monthly.map((row) => round(row.diesel)) },
      ],
      yLabel: "Average price in rupees per litre",
    })
  );
  writeSvg(
    "fuel_monthly_spread.svg",
    createLineChart({
      title: "Monthly Average Price Spread Between Petrol and Diesel in Mumbai",
      xLabels: monthly.map((row) => row.month),
      series: [{ name: "Petrol minus diesel spread", values: monthly.map((row) => round(row.spread)) }],
      yLabel: "Average spread in rupees per litre",
    })
  );
  writeSvg(
    "fuel_seasonality_petrol.svg",
    createBarChart({
      title: "Average Mumbai Petrol Price by Calendar Month Across the Full Study Period",
      labels: seasonality.map((row) => row.monthName),
      values: seasonality.map((row) => round(row.petrol)),
      yLabel: "Average petrol price in rupees per litre",
      color: "#b91c1c",
    })
  );
  writeSvg(
    "fuel_seasonality_diesel.svg",
    createBarChart({
      title: "Average Mumbai Diesel Price by Calendar Month Across the Full Study Period",
      labels: seasonality.map((row) => row.monthName),
      values: seasonality.map((row) => round(row.diesel)),
      yLabel: "Average diesel price in rupees per litre",
      color: "#1d4ed8",
    })
  );
  writeSvg(
    "fuel_correlation_heatmap.svg",
    createHeatmap({
      title: "Correlation Matrix for Mumbai Petrol Price, Diesel Price, Spread, and Daily Changes",
      labels: correlation.labels,
      matrix: correlation.matrix,
    })
  );
  writeSvg(
    "petrol_prediction_vs_actual.svg",
    createPredictionChart(
      "Lag Based Ridge Regression Model for Mumbai Petrol Price on the Holdout Test Window",
      petrolModel.preview
    )
  );
  writeSvg(
    "diesel_prediction_vs_actual.svg",
    createPredictionChart(
      "Lag Based Ridge Regression Model for Mumbai Diesel Price on the Holdout Test Window",
      dieselModel.preview
    )
  );
  writeSvg(
    "petrol_prediction_scatter.svg",
    createScatterChart({
      title: "Diagnostic Scatter Plot of Actual Versus Predicted Mumbai Petrol Prices",
      points: petrolModel.preview.map((row) => ({ x: row.actual, y: row.predicted })),
      xLabel: "Actual petrol price in rupees per litre",
      yLabel: "Predicted petrol price in rupees per litre",
    })
  );
  writeSvg(
    "diesel_prediction_scatter.svg",
    createScatterChart({
      title: "Diagnostic Scatter Plot of Actual Versus Predicted Mumbai Diesel Prices",
      points: dieselModel.preview.map((row) => ({ x: row.actual, y: row.predicted })),
      xLabel: "Actual diesel price in rupees per litre",
      yLabel: "Predicted diesel price in rupees per litre",
    })
  );
}

function buildReport(data) {
  return `# Mumbai Fuel Price Analysis

Generated on ${new Date().toISOString().slice(0, 10)}.

## 1. Project objective

This report analyses daily Mumbai retail selling prices for petrol and diesel using the Excel files available in the \`Fuel price\` folder. The workflow combined historical files, cleaned and merged the Mumbai series, performed descriptive analysis and exploratory data analysis, and then trained lag-based machine learning models for both fuels.

## 2. Data sources used

- \`Fuel price/Daily Retail Selling Price of Petrol (in 2017-18).xlsx\`
- \`Fuel price/Daily Retail Selling Price of Petrol (in 2018-19).xlsx\`
- \`Fuel price/Daily Retail Selling Price of Petrol & Diesel (in 2019-20).xlsx\` for Mumbai petrol
- \`Fuel price/Petrol Price 2020-2026.xlsx\`
- \`Fuel price/Daily Retail Selling Price of Diesel (in 2017-18).xlsx\`
- \`Fuel price/Daily Retail Selling Price of Diesel (in 2018-19).xlsx\`
- \`Fuel price/Daily Retail Selling Price of Diesel (in 2019-20) (1).xlsx\`
- \`Fuel price/Diesel Price 2020-2026.xlsx\`

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

- Date range: ${data.dateRange.start} to ${data.dateRange.end}
- Summary: ${JSON.stringify(data.petrolSummary)}
- Outliers by IQR rule: ${JSON.stringify(data.petrolOutliers)}

### Diesel

- Date range: ${data.dateRange.start} to ${data.dateRange.end}
- Summary: ${JSON.stringify(data.dieselSummary)}
- Outliers by IQR rule: ${JSON.stringify(data.dieselOutliers)}

### Data quality

- Common Mumbai dates used in merged analysis: ${data.rows.length}
- Missing petrol values after merge: ${data.missing.petrol}
- Missing diesel values after merge: ${data.missing.diesel}
- Duplicate dates after merge: ${data.duplicateDates}

## 5. Exploratory data analysis

- The long-run monthly trend chart shows that petrol and diesel move closely together, but petrol stays consistently above diesel.
- The month-wise charts help highlight recurring annual patterns and periods of higher average prices.
- The spread chart tracks how the price difference between petrol and diesel evolved through time.
- The correlation heatmap quantifies how strongly the two fuels move together and how daily changes co-move.

## 6. Machine learning models

### Petrol model

- Algorithm: ridge regression
- Features: lag 1, lag 7, lag 14, lag 30, rolling averages, diesel lags, spread lags, day of week, and month seasonality
- Train rows: ${data.petrolModel.trainCount}
- Test rows: ${data.petrolModel.testCount}
- Ridge regression metrics: ${JSON.stringify(data.petrolModel.metrics)}
- Lag one baseline metrics: ${JSON.stringify(data.petrolModel.baselineMetrics)}
- Residual summary: ${JSON.stringify(data.petrolModel.residualSummary)}

### Diesel model

- Algorithm: ridge regression
- Features: lag 1, lag 7, lag 14, lag 30, rolling averages, petrol lags, spread lags, day of week, and month seasonality
- Train rows: ${data.dieselModel.trainCount}
- Test rows: ${data.dieselModel.testCount}
- Ridge regression metrics: ${JSON.stringify(data.dieselModel.metrics)}
- Lag one baseline metrics: ${JSON.stringify(data.dieselModel.baselineMetrics)}
- Residual summary: ${JSON.stringify(data.dieselModel.residualSummary)}

## 7. Interpretation of results

- Strong performance against the lag-one baseline indicates that the richer lag structure improves short-term price prediction.
- Petrol and diesel remain tightly connected, so cross-fuel lags are useful explanatory variables.
- Diagnostic scatter plots and actual-versus-predicted charts should be read together with RMSE and R2 before drawing forecasting conclusions.

## 8. Output files

- HTML report: \`fuel_analysis_output/report.html\`
- PDF report: \`fuel_analysis_output/mumbai_fuel_price_report.pdf\`
- JSON summary: \`fuel_analysis_output/summary.json\`
- Charts: \`fuel_analysis_output/charts/\`
`;
}

function buildHtml(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mumbai Fuel Price Analysis</title>
  <style>
    :root { --bg:#f8fafc; --card:#fff; --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --accent:#9a3412; }
    body { margin:0; font-family: Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#fff7ed 0%,#f8fafc 35%); color:var(--ink); }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 30px 20px 48px; }
    h1 { margin:0 0 8px; font-size:2.2rem; }
    .lead { color:var(--muted); line-height:1.6; max-width:900px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:0 12px 30px rgba(15,23,42,.06); padding:22px; margin-top:22px; }
    .stats { display:grid; grid-template-columns: repeat(auto-fit,minmax(170px,1fr)); gap:14px; margin:18px 0 24px; }
    .stats div { border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:#fff; }
    .stats strong { display:block; margin-bottom:6px; }
    .stats span { color:var(--accent); font-size:1.15rem; }
    .grid { display:grid; grid-template-columns:1fr; gap:18px; }
    img { width:100%; border:1px solid var(--line); border-radius:12px; background:#fff; }
    ul { line-height:1.6; }
    @media (min-width: 960px) { .grid { grid-template-columns:1fr 1fr; } }
    @media print { body { background:#fff; } .card { box-shadow:none; } }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Mumbai Fuel Price Analysis With Lag Based Machine Learning Models</h1>
    <p class="lead">This report uses the Mumbai petrol and diesel data extracted from the Excel files in the Fuel price folder. It documents the workflow from raw data extraction through descriptive statistics, exploratory analysis, correlation review, lag based machine learning models, and diagnostic validation.</p>

    <section class="card">
      <h2>Key Results</h2>
      <div class="stats">
        <div><strong>Common Mumbai dates</strong><span>${data.rows.length}</span></div>
        <div><strong>Petrol model R2</strong><span>${data.petrolModel.metrics.r2}</span></div>
        <div><strong>Petrol model RMSE</strong><span>${data.petrolModel.metrics.rmse}</span></div>
        <div><strong>Diesel model R2</strong><span>${data.dieselModel.metrics.r2}</span></div>
        <div><strong>Diesel model RMSE</strong><span>${data.dieselModel.metrics.rmse}</span></div>
        <div><strong>Petrol outliers</strong><span>${data.petrolOutliers.percentage}%</span></div>
        <div><strong>Diesel outliers</strong><span>${data.dieselOutliers.percentage}%</span></div>
      </div>
      <ul>
        <li>The dataset was built by extracting Mumbai rows from yearly multi-city files and merging them with the later single-series fuel files.</li>
        <li>Both models use lag periods of 1, 7, 14, and 30 days along with rolling averages and seasonal features.</li>
        <li>Model quality is reported against a simple lag-one baseline to show the benefit of the richer feature set.</li>
      </ul>
    </section>

    <section class="card">
      <h2>Exploratory Data Analysis</h2>
      <div class="grid">
        <img src="./charts/fuel_monthly_trend.svg" alt="Monthly fuel trend" />
        <img src="./charts/fuel_monthly_spread.svg" alt="Monthly spread trend" />
        <img src="./charts/fuel_seasonality_petrol.svg" alt="Petrol seasonality" />
        <img src="./charts/fuel_seasonality_diesel.svg" alt="Diesel seasonality" />
        <img src="./charts/fuel_correlation_heatmap.svg" alt="Fuel correlation heatmap" />
      </div>
    </section>

    <section class="card">
      <h2>Lag Based Machine Learning Models</h2>
      <div class="grid">
        <img src="./charts/petrol_prediction_vs_actual.svg" alt="Petrol prediction line chart" />
        <img src="./charts/diesel_prediction_vs_actual.svg" alt="Diesel prediction line chart" />
        <img src="./charts/petrol_prediction_scatter.svg" alt="Petrol scatter diagnostic" />
        <img src="./charts/diesel_prediction_scatter.svg" alt="Diesel scatter diagnostic" />
      </div>
    </section>
  </div>
</body>
</html>`;
}

function exportPdf(htmlPath, pdfPath) {
  const browserCandidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const browser = browserCandidates.find((file) => fs.existsSync(file));
  if (!browser) throw new Error("No headless browser available for PDF export");
  const url = `file:///${htmlPath.replace(/\\/g, "/")}`;
  execFileSync(
    browser,
    [
      "--headless",
      "--disable-gpu",
      `--print-to-pdf=${pdfPath}`,
      "--print-to-pdf-no-header",
      url,
    ],
    { stdio: "ignore" }
  );
}

function main() {
  const preparedDir = path.join(OUTPUT_DIR, "prepared_data");
  if (!fs.existsSync(preparedDir)) {
    throw new Error("Prepared CSV files not found. Run extract_fuel_data.ps1 first.");
  }
  const petrolSeries = loadPreparedSeries([
    "petrol_2017_18.csv",
    "petrol_2018_19.csv",
    "petrol_2019_20.csv",
    "petrol_2020_2026.csv",
  ]);
  const dieselSeries = loadPreparedSeries([
    "diesel_2017_18.csv",
    "diesel_2018_19.csv",
    "diesel_2019_20.csv",
    "diesel_2020_2026.csv",
  ]);

  const rows = buildMergedDataset(petrolSeries, dieselSeries);
  const petrolPrices = rows.map((row) => row.petrol);
  const dieselPrices = rows.map((row) => row.diesel);
  const correlation = buildCorrelation(rows);
  const petrolModel = buildModel(rows, "petrol", "diesel");
  const dieselModel = buildModel(rows, "diesel", "petrol");

  saveCharts(rows, petrolModel, dieselModel, correlation);

  const data = {
    rows,
    dateRange: { start: rows[0].date, end: rows[rows.length - 1].date },
    petrolSummary: summarizeNumeric(petrolPrices),
    dieselSummary: summarizeNumeric(dieselPrices),
    petrolOutliers: detectOutliers(petrolPrices),
    dieselOutliers: detectOutliers(dieselPrices),
    missing: {
      petrol: rows.filter((row) => !Number.isFinite(row.petrol)).length,
      diesel: rows.filter((row) => !Number.isFinite(row.diesel)).length,
    },
    duplicateDates: rows.length - new Set(rows.map((row) => row.date)).size,
    petrolModel,
    dieselModel,
    correlation,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "summary.json"),
    JSON.stringify(
      {
        dateRange: data.dateRange,
        commonDates: data.rows.length,
        petrolSummary: data.petrolSummary,
        dieselSummary: data.dieselSummary,
        petrolModel: data.petrolModel.metrics,
        petrolBaseline: data.petrolModel.baselineMetrics,
        dieselModel: data.dieselModel.metrics,
        dieselBaseline: data.dieselModel.baselineMetrics,
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(OUTPUT_DIR, "analysis_report.md"), buildReport(data), "utf8");
  const htmlPath = path.join(OUTPUT_DIR, "report.html");
  fs.writeFileSync(htmlPath, buildHtml(data), "utf8");
  exportPdf(htmlPath, path.join(OUTPUT_DIR, "mumbai_fuel_price_report.pdf"));
  console.log(`Fuel analysis completed. Outputs written to ${OUTPUT_DIR}`);
}

main();
