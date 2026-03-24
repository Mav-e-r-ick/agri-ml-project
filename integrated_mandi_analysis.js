const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const CROP_DIR = path.join(ROOT, "Daily price market");
const WEATHER_DIR = path.join(ROOT, "Weather");
const FUEL_PREP_DIR = path.join(ROOT, "fuel_analysis_output", "prepared_data");
const OUTPUT_DIR = path.join(ROOT, "integrated_mandi_output");
const CHART_DIR = path.join(OUTPUT_DIR, "charts");
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const std = standardDeviation(values);
  const avg = mean(values);
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

function dmyToIso(value) {
  const [dd, mm, yyyy] = value.split("-");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function isoFromYearDoy(year, doy) {
  const dt = new Date(Date.UTC(Number(year), 0, 1));
  dt.setUTCDate(dt.getUTCDate() + Number(doy) - 1);
  return dt.toISOString().slice(0, 10);
}

function getMonth(isoDate) {
  return Number(isoDate.slice(5, 7));
}

function monthName(month) {
  return MONTH_NAMES[month - 1];
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
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
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
  const idx = lines.findIndex((line) => line.startsWith("YEAR,DOY,"));
  return parseCsv(lines.slice(idx).join("\n"));
}

function chartBounds(width, height) {
  return { width, height, left: 80, right: 30, top: 30, bottom: 70 };
}

function scaleLinear(value, dmin, dmax, rmin, rmax) {
  if (dmax === dmin) return (rmin + rmax) / 2;
  return rmin + ((value - dmin) / (dmax - dmin)) * (rmax - rmin);
}

function createLineChart({ title, xLabels, series, yLabel }) {
  const b = chartBounds(1200, 430);
  const pw = b.width - b.left - b.right;
  const ph = b.height - b.top - b.bottom;
  const vals = series.flatMap((s) => s.values);
  const yMin = Math.min(...vals);
  const yMax = Math.max(...vals);
  const xStep = xLabels.length > 1 ? pw / (xLabels.length - 1) : pw;
  const colors = ["#b91c1c", "#1d4ed8", "#047857", "#7c3aed"];
  const ticks = Array.from({ length: 6 }, (_, i) => yMin + ((yMax - yMin) * i) / 5);
  const grid = ticks
    .map((tick) => {
      const y = scaleLinear(tick, yMin, yMax, b.top + ph, b.top);
      return `<line x1="${b.left}" y1="${y}" x2="${b.left + pw}" y2="${y}" stroke="#e5e7eb" />
      <text x="${b.left - 10}" y="${y + 4}" font-size="12" text-anchor="end" fill="#475569">${round(tick)}</text>`;
    })
    .join("");
  const paths = series
    .map((s, idx) => {
      const d = s.values
        .map((v, i) => `${i === 0 ? "M" : "L"} ${b.left + xStep * i} ${scaleLinear(v, yMin, yMax, b.top + ph, b.top)}`)
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="3" />`;
    })
    .join("");
  const step = Math.max(1, Math.floor(xLabels.length / 12));
  const xTicks = xLabels
    .map((label, idx) => ({ label, idx }))
    .filter((_, i) => i % step === 0 || i === xLabels.length - 1)
    .map(({ label, idx }) => `<text x="${b.left + xStep * idx}" y="${b.top + ph + 20}" font-size="11" text-anchor="middle" fill="#475569">${escapeXml(label)}</text>`)
    .join("");
  const legend = series
    .map((s, idx) => `<rect x="${b.left + idx * 220}" y="8" width="14" height="14" fill="${colors[idx % colors.length]}" /><text x="${b.left + idx * 220 + 20}" y="20" font-size="12" fill="#0f172a">${escapeXml(s.name)}</text>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}">
<rect width="100%" height="100%" fill="#ffffff" />
<text x="${b.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
${legend}${grid}
<line x1="${b.left}" y1="${b.top + ph}" x2="${b.left + pw}" y2="${b.top + ph}" stroke="#475569" stroke-width="1.5" />
<line x1="${b.left}" y1="${b.top}" x2="${b.left}" y2="${b.top + ph}" stroke="#475569" stroke-width="1.5" />
${paths}${xTicks}
<text x="18" y="${b.top + ph / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${b.top + ph / 2})">${escapeXml(yLabel)}</text>
</svg>`;
}

function createBarChart({ title, labels, values, yLabel, color = "#0f766e" }) {
  const b = chartBounds(1150, 500);
  const pw = b.width - b.left - b.right;
  const ph = b.height - b.top - b.bottom;
  const yMax = Math.max(...values) * 1.1;
  const slot = pw / values.length;
  const barWidth = Math.max(10, slot - 12);
  const bars = values
    .map((value, idx) => {
      const x = b.left + idx * slot + (slot - barWidth) / 2;
      const y = scaleLinear(value, 0, yMax, b.top + ph, b.top);
      const h = b.top + ph - y;
      const lx = x + barWidth / 2;
      const ly = b.top + ph + 22;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" fill="${color}" rx="4" />
      <text x="${lx}" y="${ly}" font-size="10" text-anchor="end" fill="#475569" transform="rotate(-35 ${lx} ${ly})">${escapeXml(labels[idx])}</text>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}">
<rect width="100%" height="100%" fill="#ffffff" />
<text x="${b.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
<line x1="${b.left}" y1="${b.top + ph}" x2="${b.left + pw}" y2="${b.top + ph}" stroke="#475569" stroke-width="1.5" />
<line x1="${b.left}" y1="${b.top}" x2="${b.left}" y2="${b.top + ph}" stroke="#475569" stroke-width="1.5" />
${bars}
<text x="18" y="${b.top + ph / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${b.top + ph / 2})">${escapeXml(yLabel)}</text>
</svg>`;
}

function createScatterChart({ title, points, xLabel, yLabel, color = "#7c3aed" }) {
  const b = chartBounds(760, 520);
  const pw = b.width - b.left - b.right;
  const ph = b.height - b.top - b.bottom;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const dots = points
    .map((p) => `<circle cx="${scaleLinear(p.x, xMin, xMax, b.left, b.left + pw)}" cy="${scaleLinear(p.y, yMin, yMax, b.top + ph, b.top)}" r="3.2" fill="${color}" fill-opacity="0.65" />`)
    .join("");
  const low = Math.max(xMin, yMin);
  const high = Math.min(xMax, yMax);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}">
<rect width="100%" height="100%" fill="#ffffff" />
<text x="${b.left}" y="22" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
<line x1="${b.left}" y1="${b.top + ph}" x2="${b.left + pw}" y2="${b.top + ph}" stroke="#475569" stroke-width="1.5" />
<line x1="${b.left}" y1="${b.top}" x2="${b.left}" y2="${b.top + ph}" stroke="#475569" stroke-width="1.5" />
<line x1="${scaleLinear(low, xMin, xMax, b.left, b.left + pw)}" y1="${scaleLinear(low, yMin, yMax, b.top + ph, b.top)}" x2="${scaleLinear(high, xMin, xMax, b.left, b.left + pw)}" y2="${scaleLinear(high, yMin, yMax, b.top + ph, b.top)}" stroke="#dc2626" stroke-width="2" stroke-dasharray="6 4" />
${dots}
<text x="${b.left + pw / 2}" y="${b.height - 8}" font-size="12" text-anchor="middle" fill="#475569">${escapeXml(xLabel)}</text>
<text x="18" y="${b.top + ph / 2}" font-size="12" fill="#475569" transform="rotate(-90 18 ${b.top + ph / 2})">${escapeXml(yLabel)}</text>
</svg>`;
}

function createHeatmap({ title, labels, matrix }) {
  const cell = 74;
  const left = 190;
  const top = 85;
  const width = left + labels.length * cell + 40;
  const height = top + labels.length * cell + 40;
  const maxAbs = Math.max(...matrix.flat().map((v) => Math.abs(v))) || 1;
  const cells = [];
  for (let r = 0; r < labels.length; r += 1) {
    for (let c = 0; c < labels.length; c += 1) {
      const v = matrix[r][c];
      const intensity = Math.abs(v) / maxAbs;
      const fill =
        v >= 0
          ? `rgb(${Math.round(255 - intensity * 65)}, ${Math.round(255 - intensity * 110)}, ${Math.round(255 - intensity * 180)})`
          : `rgb(${Math.round(255 - intensity * 20)}, ${Math.round(255 - intensity * 165)}, ${Math.round(255 - intensity * 165)})`;
      cells.push(
        `<rect x="${left + c * cell}" y="${top + r * cell}" width="${cell}" height="${cell}" fill="${fill}" stroke="#ffffff" /><text x="${left + c * cell + cell / 2}" y="${top + r * cell + cell / 2 + 4}" font-size="12" text-anchor="middle" fill="#0f172a">${round(v, 2)}</text>`
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff" />
<text x="${left}" y="28" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>
${labels.map((l, i) => `<text x="${left - 12}" y="${top + i * cell + cell / 2 + 4}" font-size="12" text-anchor="end" fill="#334155">${escapeXml(l)}</text>`).join("")}
${labels.map((l, i) => `<text x="${left + i * cell + cell / 2}" y="${top - 12}" font-size="12" text-anchor="start" fill="#334155" transform="rotate(-35 ${left + i * cell + cell / 2} ${top - 12})">${escapeXml(l)}</text>`).join("")}
${cells.join("")}
</svg>`;
}

function matrixTranspose(matrix) {
  return matrix[0].map((_, c) => matrix.map((r) => r[c]));
}

function matrixMultiply(a, b) {
  const out = Array.from({ length: a.length }, () => Array.from({ length: b[0].length }, () => 0));
  for (let i = 0; i < a.length; i += 1) {
    for (let k = 0; k < b.length; k += 1) {
      for (let j = 0; j < b[0].length; j += 1) {
        out[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return out;
}

function invertMatrix(matrix) {
  const n = matrix.length;
  const aug = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i += 1) {
    let pivot = aug[i][i];
    if (Math.abs(pivot) < 1e-12) {
      let swap = i + 1;
      while (swap < n && Math.abs(aug[swap][i]) < 1e-12) swap += 1;
      if (swap === n) throw new Error("Matrix is singular");
      [aug[i], aug[swap]] = [aug[swap], aug[i]];
      pivot = aug[i][i];
    }
    for (let j = 0; j < 2 * n; j += 1) aug[i][j] /= pivot;
    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const factor = aug[r][i];
      for (let c = 0; c < 2 * n; c += 1) aug[r][c] -= factor * aug[i][c];
    }
  }
  return aug.map((row) => row.slice(n));
}

function standardizeMatrix(matrix) {
  const cols = matrix[0].length;
  const means = [];
  const stds = [];
  for (let c = 0; c < cols; c += 1) {
    const col = matrix.map((row) => row[c]);
    const m = mean(col);
    let sd = standardDeviation(col);
    if (sd === 0) sd = 1;
    means.push(m);
    stds.push(sd);
  }
  return {
    means,
    stds,
    transform(rows) {
      return rows.map((row) => row.map((v, i) => (v - means[i]) / stds[i]));
    },
  };
}

function ridgeFit(X, y, lambda) {
  const Xt = matrixTranspose(X);
  const XtX = matrixMultiply(Xt, X);
  for (let i = 1; i < XtX.length; i += 1) XtX[i][i] += lambda;
  const XtY = matrixMultiply(Xt, y.map((v) => [v]));
  return matrixMultiply(invertMatrix(XtX), XtY).map((r) => r[0]);
}

function predictRows(rows, beta) {
  return rows.map((row) => row.reduce((sum, value, idx) => sum + value * beta[idx], 0));
}

function regressionMetrics(actual, predicted) {
  const errors = actual.map((v, i) => v - predicted[i]);
  const mae = mean(errors.map((e) => Math.abs(e)));
  const rmse = Math.sqrt(mean(errors.map((e) => e ** 2)));
  const avg = mean(actual);
  const ssRes = actual.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
  const ssTot = actual.reduce((s, v) => s + (v - avg) ** 2, 0);
  return { mae: round(mae), rmse: round(rmse), r2: round(1 - ssRes / ssTot, 4) };
}

function buildTimeSeriesFolds(rows, foldCount = 5) {
  const minTrain = Math.floor(rows.length * 0.4);
  const remaining = rows.length - minTrain;
  const foldSize = Math.floor(remaining / foldCount);
  const folds = [];
  for (let i = 0; i < foldCount; i += 1) {
    const valStart = minTrain + i * foldSize;
    const valEnd = i === foldCount - 1 ? rows.length : valStart + foldSize;
    if (valStart < valEnd) folds.push({ trainEnd: valStart, valStart, valEnd });
  }
  return folds;
}

function crossValidateLambda(rows, lambdas) {
  const folds = buildTimeSeriesFolds(rows, 5);
  const scores = lambdas.map((lambda) => {
    const rmses = folds.map((fold) => {
      const train = rows.slice(0, fold.trainEnd);
      const val = rows.slice(fold.valStart, fold.valEnd);
      const scaler = standardizeMatrix(train.map((r) => r.features));
      const trainX = scaler.transform(train.map((r) => r.features)).map((r) => [1, ...r]);
      const valX = scaler.transform(val.map((r) => r.features)).map((r) => [1, ...r]);
      const beta = ridgeFit(trainX, train.map((r) => r.target), lambda);
      const preds = predictRows(valX, beta);
      return regressionMetrics(val.map((r) => r.target), preds).rmse;
    });
    return { lambda, avgRmse: mean(rmses) };
  });
  scores.sort((a, b) => a.avgRmse - b.avgRmse);
  return { bestLambda: scores[0].lambda, scores };
}

function loadCropDaily(fileName, cropName) {
  const rows = parseCsv(fs.readFileSync(path.join(CROP_DIR, fileName), "utf8")).map((row) => ({
    crop: cropName,
    date: dmyToIso(row.Arrival_Date),
    market: row.Market,
    minPrice: Number(row.Min_Price),
    maxPrice: Number(row.Max_Price),
    modalPrice: Number(row.Modal_Price),
  }));
  const daily = [...groupBy(rows, (r) => r.date).entries()]
    .map(([date, items]) => ({
      date,
      avgModal: mean(items.map((i) => i.modalPrice)),
      avgMin: mean(items.map((i) => i.minPrice)),
      avgMax: mean(items.map((i) => i.maxPrice)),
      avgSpread: mean(items.map((i) => i.maxPrice - i.minPrice)),
      marketCount: items.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { raw: rows, daily };
}

function loadWeatherAggregate() {
  const files = fs.readdirSync(WEATHER_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  const byDate = new Map();
  files.forEach((file) => {
    const rows = parseWeatherCsv(fs.readFileSync(path.join(WEATHER_DIR, file), "utf8"));
    rows.forEach((row) => {
      const date = isoFromYearDoy(row.YEAR, row.DOY);
      const metrics = {
        PRECTOTCORR: Number(row.PRECTOTCORR),
        T2M_MAX: Number(row.T2M_MAX),
        T2M_MIN: Number(row.T2M_MIN),
        RH2M: Number(row.RH2M),
        WS2M: Number(row.WS2M),
        GWETROOT: Number(row.GWETROOT),
      };
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(metrics);
    });
  });
  const aggregated = new Map();
  [...byDate.entries()].forEach(([date, rows]) => {
    const keys = Object.keys(rows[0]);
    const avg = {};
    const range = {};
    keys.forEach((key) => {
      const vals = rows.map((r) => r[key]).filter((v) => Number.isFinite(v) && v !== -999);
      avg[key] = mean(vals);
      range[key] = Math.max(...vals) - Math.min(...vals);
    });
    aggregated.set(date, { avg, range, cityCount: rows.length });
  });
  return { aggregated, files };
}

function loadFuelSeries() {
  const load = (files) => {
    const byDate = new Map();
    files.forEach((file) => {
      const rows = parseCsv(fs.readFileSync(path.join(FUEL_PREP_DIR, file), "utf8"));
      rows.forEach((row) => byDate.set(row.date, Number(row.price)));
    });
    return byDate;
  };
  return {
    petrol: load(["petrol_2017_18.csv", "petrol_2018_19.csv", "petrol_2019_20.csv", "petrol_2020_2026.csv"]),
    diesel: load(["diesel_2017_18.csv", "diesel_2018_19.csv", "diesel_2019_20.csv", "diesel_2020_2026.csv"]),
  };
}

function buildIntegratedDataset(onion, tomato, weather, fuel) {
  const onionMap = new Map(onion.daily.map((r) => [r.date, r]));
  const tomatoMap = new Map(tomato.daily.map((r) => [r.date, r]));
  const commonDates = [...onionMap.keys()]
    .filter((d) => tomatoMap.has(d) && weather.aggregated.has(d) && fuel.petrol.has(d) && fuel.diesel.has(d))
    .sort();
  return commonDates.map((date) => {
    const o = onionMap.get(date);
    const t = tomatoMap.get(date);
    const w = weather.aggregated.get(date);
    const petrol = fuel.petrol.get(date);
    const diesel = fuel.diesel.get(date);
    return {
      date,
      onion: o.avgModal,
      tomato: t.avgModal,
      onionMin: o.avgMin,
      onionMax: o.avgMax,
      onionSpread: o.avgSpread,
      onionMarkets: o.marketCount,
      tomatoMin: t.avgMin,
      tomatoMax: t.avgMax,
      tomatoSpread: t.avgSpread,
      tomatoMarkets: t.marketCount,
      petrol,
      diesel,
      fuelSpread: petrol - diesel,
      rainfallAvg: w.avg.PRECTOTCORR,
      tempMaxAvg: w.avg.T2M_MAX,
      tempMinAvg: w.avg.T2M_MIN,
      humidityAvg: w.avg.RH2M,
      windAvg: w.avg.WS2M,
      soilWetAvg: w.avg.GWETROOT,
      rainfallRange: w.range.PRECTOTCORR,
      tempMaxRange: w.range.T2M_MAX,
      humidityRange: w.range.RH2M,
    };
  });
}

function buildFeatureRows(rows, target) {
  const configs = {
    onion: { lags: [1, 7, 14, 30, 60], rolling: [7, 30, 60], otherLags: [1, 7, 14], label: "Onion" },
    tomato: { lags: [1, 3, 7, 14], rolling: [3, 7, 14], otherLags: [1, 3, 7], label: "Tomato" },
  };
  const cfg = configs[target];
  const other = target === "onion" ? "tomato" : "onion";
  const maxLag = Math.max(...cfg.lags, ...cfg.rolling, ...cfg.otherLags);
  const featureRows = [];
  for (let i = maxLag; i < rows.length; i += 1) {
    const current = rows[i];
    const month = getMonth(current.date);
    const features = [];
    cfg.lags.forEach((lag) => features.push(rows[i - lag][target]));
    cfg.rolling.forEach((win) => features.push(mean(rows.slice(i - win, i).map((r) => r[target]))));
    cfg.otherLags.forEach((lag) => features.push(rows[i - lag][other]));
    features.push(rows[i - 1].petrol, rows[i - 1].diesel, rows[i - 1].fuelSpread);
    features.push(current.rainfallAvg, current.tempMaxAvg, current.tempMinAvg, current.humidityAvg, current.windAvg, current.soilWetAvg);
    features.push(current.rainfallRange, current.tempMaxRange, current.humidityRange);
    features.push(getDayOfWeek(current.date), month, Math.sin((2 * Math.PI * month) / 12), Math.cos((2 * Math.PI * month) / 12));
    featureRows.push({ date: current.date, target: current[target], baseline: rows[i - 1][target], features });
  }
  return {
    featureRows,
    featureNames: [
      ...cfg.lags.map((lag) => `${cfg.label.toLowerCase()}_lag_${lag}`),
      ...cfg.rolling.map((win) => `${cfg.label.toLowerCase()}_rolling_${win}`),
      ...cfg.otherLags.map((lag) => `${other}_lag_${lag}`),
      "petrol_lag_1",
      "diesel_lag_1",
      "fuel_spread_lag_1",
      "rainfall_average",
      "temperature_max_average",
      "temperature_min_average",
      "humidity_average",
      "wind_average",
      "root_zone_soil_wetness_average",
      "rainfall_range",
      "temperature_range_between_cities",
      "humidity_range_between_cities",
      "day_of_week",
      "month_number",
      "month_sin",
      "month_cos",
    ],
  };
}

function fitModel(featureRows) {
  const split = Math.floor(featureRows.length * 0.8);
  const train = featureRows.slice(0, split);
  const test = featureRows.slice(split);
  const cv = crossValidateLambda(train, [0.1, 1, 3, 10, 30, 100]);
  const scaler = standardizeMatrix(train.map((r) => r.features));
  const trainX = scaler.transform(train.map((r) => r.features)).map((r) => [1, ...r]);
  const testX = scaler.transform(test.map((r) => r.features)).map((r) => [1, ...r]);
  const beta = ridgeFit(trainX, train.map((r) => r.target), cv.bestLambda);
  const predicted = predictRows(testX, beta);
  const actual = test.map((r) => r.target);
  const baseline = test.map((r) => r.baseline);
  const residuals = actual.map((v, i) => v - predicted[i]);
  return {
    bestLambda: cv.bestLambda,
    cvScores: cv.scores,
    trainCount: train.length,
    testCount: test.length,
    metrics: regressionMetrics(actual, predicted),
    baselineMetrics: regressionMetrics(actual, baseline),
    residualSummary: summarizeNumeric(residuals),
    preview: test.slice(0, 120).map((r, i) => ({
      date: r.date,
      actual: round(actual[i]),
      predicted: round(predicted[i]),
      baseline: round(baseline[i]),
      residual: round(residuals[i]),
    })),
    scaler,
    beta,
  };
}

function forecastFuture(rows, target, modelBundle, horizonDays = 14) {
  const configs = {
    onion: { lags: [1, 7, 14, 30, 60], rolling: [7, 30, 60], otherLags: [1, 7, 14] },
    tomato: { lags: [1, 3, 7, 14], rolling: [3, 7, 14], otherLags: [1, 3, 7] },
  };
  const cfg = configs[target];
  const other = target === "onion" ? "tomato" : "onion";
  const history = rows.map((r) => ({ ...r }));
  const recent = rows.slice(-7);
  const exo = {
    petrol: mean(recent.map((r) => r.petrol)),
    diesel: mean(recent.map((r) => r.diesel)),
    fuelSpread: mean(recent.map((r) => r.fuelSpread)),
    rainfallAvg: mean(recent.map((r) => r.rainfallAvg)),
    tempMaxAvg: mean(recent.map((r) => r.tempMaxAvg)),
    tempMinAvg: mean(recent.map((r) => r.tempMinAvg)),
    humidityAvg: mean(recent.map((r) => r.humidityAvg)),
    windAvg: mean(recent.map((r) => r.windAvg)),
    soilWetAvg: mean(recent.map((r) => r.soilWetAvg)),
    rainfallRange: mean(recent.map((r) => r.rainfallRange)),
    tempMaxRange: mean(recent.map((r) => r.tempMaxRange)),
    humidityRange: mean(recent.map((r) => r.humidityRange)),
  };
  const forecasts = [];
  for (let h = 1; h <= horizonDays; h += 1) {
    const lastDate = new Date(`${history[history.length - 1].date}T00:00:00Z`);
    lastDate.setUTCDate(lastDate.getUTCDate() + 1);
    const nextDate = lastDate.toISOString().slice(0, 10);
    const month = getMonth(nextDate);
    const features = [];
    cfg.lags.forEach((lag) => features.push(history[history.length - lag][target]));
    cfg.rolling.forEach((win) => features.push(mean(history.slice(-win).map((r) => r[target]))));
    cfg.otherLags.forEach((lag) => features.push(history[history.length - lag][other]));
    features.push(exo.petrol, exo.diesel, exo.fuelSpread, exo.rainfallAvg, exo.tempMaxAvg, exo.tempMinAvg, exo.humidityAvg, exo.windAvg, exo.soilWetAvg, exo.rainfallRange, exo.tempMaxRange, exo.humidityRange, getDayOfWeek(nextDate), month, Math.sin((2 * Math.PI * month) / 12), Math.cos((2 * Math.PI * month) / 12));
    const scaled = modelBundle.scaler.transform([features])[0];
    const prediction = [1, ...scaled].reduce((sum, value, idx) => sum + value * modelBundle.beta[idx], 0);
    const nextRow = { ...history[history.length - 1], date: nextDate, [target]: prediction };
    history.push(nextRow);
    forecasts.push({ date: nextDate, predicted: round(prediction) });
  }
  return forecasts;
}

function correlationMatrix(rows, target) {
  const labels = [
    target === "onion" ? "Onion price" : "Tomato price",
    target === "onion" ? "Tomato price" : "Onion price",
    "Mumbai petrol price",
    "Mumbai diesel price",
    "Average rainfall",
    "Average max temperature",
    "Average humidity",
    "Average wind speed",
    "Average root zone soil wetness",
  ];
  const other = target === "onion" ? "tomato" : "onion";
  const cols = [
    rows.map((r) => r[target]),
    rows.map((r) => r[other]),
    rows.map((r) => r.petrol),
    rows.map((r) => r.diesel),
    rows.map((r) => r.rainfallAvg),
    rows.map((r) => r.tempMaxAvg),
    rows.map((r) => r.humidityAvg),
    rows.map((r) => r.windAvg),
    rows.map((r) => r.soilWetAvg),
  ];
  return {
    labels,
    matrix: cols.map((x) =>
      cols.map((y) => {
        const xm = mean(x);
        const ym = mean(y);
        let num = 0;
        let xd = 0;
        let yd = 0;
        for (let i = 0; i < x.length; i += 1) {
          const dx = x[i] - xm;
          const dy = y[i] - ym;
          num += dx * dy;
          xd += dx * dx;
          yd += dy * dy;
        }
        return num / Math.sqrt(xd * yd);
      })
    ),
  };
}

function writeSvg(name, content) {
  fs.writeFileSync(path.join(CHART_DIR, name), content, "utf8");
}

function createArtifacts(rows, onionModel, tomatoModel, onionCorr, tomatoCorr, onionForecast, tomatoForecast) {
  const monthly = [...groupBy(rows, (r) => getYearMonth(r.date)).entries()]
    .map(([month, items]) => ({
      month,
      onion: mean(items.map((i) => i.onion)),
      tomato: mean(items.map((i) => i.tomato)),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const seasonality = Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => {
    const items = rows.filter((r) => getMonth(r.date) === month);
    return { monthName: monthName(month), onion: mean(items.map((i) => i.onion)), tomato: mean(items.map((i) => i.tomato)) };
  });
  writeSvg("combined_monthly_price_trend.svg", createLineChart({
    title: "Monthly Average Mandi Prices of Onion and Tomato Across Pune District Markets",
    xLabels: monthly.map((m) => m.month),
    series: [
      { name: "Onion average modal price", values: monthly.map((m) => round(m.onion)) },
      { name: "Tomato average modal price", values: monthly.map((m) => round(m.tomato)) },
    ],
    yLabel: "Average modal price in rupees per quintal",
  }));
  writeSvg("combined_monthly_seasonality.svg", createLineChart({
    title: "Calendar Month Seasonality in Onion and Tomato Prices Across the Study Period",
    xLabels: seasonality.map((s) => s.monthName),
    series: [
      { name: "Onion", values: seasonality.map((s) => round(s.onion)) },
      { name: "Tomato", values: seasonality.map((s) => round(s.tomato)) },
    ],
    yLabel: "Average modal price in rupees per quintal",
  }));
  writeSvg("onion_correlation_heatmap.svg", createHeatmap({ title: "Correlation Matrix for Onion Price and the Main Cross Commodity, Weather, and Fuel Drivers", labels: onionCorr.labels, matrix: onionCorr.matrix }));
  writeSvg("tomato_correlation_heatmap.svg", createHeatmap({ title: "Correlation Matrix for Tomato Price and the Main Cross Commodity, Weather, and Fuel Drivers", labels: tomatoCorr.labels, matrix: tomatoCorr.matrix }));
  writeSvg("onion_prediction_vs_actual.svg", createLineChart({
    title: "Holdout Test Period Performance of the Integrated Onion Price Prediction Model",
    xLabels: onionModel.preview.map((r) => r.date),
    series: [
      { name: "Actual onion price", values: onionModel.preview.map((r) => r.actual) },
      { name: "Predicted onion price", values: onionModel.preview.map((r) => r.predicted) },
      { name: "Lag one baseline", values: onionModel.preview.map((r) => r.baseline) },
    ],
    yLabel: "Onion average modal price in rupees per quintal",
  }));
  writeSvg("tomato_prediction_vs_actual.svg", createLineChart({
    title: "Holdout Test Period Performance of the Integrated Tomato Price Prediction Model",
    xLabels: tomatoModel.preview.map((r) => r.date),
    series: [
      { name: "Actual tomato price", values: tomatoModel.preview.map((r) => r.actual) },
      { name: "Predicted tomato price", values: tomatoModel.preview.map((r) => r.predicted) },
      { name: "Lag one baseline", values: tomatoModel.preview.map((r) => r.baseline) },
    ],
    yLabel: "Tomato average modal price in rupees per quintal",
  }));
  writeSvg("onion_diagnostic_scatter.svg", createScatterChart({
    title: "Diagnostic Scatter Plot of Actual Versus Predicted Onion Prices on the Holdout Test Data",
    points: onionModel.preview.map((r) => ({ x: r.actual, y: r.predicted })),
    xLabel: "Actual onion price",
    yLabel: "Predicted onion price",
  }));
  writeSvg("tomato_diagnostic_scatter.svg", createScatterChart({
    title: "Diagnostic Scatter Plot of Actual Versus Predicted Tomato Prices on the Holdout Test Data",
    points: tomatoModel.preview.map((r) => ({ x: r.actual, y: r.predicted })),
    xLabel: "Actual tomato price",
    yLabel: "Predicted tomato price",
  }));
  writeSvg("future_forecast_comparison.svg", createLineChart({
    title: "Fourteen Day Recursive Forecast for Onion and Tomato Prices After the Final Observed Date",
    xLabels: onionForecast.map((r) => r.date),
    series: [
      { name: "Forecasted onion price", values: onionForecast.map((r) => r.predicted) },
      { name: "Forecasted tomato price", values: tomatoForecast.map((r) => r.predicted) },
    ],
    yLabel: "Forecasted modal price in rupees per quintal",
  }));
}

function buildPrescriptive(onionForecast, tomatoForecast, latestRow) {
  const onionEnd = onionForecast[onionForecast.length - 1].predicted;
  const tomatoEnd = tomatoForecast[tomatoForecast.length - 1].predicted;
  return [
    onionEnd > latestRow.onion
      ? "Onion is forecasted to strengthen over the next two weeks, so traders with storage capacity can consider staggered release rather than immediate full liquidation."
      : "Onion is forecasted to soften over the next two weeks, so traders should consider faster release, especially if holding costs and shrinkage risk increase.",
    tomatoEnd > latestRow.tomato
      ? "Tomato is forecasted to improve modestly, but because it is highly perishable the recommendation is a short holding window only, with fast movement to market rather than long storage."
      : "Tomato is forecasted to weaken or remain fragile, so the prescriptive action is to prioritize immediate harvesting, sorting, and dispatch to reduce spoilage losses.",
    latestRow.rainfallAvg > 0
      ? "Current rainfall conditions suggest supply disruption risk; market arrivals and transport timing should be monitored daily."
      : "Current low rainfall conditions suggest transport friction is not the main constraint, so price planning can focus more on demand and arrivals.",
    latestRow.petrol > latestRow.diesel
      ? "Higher Mumbai fuel prices imply transport cost pressure, so grouping shipments and optimizing route density can help protect margins."
      : "Fuel cost pressure is moderate, so price strategy can focus more on market timing than logistics compression.",
  ];
}

function buildHtmlReport(summary) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Integrated Onion and Tomato Price Intelligence Report</title>
<style>
:root { --bg:#f8fafc; --card:#fff; --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --accent:#14532d; }
body { margin:0; font-family: Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#effcf4 0%,#f8fafc 34%); color:var(--ink); }
.wrap { max-width: 1240px; margin:0 auto; padding:30px 20px 48px; }
h1 { margin:0 0 10px; font-size:2.2rem; }
.lead { color:var(--muted); line-height:1.6; max-width:940px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:22px; margin-top:22px; box-shadow:0 12px 30px rgba(15,23,42,.06); }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; margin:18px 0 22px; }
.stats div { border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:#fff; }
.stats strong { display:block; margin-bottom:6px; }
.stats span { color:var(--accent); font-size:1.15rem; }
.grid { display:grid; grid-template-columns:1fr; gap:18px; }
img { width:100%; border:1px solid var(--line); border-radius:12px; background:#fff; }
ul, ol { line-height:1.6; }
@media (min-width: 960px) { .grid { grid-template-columns:1fr 1fr; } }
@media print { body { background:#fff; } .card { box-shadow:none; } }
</style></head><body><div class="wrap">
<h1>Integrated Onion and Tomato Mandi Price Intelligence Report</h1>
<p class="lead">This report combines Pune district onion and tomato mandi prices with nearby district weather information and Mumbai petrol and diesel prices. It covers descriptive analysis, exploratory analysis, correlation review, diagnostic analysis, predictive modeling, future forecasting, and prescriptive action guidance.</p>
<section class="card"><h2>Executive Summary</h2>
<div class="stats">
<div><strong>Integrated common dates</strong><span>${summary.commonDates}</span></div>
<div><strong>Onion model R2</strong><span>${summary.onion.metrics.r2}</span></div>
<div><strong>Onion model RMSE</strong><span>${summary.onion.metrics.rmse}</span></div>
<div><strong>Tomato model R2</strong><span>${summary.tomato.metrics.r2}</span></div>
<div><strong>Tomato model RMSE</strong><span>${summary.tomato.metrics.rmse}</span></div>
<div><strong>Onion CV lambda</strong><span>${summary.onion.bestLambda}</span></div>
<div><strong>Tomato CV lambda</strong><span>${summary.tomato.bestLambda}</span></div>
</div>
<ol>
<li>Onion uses longer lag windows because it is less perishable and retains temporal memory for longer periods.</li>
<li>Tomato uses shorter lag windows because the price reacts more quickly to fresh arrivals and spoilage pressure.</li>
<li>Ridge regression plus time-series cross-validation was used to control collinearity risk and test model robustness.</li>
</ol></section>
<section class="card"><h2>Exploratory Data Analysis</h2><div class="grid">
<img src="./charts/combined_monthly_price_trend.svg" alt="Combined trend chart" />
<img src="./charts/combined_monthly_seasonality.svg" alt="Combined seasonality chart" />
<img src="./charts/onion_correlation_heatmap.svg" alt="Onion correlation chart" />
<img src="./charts/tomato_correlation_heatmap.svg" alt="Tomato correlation chart" />
</div></section>
<section class="card"><h2>Model Diagnostics and Forecasting</h2><div class="grid">
<img src="./charts/onion_prediction_vs_actual.svg" alt="Onion predictive performance chart" />
<img src="./charts/tomato_prediction_vs_actual.svg" alt="Tomato predictive performance chart" />
<img src="./charts/onion_diagnostic_scatter.svg" alt="Onion diagnostic scatter" />
<img src="./charts/tomato_diagnostic_scatter.svg" alt="Tomato diagnostic scatter" />
<img src="./charts/future_forecast_comparison.svg" alt="Future forecast chart" />
</div></section>
<section class="card"><h2>Prescriptive Analysis</h2><ul>${summary.prescriptive.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul></section>
</div></body></html>`;
}

function buildMarkdownReport(summary) {
  return `# Integrated Onion and Tomato Mandi Price Intelligence Report

Generated on ${new Date().toISOString().slice(0, 10)}.

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

- Onion summary: ${JSON.stringify(summary.onion.descriptive)}
- Onion outliers: ${JSON.stringify(summary.onion.outliers)}
- Onion data quality: ${JSON.stringify(summary.onion.dataQuality)}
- Tomato summary: ${JSON.stringify(summary.tomato.descriptive)}
- Tomato outliers: ${JSON.stringify(summary.tomato.outliers)}
- Tomato data quality: ${JSON.stringify(summary.tomato.dataQuality)}

## Predictive analysis

- Onion model metrics: ${JSON.stringify(summary.onion.metrics)}
- Onion baseline metrics: ${JSON.stringify(summary.onion.baseline)}
- Tomato model metrics: ${JSON.stringify(summary.tomato.metrics)}
- Tomato baseline metrics: ${JSON.stringify(summary.tomato.baseline)}

## Prescriptive analysis

${summary.prescriptive.map((item) => `- ${item}`).join("\n")}
`;
}

function main() {
  const onion = loadCropDaily("Onion 2015-2025.csv", "Onion");
  const tomato = loadCropDaily("Tomato 2015-2025.csv", "Tomato");
  const weather = loadWeatherAggregate();
  const fuel = loadFuelSeries();
  const rows = buildIntegratedDataset(onion, tomato, weather, fuel);
  const onionFeatures = buildFeatureRows(rows, "onion");
  const tomatoFeatures = buildFeatureRows(rows, "tomato");
  const onionModel = fitModel(onionFeatures.featureRows);
  const tomatoModel = fitModel(tomatoFeatures.featureRows);
  const onionForecast = forecastFuture(rows, "onion", onionModel, 14);
  const tomatoForecast = forecastFuture(rows, "tomato", tomatoModel, 14);
  const onionCorr = correlationMatrix(rows, "onion");
  const tomatoCorr = correlationMatrix(rows, "tomato");
  createArtifacts(rows, onionModel, tomatoModel, onionCorr, tomatoCorr, onionForecast, tomatoForecast);

  const summary = {
    commonDates: rows.length,
    dateRange: { start: rows[0].date, end: rows[rows.length - 1].date },
    onion: {
      descriptive: summarizeNumeric(onion.raw.map((r) => r.modalPrice)),
      outliers: detectOutliers(onion.raw.map((r) => r.modalPrice)),
      dataQuality: {
        missingModal: onion.raw.filter((r) => !Number.isFinite(r.modalPrice)).length,
        duplicateRows: onion.raw.length - new Set(onion.raw.map((r) => `${r.date}|${r.market}|${r.modalPrice}|${r.minPrice}|${r.maxPrice}`)).size,
      },
      bestLambda: onionModel.bestLambda,
      trainCount: onionModel.trainCount,
      testCount: onionModel.testCount,
      metrics: onionModel.metrics,
      baseline: onionModel.baselineMetrics,
      residualSummary: onionModel.residualSummary,
      cvScores: onionModel.cvScores,
    },
    tomato: {
      descriptive: summarizeNumeric(tomato.raw.map((r) => r.modalPrice)),
      outliers: detectOutliers(tomato.raw.map((r) => r.modalPrice)),
      dataQuality: {
        missingModal: tomato.raw.filter((r) => !Number.isFinite(r.modalPrice)).length,
        duplicateRows: tomato.raw.length - new Set(tomato.raw.map((r) => `${r.date}|${r.market}|${r.modalPrice}|${r.minPrice}|${r.maxPrice}`)).size,
      },
      bestLambda: tomatoModel.bestLambda,
      trainCount: tomatoModel.trainCount,
      testCount: tomatoModel.testCount,
      metrics: tomatoModel.metrics,
      baseline: tomatoModel.baselineMetrics,
      residualSummary: tomatoModel.residualSummary,
      cvScores: tomatoModel.cvScores,
    },
    forecast: { onion: onionForecast, tomato: tomatoForecast },
    prescriptive: buildPrescriptive(onionForecast, tomatoForecast, rows[rows.length - 1]),
    filesUsed: { weather: weather.files },
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(path.join(OUTPUT_DIR, "analysis_report.md"), buildMarkdownReport(summary), "utf8");
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.html"), buildHtmlReport(summary), "utf8");
  fs.writeFileSync(path.join(OUTPUT_DIR, "presentation_data.json"), JSON.stringify({
    title: "Integrated Onion and Tomato Mandi Price Intelligence",
    summary,
    charts: {
      combinedTrend: path.join(CHART_DIR, "combined_monthly_price_trend.svg"),
      seasonality: path.join(CHART_DIR, "combined_monthly_seasonality.svg"),
      onionCorr: path.join(CHART_DIR, "onion_correlation_heatmap.svg"),
      tomatoCorr: path.join(CHART_DIR, "tomato_correlation_heatmap.svg"),
      onionPred: path.join(CHART_DIR, "onion_prediction_vs_actual.svg"),
      tomatoPred: path.join(CHART_DIR, "tomato_prediction_vs_actual.svg"),
      forecast: path.join(CHART_DIR, "future_forecast_comparison.svg"),
    },
  }, null, 2), "utf8");
  console.log(`Integrated mandi analysis completed. Outputs written to ${OUTPUT_DIR}`);
}

main();
