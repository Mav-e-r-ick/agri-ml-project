const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "Daily price market");
const WEATHER_DIR = path.join(ROOT, "Weather");
const OUTPUT_DIR = path.join(ROOT, "analysis_output");
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

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(CHART_DIR, { recursive: true });

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((name, idx) => {
      row[name] = (cols[idx] || "").trim();
    });
    return row;
  });
}

function parseWeatherCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerIndex = lines.findIndex((line) => line.startsWith("YEAR,DOY,"));
  if (headerIndex === -1) {
    throw new Error("Weather data header not found");
  }
  return parseCsv(lines.slice(headerIndex).join("\n"));
}

function dmyToIso(value) {
  const [dd, mm, yyyy] = value.split("-");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function isoFromYearDoy(year, doy) {
  const date = new Date(Date.UTC(Number(year), 0, 1));
  date.setUTCDate(date.getUTCDate() + Number(doy) - 1);
  return date.toISOString().slice(0, 10);
}

function toNumber(value) {
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function standardDeviation(values) {
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function groupBy(items, getKey) {
  const map = new Map();
  items.forEach((item) => {
    const key = getKey(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  });
  return map;
}

function summarizeNumeric(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  const avg = mean(clean);
  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  const std = standardDeviation(clean);
  return {
    count: clean.length,
    mean: round(avg),
    median: round(median(clean)),
    std: round(std),
    min: round(Math.min(...clean)),
    q1: round(q1),
    q3: round(q3),
    max: round(Math.max(...clean)),
    iqr: round(q3 - q1),
    cv: round(std / avg),
  };
}

function getMonth(isoDate) {
  return Number(isoDate.slice(5, 7));
}

function monthName(monthNumber) {
  return MONTH_NAMES[monthNumber - 1];
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

function writeSvg(filePath, svg) {
  fs.writeFileSync(filePath, svg, "utf8");
}

function chartBounds(width, height) {
  return { width, height, left: 70, right: 30, top: 30, bottom: 55 };
}

function scaleLinear(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMax === domainMin) {
    return (rangeMin + rangeMax) / 2;
  }
  const ratio = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + ratio * (rangeMax - rangeMin);
}

function createLineChart({ title, xLabels, series, yLabel }) {
  const bounds = chartBounds(1200, 420);
  const plotWidth = bounds.width - bounds.left - bounds.right;
  const plotHeight = bounds.height - bounds.top - bounds.bottom;
  const allValues = series.flatMap((item) => item.values);
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const xStep = xLabels.length > 1 ? plotWidth / (xLabels.length - 1) : 0;
  const yTicks = 5;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) =>
    yMin + ((yMax - yMin) * i) / yTicks
  );
  const colors = ["#0f766e", "#dc2626", "#2563eb", "#7c3aed"];

  const grid = tickValues
    .map((tick) => {
      const y = scaleLinear(
        tick,
        yMin,
        yMax,
        bounds.top + plotHeight,
        bounds.top
      );
      return `<line x1="${bounds.left}" y1="${y}" x2="${
        bounds.left + plotWidth
      }" y2="${y}" stroke="#e5e7eb" stroke-width="1" />
      <text x="${bounds.left - 10}" y="${y + 4}" font-size="12" text-anchor="end" fill="#475569">${round(
        tick
      )}</text>`;
    })
    .join("\n");

  const paths = series
    .map((item, idx) => {
      const d = item.values
        .map((value, xIndex) => {
          const x = bounds.left + xStep * xIndex;
          const y = scaleLinear(
            value,
            yMin,
            yMax,
            bounds.top + plotHeight,
            bounds.top
          );
          return `${xIndex === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="3" />`;
    })
    .join("\n");

  const xTickStep = Math.max(1, Math.floor(xLabels.length / 12));
  const xTicks = xLabels
    .map((label, idx) => ({ label, idx }))
    .filter((_, idx) => idx % xTickStep === 0 || idx === xLabels.length - 1)
    .map(({ label, idx }) => {
      const x = bounds.left + xStep * idx;
      return `<text x="${x}" y="${
        bounds.top + plotHeight + 20
      }" font-size="11" text-anchor="middle" fill="#475569">${escapeXml(
        label
      )}</text>`;
    })
    .join("\n");

  const legend = series
    .map(
      (item, idx) =>
        `<rect x="${bounds.left + idx * 180}" y="8" width="14" height="14" fill="${
          colors[idx % colors.length]
        }" /><text x="${bounds.left + idx * 180 + 20}" y="20" font-size="12" fill="#0f172a">${escapeXml(
          item.name
        )}</text>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${bounds.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(
    title
  )}</text>
  ${legend}
  ${grid}
  <line x1="${bounds.left}" y1="${bounds.top + plotHeight}" x2="${
    bounds.left + plotWidth
  }" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
  <line x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${
    bounds.top + plotHeight
  }" stroke="#475569" stroke-width="1.5" />
  ${paths}
  ${xTicks}
  <text x="18" y="${bounds.top + plotHeight / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${
    bounds.top + plotHeight / 2
  })">${escapeXml(yLabel)}</text>
</svg>`;
}

function createBarChart({ title, labels, values, yLabel, color = "#0f766e" }) {
  const bounds = chartBounds(1100, 480);
  const plotWidth = bounds.width - bounds.left - bounds.right;
  const plotHeight = bounds.height - bounds.top - bounds.bottom;
  const yMax = Math.max(...values) * 1.1;
  const barWidth = plotWidth / values.length - 10;
  const yTicks = 5;
  const grid = Array.from({ length: yTicks + 1 }, (_, i) => {
    const tick = (yMax * i) / yTicks;
    const y = scaleLinear(tick, 0, yMax, bounds.top + plotHeight, bounds.top);
    return `<line x1="${bounds.left}" y1="${y}" x2="${
      bounds.left + plotWidth
    }" y2="${y}" stroke="#e5e7eb" stroke-width="1" />
    <text x="${bounds.left - 10}" y="${y + 4}" font-size="12" text-anchor="end" fill="#475569">${round(
      tick
    )}</text>`;
  }).join("\n");

  const labelFontSize = labels.length > 12 ? 9 : 11;
  const bars = values
    .map((value, idx) => {
      const x = bounds.left + idx * (plotWidth / values.length) + 5;
      const y = scaleLinear(value, 0, yMax, bounds.top + plotHeight, bounds.top);
      const height = bounds.top + plotHeight - y;
      const labelY = bounds.top + plotHeight + 18;
      return `<rect x="${x}" y="${y}" width="${Math.max(
        8,
        barWidth
      )}" height="${height}" fill="${color}" rx="4" />
      <text x="${x + Math.max(8, barWidth) / 2}" y="${labelY}" font-size="${labelFontSize}" text-anchor="end" fill="#475569" transform="rotate(-35 ${x +
        Math.max(8, barWidth) / 2} ${labelY})">${escapeXml(labels[idx])}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${bounds.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(
    title
  )}</text>
  ${grid}
  <line x1="${bounds.left}" y1="${bounds.top + plotHeight}" x2="${
    bounds.left + plotWidth
  }" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
  <line x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${
    bounds.top + plotHeight
  }" stroke="#475569" stroke-width="1.5" />
  ${bars}
  <text x="18" y="${bounds.top + plotHeight / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${
    bounds.top + plotHeight / 2
  })">${escapeXml(yLabel)}</text>
</svg>`;
}

function createHistogram({ title, values, bins = 20, color = "#2563eb" }) {
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const width = maxVal - minVal || 1;
  const binWidth = width / bins;
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach((value) => {
    const idx = Math.min(bins - 1, Math.floor((value - minVal) / binWidth));
    counts[idx] += 1;
  });
  const labels = counts.map((_, idx) =>
    round(minVal + idx * binWidth).toString()
  );
  return createBarChart({
    title,
    labels,
    values: counts,
    yLabel: "Frequency",
    color,
  });
}

function createPredictionChart({ title, previewRows }) {
  return createLineChart({
    title,
    xLabels: previewRows.map((row) => row.date),
    series: [
      { name: "Actual", values: previewRows.map((row) => row.actual) },
      { name: "Predicted", values: previewRows.map((row) => row.predicted) },
      { name: "Lag-1 Baseline", values: previewRows.map((row) => row.baselineLag1) },
    ],
    yLabel: "Price",
  });
}

function createScatterChart({ title, points, xLabel, yLabel, color = "#0f766e" }) {
  const bounds = chartBounds(760, 520);
  const plotWidth = bounds.width - bounds.left - bounds.right;
  const plotHeight = bounds.height - bounds.top - bounds.bottom;
  const xVals = points.map((point) => point.x);
  const yVals = points.map((point) => point.y);
  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const dots = points
    .map((point) => {
      const cx = scaleLinear(point.x, xMin, xMax, bounds.left, bounds.left + plotWidth);
      const cy = scaleLinear(point.y, yMin, yMax, bounds.top + plotHeight, bounds.top);
      return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="${color}" fill-opacity="0.65" />`;
    })
    .join("\n");
  const lineStart = Math.max(xMin, yMin);
  const lineEnd = Math.min(xMax, yMax);
  const x1 = scaleLinear(lineStart, xMin, xMax, bounds.left, bounds.left + plotWidth);
  const y1 = scaleLinear(lineStart, yMin, yMax, bounds.top + plotHeight, bounds.top);
  const x2 = scaleLinear(lineEnd, xMin, xMax, bounds.left, bounds.left + plotWidth);
  const y2 = scaleLinear(lineEnd, yMin, yMax, bounds.top + plotHeight, bounds.top);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${bounds.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
  <line x1="${bounds.left}" y1="${bounds.top + plotHeight}" x2="${bounds.left + plotWidth}" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
  <line x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${bounds.top + plotHeight}" stroke="#475569" stroke-width="1.5" />
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#dc2626" stroke-width="2" stroke-dasharray="6 4" />
  ${dots}
  <text x="${bounds.left + plotWidth / 2}" y="${bounds.height - 8}" font-size="12" text-anchor="middle" fill="#475569">${escapeXml(xLabel)}</text>
  <text x="18" y="${bounds.top + plotHeight / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${bounds.top + plotHeight / 2})">${escapeXml(yLabel)}</text>
</svg>`;
}

function createHeatmap({ title, labels, matrix }) {
  const cellSize = 78;
  const left = 160;
  const top = 80;
  const width = left + labels.length * cellSize + 40;
  const height = top + labels.length * cellSize + 40;
  const values = matrix.flat();
  const maxAbs = Math.max(...values.map((value) => Math.abs(value))) || 1;
  const cells = [];
  for (let r = 0; r < labels.length; r += 1) {
    for (let c = 0; c < labels.length; c += 1) {
      const value = matrix[r][c];
      const intensity = Math.abs(value) / maxAbs;
      const fill =
        value >= 0
          ? `rgb(${Math.round(255 - intensity * 65)}, ${Math.round(
              255 - intensity * 120
            )}, ${Math.round(255 - intensity * 185)})`
          : `rgb(${Math.round(255 - intensity * 20)}, ${Math.round(
              255 - intensity * 170
            )}, ${Math.round(255 - intensity * 170)})`;
      cells.push(`<rect x="${left + c * cellSize}" y="${top + r * cellSize}" width="${cellSize}" height="${cellSize}" fill="${fill}" stroke="#ffffff" />
      <text x="${left + c * cellSize + cellSize / 2}" y="${top + r * cellSize + cellSize / 2 + 4}" font-size="12" text-anchor="middle" fill="#0f172a">${round(
        value,
        2
      )}</text>`);
    }
  }
  const rowLabels = labels
    .map(
      (label, idx) =>
        `<text x="${left - 10}" y="${top + idx * cellSize + cellSize / 2 + 4}" font-size="12" text-anchor="end" fill="#334155">${escapeXml(
          label
        )}</text>`
    )
    .join("\n");
  const colLabels = labels
    .map(
      (label, idx) =>
        `<text x="${left + idx * cellSize + cellSize / 2}" y="${top - 12}" font-size="12" text-anchor="start" fill="#334155" transform="rotate(-35 ${left +
          idx * cellSize + cellSize / 2} ${top - 12})">${escapeXml(label)}</text>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${left}" y="28" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
  ${rowLabels}
  ${colLabels}
  ${cells.join("\n")}
</svg>`;
}

function pearsonCorrelation(x, y) {
  const pairs = x
    .map((value, idx) => [value, y[idx]])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const xs = pairs.map((pair) => pair[0]);
  const ys = pairs.map((pair) => pair[1]);
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let xDen = 0;
  let yDen = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    numerator += dx * dy;
    xDen += dx * dx;
    yDen += dy * dy;
  }
  const denominator = Math.sqrt(xDen * yDen);
  return denominator === 0 ? 0 : numerator / denominator;
}

function matrixTranspose(matrix) {
  return matrix[0].map((_, colIdx) => matrix.map((row) => row[colIdx]));
}

function matrixMultiply(a, b) {
  const out = Array.from({ length: a.length }, () =>
    Array.from({ length: b[0].length }, () => 0)
  );
  for (let i = 0; i < a.length; i += 1) {
    for (let k = 0; k < b.length; k += 1) {
      for (let j = 0; j < b[0].length; j += 1) {
        out[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return out;
}

function identityMatrix(size) {
  return Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))
  );
}

function invertMatrix(matrix) {
  const n = matrix.length;
  const augmented = matrix.map((row, idx) => [...row, ...identityMatrix(n)[idx]]);
  for (let i = 0; i < n; i += 1) {
    let pivot = augmented[i][i];
    if (Math.abs(pivot) < 1e-12) {
      let swapRow = i + 1;
      while (swapRow < n && Math.abs(augmented[swapRow][i]) < 1e-12) {
        swapRow += 1;
      }
      if (swapRow === n) {
        throw new Error("Matrix is singular");
      }
      [augmented[i], augmented[swapRow]] = [augmented[swapRow], augmented[i]];
      pivot = augmented[i][i];
    }
    for (let j = 0; j < 2 * n; j += 1) {
      augmented[i][j] /= pivot;
    }
    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const factor = augmented[r][i];
      for (let c = 0; c < 2 * n; c += 1) {
        augmented[r][c] -= factor * augmented[i][c];
      }
    }
  }
  return augmented.map((row) => row.slice(n));
}

function ridgeRegression(X, y, lambda = 1) {
  const Xb = X.map((row) => [1, ...row]);
  const Xt = matrixTranspose(Xb);
  const XtX = matrixMultiply(Xt, Xb);
  for (let i = 1; i < XtX.length; i += 1) {
    XtX[i][i] += lambda;
  }
  const XtY = matrixMultiply(Xt, y.map((value) => [value]));
  const inv = invertMatrix(XtX);
  const beta = matrixMultiply(inv, XtY).map((row) => row[0]);
  return {
    predict(features) {
      const row = [1, ...features];
      return row.reduce((sum, value, idx) => sum + value * beta[idx], 0);
    },
    coefficients: beta,
  };
}

function regressionMetrics(actual, predicted) {
  const errors = actual.map((value, idx) => value - predicted[idx]);
  const mae = mean(errors.map((value) => Math.abs(value)));
  const rmse = Math.sqrt(mean(errors.map((value) => value ** 2)));
  const actualMean = mean(actual);
  const ssRes = actual.reduce(
    (sum, value, idx) => sum + (value - predicted[idx]) ** 2,
    0
  );
  const ssTot = actual.reduce((sum, value) => sum + (value - actualMean) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  return { mae: round(mae), rmse: round(rmse), r2: round(r2, 4) };
}

function detectOutliers(values) {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const outlierValues = values.filter((value) => value < lower || value > upper);
  return {
    lower: round(lower),
    upper: round(upper),
    count: outlierValues.length,
    percentage: round((outlierValues.length / values.length) * 100),
  };
}

function prepareCropDataset(fileName, cropName, weatherByDate, weatherSummary) {
  const rows = parseCsv(readText(path.join(DATA_DIR, fileName))).map((row) => {
    const date = dmyToIso(row.Arrival_Date);
    return {
      state: row.State,
      district: row.District,
      market: row.Market,
      commodity: row.Commodity,
      variety: row.Variety,
      grade: row.Grade,
      date,
      minPrice: toNumber(row.Min_Price),
      maxPrice: toNumber(row.Max_Price),
      modalPrice: toNumber(row.Modal_Price),
      spread: toNumber(row.Max_Price) - toNumber(row.Min_Price),
    };
  });

  const dailyGroups = groupBy(rows, (row) => row.date);
  const dailySeries = [...dailyGroups.entries()]
    .map(([date, items]) => ({
      date,
      marketCount: items.length,
      meanModalPrice: mean(items.map((item) => item.modalPrice)),
      meanMinPrice: mean(items.map((item) => item.minPrice)),
      meanMaxPrice: mean(items.map((item) => item.maxPrice)),
      meanSpread: mean(items.map((item) => item.spread)),
      weather: weatherByDate.get(date) || null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthlyGroups = groupBy(dailySeries, (row) => getYearMonth(row.date));
  const monthlySeries = [...monthlyGroups.entries()]
    .map(([month, items]) => ({
      month,
      meanModalPrice: mean(items.map((item) => item.meanModalPrice)),
      marketCount: mean(items.map((item) => item.marketCount)),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const monthSeasonality = Array.from({ length: 12 }, (_, idx) => idx + 1).map(
    (month) => {
      const items = dailySeries.filter((row) => getMonth(row.date) === month);
      return {
        month,
        monthName: monthName(month),
        meanModalPrice: mean(items.map((item) => item.meanModalPrice)),
      };
    }
  );

  const marketGroups = groupBy(rows, (row) => row.market);
  const topMarkets = [...marketGroups.entries()]
    .map(([market, items]) => ({
      market,
      observations: items.length,
      avgModalPrice: mean(items.map((item) => item.modalPrice)),
      volatility: standardDeviation(items.map((item) => item.modalPrice)),
    }))
    .sort((a, b) => b.observations - a.observations)
    .slice(0, 10);

  const modelRows = [];
  for (let i = 14; i < dailySeries.length; i += 1) {
    const current = dailySeries[i];
    if (!current.weather) {
      continue;
    }
    const prev1 = dailySeries[i - 1];
    const prev7 = dailySeries[i - 7];
    const prev14 = dailySeries[i - 14];
    const ma7 = mean(dailySeries.slice(i - 7, i).map((row) => row.meanModalPrice));
    const month = getMonth(current.date);
    const dow = getDayOfWeek(current.date);
    modelRows.push({
      date: current.date,
      target: current.meanModalPrice,
      baseline: prev1.meanModalPrice,
      features: [
        prev1.meanModalPrice,
        prev7.meanModalPrice,
        prev14.meanModalPrice,
        ma7,
        month,
        Math.sin((2 * Math.PI * month) / 12),
        Math.cos((2 * Math.PI * month) / 12),
        dow,
        current.weather.avg.PRECTOTCORR,
        current.weather.avg.T2M_MAX,
        current.weather.avg.T2M_MIN,
        current.weather.avg.RH2M,
        current.weather.avg.WS2M,
        current.weather.avg.GWETROOT,
        current.weather.range.T2M_MAX,
        current.weather.range.RH2M,
        current.weather.range.PRECTOTCORR,
      ],
    });
  }

  const splitIndex = Math.floor(modelRows.length * 0.8);
  const trainRows = modelRows.slice(0, splitIndex);
  const testRows = modelRows.slice(splitIndex);
  const model = ridgeRegression(
    trainRows.map((row) => row.features),
    trainRows.map((row) => row.target),
    5
  );
  const predictions = testRows.map((row) => model.predict(row.features));
  const actual = testRows.map((row) => row.target);
  const baselinePredictions = testRows.map((row) => row.baseline);
  const residuals = actual.map((value, idx) => value - predictions[idx]);
  const predictedPreview = testRows.slice(0, 120).map((row, idx) => ({
    date: row.date,
    actual: round(actual[idx]),
    predicted: round(predictions[idx]),
    baselineLag1: round(baselinePredictions[idx]),
    residual: round(actual[idx] - predictions[idx]),
  }));

  const dailyWithWeather = dailySeries.filter((row) => row.weather);
  const correlationLabels = [
    `${cropName} price`,
    "Average rainfall",
    "Average max temperature",
    "Average min temperature",
    "Average humidity",
    "Average wind speed",
    "Average root soil wetness",
  ];
  const correlationColumns = [
    dailyWithWeather.map((row) => row.meanModalPrice),
    dailyWithWeather.map((row) => row.weather.avg.PRECTOTCORR),
    dailyWithWeather.map((row) => row.weather.avg.T2M_MAX),
    dailyWithWeather.map((row) => row.weather.avg.T2M_MIN),
    dailyWithWeather.map((row) => row.weather.avg.RH2M),
    dailyWithWeather.map((row) => row.weather.avg.WS2M),
    dailyWithWeather.map((row) => row.weather.avg.GWETROOT),
  ];
  const correlationMatrix = correlationColumns.map((colX) =>
    correlationColumns.map((colY) => pearsonCorrelation(colX, colY))
  );

  const modalPrices = rows.map((row) => row.modalPrice);
  const duplicateKeys = new Set();
  let duplicateCount = 0;
  rows.forEach((row) => {
    const key = `${row.date}|${row.market}|${row.variety}|${row.grade}|${row.modalPrice}|${row.minPrice}|${row.maxPrice}`;
    if (duplicateKeys.has(key)) {
      duplicateCount += 1;
    } else {
      duplicateKeys.add(key);
    }
  });
  const missingCounts = {
    date: rows.filter((row) => !row.date).length,
    market: rows.filter((row) => !row.market).length,
    minPrice: rows.filter((row) => !Number.isFinite(row.minPrice)).length,
    maxPrice: rows.filter((row) => !Number.isFinite(row.maxPrice)).length,
    modalPrice: rows.filter((row) => !Number.isFinite(row.modalPrice)).length,
  };

  return {
    cropName,
    rows,
    dailySeries,
    monthlySeries,
    monthSeasonality,
    topMarkets,
    descriptive: summarizeNumeric(rows.map((row) => row.modalPrice)),
    minPriceSummary: summarizeNumeric(rows.map((row) => row.minPrice)),
    maxPriceSummary: summarizeNumeric(rows.map((row) => row.maxPrice)),
    spreadSummary: summarizeNumeric(rows.map((row) => row.spread)),
    outliers: detectOutliers(modalPrices),
    uniqueMarkets: new Set(rows.map((row) => row.market)).size,
    dateRange: {
      start: rows[0].date,
      end: rows[rows.length - 1].date,
    },
    dataQuality: {
      missingCounts,
      duplicateCount,
      duplicatePercentage: round((duplicateCount / rows.length) * 100),
    },
    weatherSummary,
    correlation: {
      labels: correlationLabels,
      matrix: correlationMatrix,
    },
    model: {
      featureNames: [
        "lag1",
        "lag7",
        "lag14",
        "ma7",
        "month",
        "month_sin",
        "month_cos",
        "day_of_week",
        "rainfall",
        "temp_max",
        "temp_min",
        "humidity",
        "wind_speed",
        "root_soil_wetness",
        "cross_city_temp_range",
        "cross_city_humidity_range",
        "cross_city_rainfall_range",
      ],
      trainCount: trainRows.length,
      testCount: testRows.length,
      metrics: regressionMetrics(actual, predictions),
      baselineMetrics: regressionMetrics(actual, baselinePredictions),
      preview: predictedPreview,
      residualSummary: summarizeNumeric(residuals),
    },
  };
}

function buildWeatherMap() {
  const weatherFiles = fs
    .readdirSync(WEATHER_DIR)
    .filter((file) => file.toLowerCase().endsWith(".csv"));
  const perLocation = weatherFiles.map((file) => ({
    name: file.replace(/_Daily.*|_weather.*|\.[^.]+$/gi, ""),
    rows: parseWeatherCsv(readText(path.join(WEATHER_DIR, file))),
  }));
  const byDate = new Map();
  perLocation.forEach((location) => {
    location.rows.forEach((row) => {
      const date = isoFromYearDoy(row.YEAR, row.DOY);
      const metrics = {
        PRECTOTCORR: toNumber(row.PRECTOTCORR),
        T2M_RANGE: toNumber(row.T2M_RANGE),
        T2M_MAX: toNumber(row.T2M_MAX),
        T2M_MIN: toNumber(row.T2M_MIN),
        RH2M: toNumber(row.RH2M),
        WS2M: toNumber(row.WS2M),
        GWETTOP: toNumber(row.GWETTOP),
        GWETROOT: toNumber(row.GWETROOT),
      };
      if (!byDate.has(date)) {
        byDate.set(date, []);
      }
      byDate.get(date).push(metrics);
    });
  });

  const aggregatedByDate = new Map();
  [...byDate.entries()].forEach(([date, rows]) => {
    const keys = Object.keys(rows[0]);
    const avg = {};
    const range = {};
    keys.forEach((key) => {
      const values = rows.map((row) => row[key]).filter((value) => Number.isFinite(value) && value !== -999);
      avg[key] = mean(values);
      range[key] = Math.max(...values) - Math.min(...values);
    });
    aggregatedByDate.set(date, { avg, range, cityCount: rows.length });
  });

  const summary = {
    weatherFilesUsed: weatherFiles,
    locationCount: perLocation.length,
    weatherDateRange: {
      start: [...aggregatedByDate.keys()].sort()[0],
      end: [...aggregatedByDate.keys()].sort().slice(-1)[0],
    },
  };

  return { aggregatedByDate, summary };
}

function saveCropArtifacts(dataset) {
  const slug = dataset.cropName.toLowerCase();
  writeSvg(
    path.join(CHART_DIR, `${slug}_monthly_trend.svg`),
    createLineChart({
      title: `${dataset.cropName} Monthly Average Modal Price Trend Across Pune District Markets`,
      xLabels: dataset.monthlySeries.map((item) => item.month),
      series: [{ name: dataset.cropName, values: dataset.monthlySeries.map((item) => round(item.meanModalPrice)) }],
      yLabel: "Average modal price in rupees per quintal",
    })
  );

  writeSvg(
    path.join(CHART_DIR, `${slug}_seasonality.svg`),
    createBarChart({
      title: `${dataset.cropName} Average Modal Price by Calendar Month from 2015 to 2026`,
      labels: dataset.monthSeasonality.map((item) => item.monthName),
      values: dataset.monthSeasonality.map((item) => round(item.meanModalPrice)),
      yLabel: "Average modal price in rupees per quintal",
      color: "#dc2626",
    })
  );

  writeSvg(
    path.join(CHART_DIR, `${slug}_top_markets.svg`),
    createBarChart({
      title: `${dataset.cropName} Average Modal Price in the Ten Most Frequently Observed Markets`,
      labels: dataset.topMarkets.map((item) => item.market),
      values: dataset.topMarkets.map((item) => item.avgModalPrice),
      yLabel: "Average modal price in rupees per quintal",
      color: "#0f766e",
    })
  );

  writeSvg(
    path.join(CHART_DIR, `${slug}_price_distribution.svg`),
    createHistogram({
      title: `${dataset.cropName} Distribution of Observed Modal Prices Across All Daily Market Records`,
      values: dataset.rows.map((item) => item.modalPrice),
      bins: 18,
      color: "#2563eb",
    })
  );

  writeSvg(
    path.join(CHART_DIR, `${slug}_prediction_vs_actual.svg`),
    createPredictionChart({
      title: `${dataset.cropName} Prediction Model Performance on the Holdout Test Period`,
      previewRows: dataset.model.preview,
    })
  );

  writeSvg(
    path.join(CHART_DIR, `${slug}_actual_vs_predicted_scatter.svg`),
    createScatterChart({
      title: `${dataset.cropName} Diagnostic Scatter Plot of Actual Prices Versus Model Predictions`,
      points: dataset.model.preview.map((row) => ({ x: row.actual, y: row.predicted })),
      xLabel: "Actual average modal price in rupees per quintal",
      yLabel: "Predicted average modal price in rupees per quintal",
      color: "#7c3aed",
    })
  );

  writeSvg(
    path.join(CHART_DIR, `${slug}_residual_distribution.svg`),
    createHistogram({
      title: `${dataset.cropName} Distribution of Prediction Residuals for the Holdout Test Period`,
      values: dataset.model.preview.map((row) => row.residual),
      bins: 18,
      color: "#b45309",
    })
  );

  writeSvg(
    path.join(CHART_DIR, `${slug}_correlation_heatmap.svg`),
    createHeatmap({
      title: `${dataset.cropName} Correlation Matrix Between Price and Aggregated Weather Variables`,
      labels: dataset.correlation.labels,
      matrix: dataset.correlation.matrix,
    })
  );

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${slug}_model_preview.json`),
    JSON.stringify(dataset.model.preview, null, 2),
    "utf8"
  );
}

function buildHtmlReport(onion, tomato) {
  const sections = [onion, tomato]
    .map((dataset) => {
      const slug = dataset.cropName.toLowerCase();
      return `
      <section class="card">
        <h2>${dataset.cropName}</h2>
        <div class="stats">
          <div><strong>Records</strong><span>${dataset.rows.length.toLocaleString()}</span></div>
          <div><strong>Markets</strong><span>${dataset.uniqueMarkets}</span></div>
          <div><strong>Date range</strong><span>${dataset.dateRange.start} to ${dataset.dateRange.end}</span></div>
          <div><strong>Mean modal price</strong><span>${dataset.descriptive.mean}</span></div>
          <div><strong>Median modal price</strong><span>${dataset.descriptive.median}</span></div>
          <div><strong>Std dev</strong><span>${dataset.descriptive.std}</span></div>
          <div><strong>Model RMSE</strong><span>${dataset.model.metrics.rmse}</span></div>
          <div><strong>Model R2</strong><span>${dataset.model.metrics.r2}</span></div>
          <div><strong>Outlier percentage</strong><span>${dataset.outliers.percentage}%</span></div>
        </div>
        <div class="grid">
          <img src="./charts/${slug}_monthly_trend.svg" alt="${dataset.cropName} monthly trend" />
          <img src="./charts/${slug}_seasonality.svg" alt="${dataset.cropName} seasonality" />
          <img src="./charts/${slug}_top_markets.svg" alt="${dataset.cropName} markets" />
          <img src="./charts/${slug}_price_distribution.svg" alt="${dataset.cropName} distribution" />
          <img src="./charts/${slug}_prediction_vs_actual.svg" alt="${dataset.cropName} prediction model" />
          <img src="./charts/${slug}_actual_vs_predicted_scatter.svg" alt="${dataset.cropName} scatter diagnostic" />
          <img src="./charts/${slug}_residual_distribution.svg" alt="${dataset.cropName} residual distribution" />
          <img src="./charts/${slug}_correlation_heatmap.svg" alt="${dataset.cropName} correlation heatmap" />
        </div>
      </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agricultural Price Analysis</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card: #ffffff;
      --ink: #0f172a;
      --muted: #475569;
      --line: #e2e8f0;
      --accent: #14532d;
    }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: linear-gradient(180deg, #eefbf3 0%, var(--bg) 28%);
      color: var(--ink);
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1 {
      font-size: 2.3rem;
      margin-bottom: 8px;
    }
    .lead {
      color: var(--muted);
      max-width: 850px;
      line-height: 1.6;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 24px;
      margin-top: 24px;
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.06);
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 14px;
      margin: 16px 0 24px;
    }
    .stats div {
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stats span {
      font-size: 1.15rem;
      color: var(--accent);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }
    img {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
    }
    @media (min-width: 960px) {
      .grid {
        grid-template-columns: 1fr 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Onion and Tomato Price Analysis</h1>
    <p class="lead">This dashboard summarizes daily market price data from Pune district for onion and tomato using the CSV extracts available in the project. The machine-learning section uses a ridge regression model with lagged price features, calendar features, and weather information aggregated from all six available NASA POWER weather files to predict the next observed daily average modal price.</p>
    ${sections}
  </div>
</body>
</html>`;
}

function keyFindings(onion, tomato) {
  const crops = [onion, tomato];
  return crops
    .map((dataset) => {
      const bestMarket = [...dataset.topMarkets].sort(
        (a, b) => b.avgModalPrice - a.avgModalPrice
      )[0];
      const mostVolatile = [...dataset.topMarkets].sort(
        (a, b) => b.volatility - a.volatility
      )[0];
      const strongestMonth = [...dataset.monthSeasonality].sort(
        (a, b) => b.meanModalPrice - a.meanModalPrice
      )[0];
      const weakestMonth = [...dataset.monthSeasonality].sort(
        (a, b) => a.meanModalPrice - b.meanModalPrice
      )[0];
      return {
        crop: dataset.cropName,
        bestMarket: { market: bestMarket.market, avgModalPrice: round(bestMarket.avgModalPrice) },
        mostVolatileMarket: {
          market: mostVolatile.market,
          volatility: round(mostVolatile.volatility),
        },
        strongestMonth: {
          month: strongestMonth.month,
          avgModalPrice: round(strongestMonth.meanModalPrice),
        },
        weakestMonth: {
          month: weakestMonth.month,
          avgModalPrice: round(weakestMonth.meanModalPrice),
        },
      };
    })
    .map((item) =>
      `- ${item.crop}: highest average among the busiest markets was ${item.bestMarket.market} (${item.bestMarket.avgModalPrice}), strongest month was ${item.strongestMonth.month} (${item.strongestMonth.avgModalPrice}), weakest month was ${item.weakestMonth.month} (${item.weakestMonth.avgModalPrice}), and the most volatile busy market was ${item.mostVolatileMarket.market} (${item.mostVolatileMarket.volatility}).`
    )
    .join("\n");
}

function buildMarkdownReport(onion, tomato) {
  const reportDate = new Date().toISOString().slice(0, 10);
  return `# Agricultural Price Analysis

Generated on ${reportDate}.

## Data used

- Onion source: \`Daily price market/Onion 2015-2025.csv\`
- Tomato source: \`Daily price market/Tomato 2015-2025.csv\`
- Weather sources used for modeling: ${onion.weatherSummary.weatherFilesUsed.map((file) => `\`Weather/${file}\``).join(", ")}
- Note: although the file names say 2015-2025, the actual CSV records extend through 2026-03-12 for both onion and tomato. I used the exact dates present in the files.

## Descriptive analysis

### Onion

- Records: ${onion.rows.length.toLocaleString()}
- Markets: ${onion.uniqueMarkets}
- Date range: ${onion.dateRange.start} to ${onion.dateRange.end}
- Modal price summary: ${JSON.stringify(onion.descriptive)}
- Min price summary: ${JSON.stringify(onion.minPriceSummary)}
- Max price summary: ${JSON.stringify(onion.maxPriceSummary)}
- Price spread summary: ${JSON.stringify(onion.spreadSummary)}
- Data quality summary: ${JSON.stringify(onion.dataQuality)}
- Outlier summary using IQR rule on modal price: ${JSON.stringify(onion.outliers)}

### Tomato

- Records: ${tomato.rows.length.toLocaleString()}
- Markets: ${tomato.uniqueMarkets}
- Date range: ${tomato.dateRange.start} to ${tomato.dateRange.end}
- Modal price summary: ${JSON.stringify(tomato.descriptive)}
- Min price summary: ${JSON.stringify(tomato.minPriceSummary)}
- Max price summary: ${JSON.stringify(tomato.maxPriceSummary)}
- Price spread summary: ${JSON.stringify(tomato.spreadSummary)}
- Data quality summary: ${JSON.stringify(tomato.dataQuality)}
- Outlier summary using IQR rule on modal price: ${JSON.stringify(tomato.outliers)}

## EDA highlights

${keyFindings(onion, tomato)}

## Detailed EDA interpretation

### Onion

- The long-run monthly trend chart shows several sharp price spikes, which means onion prices are highly volatile and exposed to episodic shocks.
- The seasonality chart shows the highest average prices in ${monthName(onion.monthSeasonality.sort((a, b) => b.meanModalPrice - a.meanModalPrice)[0].month)} and lower average levels in ${monthName(onion.monthSeasonality.sort((a, b) => a.meanModalPrice - b.meanModalPrice)[0].month)}.
- The distribution chart is strongly right-skewed because a small number of extreme observations pull the mean above the median.
- The market comparison chart shows that price levels are not uniform across markets, which supports using market aggregation and weather features together.

### Tomato

- The monthly trend chart is smoother than onion in some periods, but it still includes clear upward bursts and sudden corrections.
- The seasonality chart shows the highest average prices in ${monthName(tomato.monthSeasonality.sort((a, b) => b.meanModalPrice - a.meanModalPrice)[0].month)} and the weakest average month in ${monthName(tomato.monthSeasonality.sort((a, b) => a.meanModalPrice - b.meanModalPrice)[0].month)}.
- The price distribution is also right-skewed, but the maximum observed tomato price is much lower than the onion maximum.
- Differences across the most active markets suggest local supply conditions still matter even inside the same district.

## Correlation analysis

- Onion correlation matrix is included in \`analysis_output/charts/onion_correlation_heatmap.svg\`
- Tomato correlation matrix is included in \`analysis_output/charts/tomato_correlation_heatmap.svg\`
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

- Train rows: ${onion.model.trainCount}
- Test rows: ${onion.model.testCount}
- Ridge metrics: ${JSON.stringify(onion.model.metrics)}
- Baseline using previous day only: ${JSON.stringify(onion.model.baselineMetrics)}
- Residual summary: ${JSON.stringify(onion.model.residualSummary)}

### Tomato model

- Train rows: ${tomato.model.trainCount}
- Test rows: ${tomato.model.testCount}
- Ridge metrics: ${JSON.stringify(tomato.model.metrics)}
- Baseline using previous day only: ${JSON.stringify(tomato.model.baselineMetrics)}
- Residual summary: ${JSON.stringify(tomato.model.residualSummary)}

## Diagnostic analysis

- The prediction-versus-actual line charts show whether the model follows turning points over time.
- The scatter plots show how closely predictions align with the ideal 45-degree line.
- The residual histograms show whether errors are centered around zero or biased upward or downward.
- Overall, the new all-weather model should be judged against both its numeric metrics and these diagnostic visuals.

## Output files

- Dashboard: \`analysis_output/report.html\`
- Summary report: \`analysis_output/analysis_report.md\`
- Charts: \`analysis_output/charts/\`
- Model previews: \`analysis_output/onion_model_preview.json\`, \`analysis_output/tomato_model_preview.json\`
`;
}

function main() {
  const weatherBundle = buildWeatherMap();
  const onion = prepareCropDataset(
    "Onion 2015-2025.csv",
    "Onion",
    weatherBundle.aggregatedByDate,
    weatherBundle.summary
  );
  const tomato = prepareCropDataset(
    "Tomato 2015-2025.csv",
    "Tomato",
    weatherBundle.aggregatedByDate,
    weatherBundle.summary
  );

  saveCropArtifacts(onion);
  saveCropArtifacts(tomato);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "analysis_report.md"),
    buildMarkdownReport(onion, tomato),
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "report.html"),
    buildHtmlReport(onion, tomato),
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "summary.json"),
    JSON.stringify(
      {
        onion: {
          descriptive: onion.descriptive,
          outliers: onion.outliers,
          dataQuality: onion.dataQuality,
          model: onion.model.metrics,
          baseline: onion.model.baselineMetrics,
        },
        tomato: {
          descriptive: tomato.descriptive,
          outliers: tomato.outliers,
          dataQuality: tomato.dataQuality,
          model: tomato.model.metrics,
          baseline: tomato.model.baselineMetrics,
        },
        weather: weatherBundle.summary,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Analysis completed. Outputs written to ${OUTPUT_DIR}`);
}

main();
