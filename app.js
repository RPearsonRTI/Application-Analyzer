// Vanilla JS UI for the RTI Application Analysis API. No build step, no framework.

const form = document.getElementById("input-form");
const pumpSelect = document.getElementById("pump_model");
const statusEl = document.getElementById("status");

// Kept for the "Setting depth sensitivity" details panel, which re-posts /curves on demand.
let lastPayload = null;
let lastCurvesContext = null;

const NUMERIC_FIELDS = new Set([
  "pump_depth", "fluid_level", "flowline_pressure", "casing_pressure", "desired_rate",
  "viscosity_cp", "water_cut_pct", "gor_sm3_m3", "gas_through_annulus_pct",
  "reservoir_temp", "wellhead_temp", "alpha_override",
  "tubing_id_in", "tubing_od_in", "casing_id_in", "rod_od_in",
  "coupling_od_in", "dogleg_severity_deg_per_100ft", "rod_tubing_friction",
]);

// One door to the engine: the API server normally, or the in-browser engine (engine-browser.js, GitHub Pages
// build) when that script is on the page. Returns the parsed body or throws with the server's error detail.
const browserEngine = window.rtiBrowserEngine || null;
async function api(path, payload) {
  let status, body;
  if (browserEngine) {
    await browserEngine.ready;
    ({ status, body } = await browserEngine.call(path, payload));
  } else {
    const res = await fetch(path, payload === undefined ? undefined : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    status = res.status;
    body = await res.json().catch(() => ({}));
  }
  if (status < 200 || status >= 300) {
    throw new Error(body && body.detail ? JSON.stringify(body.detail) : `HTTP ${status}`);
  }
  return body;
}

async function loadCatalog() {
  const pumps = await api("/catalog");
  pumpSelect.innerHTML = "";
  for (const p of pumps) {
    const opt = document.createElement("option");
    opt.value = p.model;
    opt.textContent = `${p.model} (${p.series}, ${p.stages.toFixed(1)} stages, ${p.gal_per_rev} gal/rev)`;
    pumpSelect.appendChild(opt);
  }
  pumpSelect.value = "R200-1300";
}

function formToPayload() {
  const data = new FormData(form);
  const well = { pump_model: data.get("pump_model") };
  for (const [key, value] of data.entries()) {
    if (["pump_model", "location", "pad", "well_name", "alpha_override", "oil_api_gravity",
      "surface_earth_temp_c"].includes(key)) continue;
    if (key.startsWith("inflow_")) continue;
    well[key] = NUMERIC_FIELDS.has(key) && value !== "" ? Number(value) : value;
  }
  Object.assign(well, inflowPayload(data));
  const alphaRaw = data.get("alpha_override");
  const payload = {
    well,
    header: {
      location: data.get("location") || null,
      pad: data.get("pad") || null,
      well: data.get("well_name") || null,
    },
    alpha_override: alphaRaw ? Number(alphaRaw) : null,
    oil_api_gravity: num(data.get("oil_api_gravity")),
    options: { mode: data.get("engine_mode") || "parity" },
  };
  return payload;
}

const num = (v) => (v === null || v === "" ? null : Number(v));

// Inflow fields for the API (src/rti_app/inputs.py), from whichever inflow source is selected.
function inflowPayload(data) {
  const src = data.get("inflow_source");
  if (!src || src === "none") return {};
  const out = {
    inflow_reference_depth: num(data.get("inflow_reference_depth")),
    inflow_reference_depth_unit: data.get("inflow_reference_depth_unit"),
  };
  if (src === "points") {
    const pts = parseInflowPoints(data.get("inflow_points") || "");
    if (!pts) return {};
    return { ...out, inflow_rate: pts.rate, inflow_pressure: pts.pressure,
      inflow_rate_unit: data.get("inflow_rate_unit"), inflow_pressure_unit: data.get("inflow_pressure_unit") };
  }
  const tp = [], tq = [];
  for (const i of [1, 2]) {
    const p = num(data.get(`inflow_t${i}_p`)), q = num(data.get(`inflow_t${i}_q`));
    if (p !== null && q !== null) { tp.push(p); tq.push(q); }
  }
  return { ...out,
    inflow_reservoir_pressure: num(data.get("inflow_reservoir_pressure")),
    inflow_bubble_point: num(data.get("inflow_bubble_point")),
    inflow_reservoir_pressure_unit: data.get("inflow_reservoir_pressure_unit"),
    inflow_test_pressure: tp, inflow_test_pressure_unit: data.get("inflow_test_pressure_unit"),
    inflow_test_rate: tq, inflow_test_rate_unit: data.get("inflow_test_rate_unit"),
    inflow_productivity_index: num(data.get("inflow_productivity_index")),
    inflow_productivity_index_unit: data.get("inflow_productivity_index_unit") };
}

function showInflowBlocks() {
  const src = form.elements["inflow_source"].value;
  document.getElementById("inflow-test-block").hidden = src !== "test";
  document.getElementById("inflow-points-block").hidden = src !== "points";
  document.getElementById("inflow-ref-block").hidden = src === "none";
}

// Two numbers per line (tab, comma, semicolon or spaces between them); blank lines and a text header are skipped.
function parseInflowPoints(text) {
  const rate = [], pressure = [];
  for (const line of text.split(/\r?\n/)) {
    const nums = line.trim().split(/[\s,;]+/).filter((s) => s !== "").map(Number);
    if (nums.length >= 2 && nums.every((v) => Number.isFinite(v))) {
      rate.push(nums[0]);
      pressure.push(nums[1]);
    }
  }
  return rate.length ? { rate, pressure } : null;
}

function payloadToForm(payload) {
  const well = payload.well || {};
  for (const [key, value] of Object.entries(well)) {
    if (Array.isArray(value)) continue;
    const el = form.elements[key];
    if (el) el.value = value ?? "";
  }
  const r = well.inflow_rate || [], p = well.inflow_pressure || [];
  form.elements["inflow_points"].value = r.map((q, i) => `${q}\t${p[i]}`).join("\n");
  const tp = well.inflow_test_pressure || [], tq = well.inflow_test_rate || [];
  for (const i of [1, 2]) {
    form.elements[`inflow_t${i}_p`].value = tp[i - 1] ?? "";
    form.elements[`inflow_t${i}_q`].value = tq[i - 1] ?? "";
  }
  form.elements["inflow_source"].value = r.length ? "points" : (well.inflow_reservoir_pressure ? "test" : "none");
  showInflowBlocks();
  if (payload.header) {
    if (form.elements["location"]) form.elements["location"].value = payload.header.location || "";
    if (form.elements["pad"]) form.elements["pad"].value = payload.header.pad || "";
    if (form.elements["well_name"]) form.elements["well_name"].value = payload.header.well || "";
  }
  if (form.elements["alpha_override"]) {
    form.elements["alpha_override"].value = payload.alpha_override ?? "";
  }
  form.elements["oil_api_gravity"].value = payload.oil_api_gravity ?? "";
  if (form.elements["engine_mode"]) {
    form.elements["engine_mode"].value = payload.options?.mode || "parity";
  }
}

function fmt(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: digits });
}

const IMPERIAL_ROWS = [
  ["Pump model", "pump_model", 0],
  ["Water cut", "water_cut_frac", 3],
  ["Viscosity (cP)", "viscosity_cp", 2],
  ["GOR (sm3/m3)", "gor_sm3_m3", 1],
  ["Bottom-hole temp (F)", "bottom_hole_temp_f", 1],
  ["Pump depth (ft)", "pump_depth_ft", 1],
  ["Design rate (bpd)", "design_rate_bpd", 1],
  ["Tubing head pressure (psig)", "tubing_head_pressure_psig", 1],
  ["Casing head pressure (psig)", "casing_head_pressure_psig", 1],
  ["dP (psi)", "dp_psi", 2],
  ["Generated lift (ft)", "lift_ft", 1],
  ["Rate (bpd)", "rate_bpd", 1],
  ["RPM", "rpm", 1],
  ["Torque (ft.lb)", "torque_ftlb", 1],
  ["Pump share of torque (ft.lb)", "pump_torque_ftlb", 1],
  ["Rod-string share of torque (ft.lb)", "rod_torque_ftlb", 1],
  ["Rod top load (lbf)", "rod_axial_load_lbf", 0],
  ["Rod top stress (psi)", "rod_top_stress_psi", 0],
  ["Tubing friction in dP (psi)", "tubing_friction_psi", 1],
  ["Inlet GVF", "inlet_gvf", 4],
  ["Inlet pressure (psig)", "inlet_pressure_psig", 1],
  ["Inflow curve intake pressure (psig)", "inflow_intake_pressure_psig", 1],
  ["Fluid level from inflow curve (ft)", "inflow_fluid_level_ft", 0],
  ["Power (hp)", "power_hp", 2],
  ["Volumetric efficiency", "ve", 4],
];

const METRIC_ROWS = [
  ["Pump model", "pump_model", 0],
  ["Water cut", "water_cut_frac", 3],
  ["Viscosity (cP)", "viscosity_cp", 2],
  ["GOR (sm3/m3)", "gor_sm3_m3", 1],
  ["Bottom-hole temp (C)", "bottom_hole_temp_c", 1],
  ["Pump depth (m)", "pump_depth_m", 1],
  ["Design rate (m3/d)", "design_rate_m3d", 1],
  ["Tubing head pressure (kPa)", "tubing_head_pressure_kpa", 1],
  ["Casing head pressure (kPa)", "casing_head_pressure_kpa", 1],
  ["dP (kPa)", "dp_kpa", 2],
  ["Lift (m)", "lift_m", 1],
  ["Rate (m3/d)", "rate_m3d", 1],
  ["RPM", "rpm", 1],
  ["Torque (Nm)", "torque_nm", 1],
  ["Pump share of torque (Nm)", "pump_torque_nm", 1],
  ["Rod-string share of torque (Nm)", "rod_torque_nm", 1],
  ["Rod top load (kN)", "rod_axial_load_kn", 1],
  ["Rod top stress (MPa)", "rod_top_stress_mpa", 1],
  ["Tubing friction in dP (kPa)", "tubing_friction_kpa", 1],
  ["Inlet GVF", "inlet_gvf", 4],
  ["Inlet pressure (kPa)", "inlet_pressure_kpa", 1],
  ["Inflow curve intake pressure (kPa)", "inflow_intake_pressure_kpa", 1],
  ["Fluid level from inflow curve (m)", "inflow_fluid_level_m", 1],
  ["Power (kW)", "power_kw", 2],
  ["Volumetric efficiency", "ve", 4],
];

function renderTable(tableEl, report, rows) {
  tableEl.innerHTML = "";
  for (const [label, key, digits] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    const v = report[key];
    td.textContent = typeof v === "number" ? fmt(v, digits) : (v ?? "-");
    tr.appendChild(th);
    tr.appendChild(td);
    tableEl.appendChild(tr);
  }
}

const PLOTLY_CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] };

// Brand look for every chart (style.css tokens): Titillium Web, deep teal first, quiet grid.
const PLOT_AXIS = { gridcolor: "#e9ebe3", linecolor: "#c9cdbf", zerolinecolor: "#c9cdbf", automargin: true };
const PLOT_TEMPLATE = {
  layout: {
    font: { family: '"Titillium Web", "Segoe UI", system-ui, sans-serif', size: 13, color: "#2c2e29" },
    colorway: ["#053a3f", "#7c8a0c", "#2a78d6", "#eb6834", "#eda100", "#7a5cc2"],
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    title: { x: 0.02, xanchor: "left", font: { size: 15 } },
    xaxis: PLOT_AXIS,
    yaxis: PLOT_AXIS,
    margin: { t: 56, r: 24, b: 52, l: 64 },
    legend: { orientation: "h", x: 0, xanchor: "left", y: -0.22, yanchor: "top" },
  },
};

function plot(id, traces, layout, config) {
  return Plotly.newPlot(id, traces, { template: PLOT_TEMPLATE, ...layout }, config ?? PLOTLY_CONFIG);
}

// Headline numbers in the results band: [label, report key, unit, digits, multiplier].
const KPI_DEFS = {
  imperial: [
    ["Speed", "rpm", "RPM", 0], ["Torque", "torque_ftlb", "ft·lb", 0], ["Power", "power_hp", "hp", 1],
    ["Pump dP", "dp_psi", "psi", 0], ["Inlet GVF", "inlet_gvf", "%", 1, 100], ["Vol. efficiency", "ve", "%", 1, 100],
  ],
  metric: [
    ["Speed", "rpm", "RPM", 0], ["Torque", "torque_nm", "N·m", 0], ["Power", "power_kw", "kW", 1],
    ["Pump dP", "dp_kpa", "kPa", 0], ["Inlet GVF", "inlet_gvf", "%", 1, 100], ["Vol. efficiency", "ve", "%", 1, 100],
  ],
};
let lastReports = null;
let unitSystem = "imperial";
try { unitSystem = localStorage.getItem("rti-units") === "metric" ? "metric" : "imperial"; } catch (e) { /* no storage */ }

function renderKpis() {
  const el = document.getElementById("kpis");
  el.innerHTML = "";
  if (!lastReports) return;
  const report = lastReports[unitSystem];
  for (const [label, key, unit, digits, mult] of KPI_DEFS[unitSystem]) {
    const v = report[key];
    const tile = document.createElement("div");
    tile.className = "kpi";
    const text = typeof v === "number" && Number.isFinite(v) ? fmt(v * (mult ?? 1), digits) : "–";
    tile.innerHTML = `<div class="kpi-label">${label}</div><div class="kpi-value">${text}<span class="kpi-unit">${unit}</span></div>`;
    el.appendChild(tile);
  }
}

function setUnits(system) {
  unitSystem = system;
  try { localStorage.setItem("rti-units", system); } catch (e) { /* no storage */ }
  document.querySelectorAll("#unit-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.units === system));
  document.querySelectorAll(".report-col").forEach((c) => { c.hidden = c.dataset.units !== system; });
  renderKpis();
}

function nan2null(arr) {
  return arr.map((v) => (v === null || v === undefined || Number.isNaN(v) ? null : v));
}

// Operating-point guides for a single-curve chart: dashed lines from the curve at x0 across to the y axis and
// down to the x axis, a marker, and the value labelled at the y axis. y0 is read off the plotted curve (linear
// interpolation), so the lines always meet it. Returns { traces, layout } to merge into the plot.
function opGuides(xs, ys, x0, label) {
  let y0 = null;
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1], ya = ys[i], yb = ys[i + 1];
    if (ya == null || yb == null || a === b || Number.isNaN(ya) || Number.isNaN(yb)) continue;
    if ((x0 - a) * (x0 - b) <= 0) { y0 = ya + (yb - ya) * (x0 - a) / (b - a); break; }
  }
  if (y0 === null) return { traces: [], layout: {} };
  const xMin = Math.min(...xs.filter((v) => v != null && !Number.isNaN(v)));
  const yLow = Math.min(0, ...ys.filter((v) => v != null && !Number.isNaN(v)));
  const guide = { type: "line", line: { dash: "dash", color: "#52514e", width: 1 } };
  return {
    traces: [{ x: [x0], y: [y0], mode: "markers", name: "Operating point", showlegend: false,
      marker: { symbol: "diamond", size: 10, color: "#0b0b0b", line: { color: "#fff", width: 2 } },
      hovertemplate: `Operating point: %{y:,.${label.digits ?? 0}f} ${label.unit}<extra></extra>` }],
    layout: {
      shapes: [
        { ...guide, x0: xMin, x1: x0, y0, y1: y0 },
        { ...guide, x0, x1: x0, y0: yLow, y1: y0 },
      ],
      annotations: [{ x: xMin, y: y0, text: `${fmt(y0, label.digits ?? 0)} ${label.unit}`, showarrow: false,
        xanchor: "left", yanchor: "bottom", xshift: 4, font: { size: 11, color: "#0b0b0b" },
        bgcolor: "rgba(255,255,255,0.85)" }],
    },
  };
}

// A single-curve line chart with operating-point guides.
function singleCurve(id, x, y, x0, name, layout, label) {
  const g = opGuides(x, y, x0, label);
  plot(id, [{ x, y, mode: "lines", name }, ...g.traces], { ...layout, ...g.layout, showlegend: false },
    PLOTLY_CONFIG);
}

function maxOfDict(dict) {
  return Math.max(...Object.values(dict).flatMap((v) => v.filter((x) => !Number.isNaN(x))));
}

// --- Group 1: pump curve (docs/CHART_BASIS.md #1) — x = dP, inlet conditions frozen -------------

function renderPumpCurve(pumpCurve, op, useM3d) {
  const basis = pumpCurve.basis;
  document.getElementById("pump-curve-subtitle").textContent =
    `Held constant: inlet ${fmt(basis.inlet_pressure_psig, 0)} psig, ${fmt(basis.inlet_gvf * 100, 1)}% GVF, ` +
    `${fmt(basis.temperature_c, 1)} degC, ${basis.mode} mode.`;

  const rpmKeys = Object.keys(pumpCurve.flow_gpm);
  const flowDict = useM3d ? pumpCurve.flow_m3d : pumpCurve.flow_bpd;
  const flowUnit = useM3d ? "m3/d" : "bpd";
  // The API adds a curve at the operating speed (basis.operating_rpm); draw it dashed black so the
  // operating point sits on a real line. The marker is the true operating point, not a grid lookup.
  const opKey = rpmKeys.find((k) => basis.operating_rpm != null && Math.abs(Number(k) - basis.operating_rpm) < 1e-6);
  const rpmTrace = (dict, rpm) => (rpm === opKey
    ? { x: pumpCurve.dp_psi, y: dict[rpm], name: `${fmt(Number(rpm), 0)} RPM (operating)`, mode: "lines", line: { dash: "dash", color: "black" } }
    : { x: pumpCurve.dp_psi, y: dict[rpm], name: `${rpm} RPM`, mode: "lines" });
  const opFlow = op.liquid_rate_gpm * (useM3d ? 5.45099297 : 34.28571429); // units.M3D_PER_GPM / BPD_PER_GPM

  const flowTraces = rpmKeys.map((rpm) => rpmTrace(flowDict, rpm));
  flowTraces.push({
    x: [op.dp_psi], y: [opFlow],
    mode: "markers", name: "Operating point", marker: { symbol: "diamond", size: 11, color: "#0b0b0b", line: { color: "#fff", width: 2 } },
  });
  plot("chart-pump-flow", flowTraces, {
    title: `Liquid flow vs dP (${op.pump_model})`,
    xaxis: { title: "Differential pressure, dP (psi)" },
    yaxis: { title: `Flow (${flowUnit})` },
    shapes: [{ type: "line", x0: op.dp_psi, x1: op.dp_psi, y0: 0, y1: maxOfDict(flowDict), line: { dash: "dot", color: "black" } }],
  }, PLOTLY_CONFIG);

  singleCurve("chart-pump-torque", pumpCurve.dp_psi, pumpCurve.torque_ftlb, op.dp_psi, "Pump torque",
    { title: "Pump torque vs dP", xaxis: { title: "dP (psi)" }, yaxis: { title: "Torque (ft.lb)" } },
    { unit: "ft.lb" });

  const powerTraces = rpmKeys.map((rpm) => rpmTrace(pumpCurve.power_in_hp, rpm));
  plot("chart-pump-power", powerTraces, {
    title: "Input power vs dP", xaxis: { title: "dP (psi)" }, yaxis: { title: "Power in (hp)" },
    shapes: [{ type: "line", x0: op.dp_psi, x1: op.dp_psi, y0: 0, y1: maxOfDict(pumpCurve.power_in_hp), line: { dash: "dot", color: "black" } }],
  }, PLOTLY_CONFIG);

  const effTraces = rpmKeys.map((rpm) => ({ ...rpmTrace(pumpCurve.efficiency, rpm), y: nan2null(pumpCurve.efficiency[rpm]) }));
  plot("chart-pump-efficiency", effTraces, {
    title: "Efficiency vs dP", xaxis: { title: "dP (psi)" }, yaxis: { title: "Efficiency" },
    shapes: [{ type: "line", x0: op.dp_psi, x1: op.dp_psi, y0: 0, y1: 1, line: { dash: "dot", color: "black" } }],
  }, PLOTLY_CONFIG);

  renderStagePressures(op);
  renderWellbore(op);
}

// Staged gas model (physics mode): pressure at each seal line, intake to discharge (docs/DESIGN_staged_gas.md).
function renderStagePressures(op) {
  const el = document.getElementById("chart-pump-stages");
  const p = op.stage_pressures_psig;
  if (!p || p.length < 2) {
    Plotly.purge(el);
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  const n = p.length - 1;
  const seal = p.slice(1).map((v, i) => i + 1);
  const uniform = p.map((_, i) => p[0] + (p[n] - p[0]) * i / n);
  plot(el, [
    { x: [...p.keys()], y: p, mode: "lines+markers", name: "Staged model" },
    { x: [...p.keys()], y: uniform, mode: "lines", name: "Uniform (no gas)", line: { dash: "dot" } },
    { x: seal, y: seal.map((i) => p[i] - p[i - 1]), mode: "lines", name: "dP across seal", yaxis: "y2" },
  ], {
    title: `Pressure along the pump (${n} seal lines, inlet GVF ${fmt(op.inlet_gvf * 100, 1)}%)`,
    xaxis: { title: "Seal line from intake" },
    yaxis: { title: "Pressure (psig)" },
    yaxis2: { title: "dP across seal (psi)", overlaying: "y", side: "right" },
    legend: { x: 0.01, y: 0.99, bgcolor: "rgba(255,255,255,0.7)" },
  }, PLOTLY_CONFIG);
}

// Drift-flux wellbore (physics mode): pressure and liquid holdup down the tubing and the casing annulus
// (docs/DESIGN_wellbore_drift_flux.md). Depth increases downward.
function renderWellbore(op) {
  const el = document.getElementById("chart-wellbore");
  const tub = op.tubing_profile, ann = op.annulus_profile;
  if (!tub || !ann) {
    Plotly.purge(el);
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  const wetAnn = ann.filter((p) => p.regime !== "gas");
  const regimes = (pts) => [...new Set(pts.map((p) => p.regime))].join(" → ");
  const hover = (p) => `${fmt(p.depth_ft, 0)} ft<br>${fmt(p.pressure_psig, 1)} psig<br>holdup ${fmt(p.liquid_holdup, 2)}` +
    `<br>Vsg ${fmt(p.gas_velocity_m_s, 2)} m/s<br>${p.regime}`;
  plot(el, [
    { x: tub.map((p) => p.pressure_psig), y: tub.map((p) => p.depth_ft), mode: "lines", name: "Tubing pressure",
      text: tub.map(hover), hoverinfo: "text", line: { color: "#1f77b4" } },
    { x: ann.map((p) => p.pressure_psig), y: ann.map((p) => p.depth_ft), mode: "lines", name: "Casing annulus pressure",
      text: ann.map(hover), hoverinfo: "text", line: { color: "#d62728" } },
    { x: tub.map((p) => p.liquid_holdup), y: tub.map((p) => p.depth_ft), mode: "lines", name: "Tubing liquid holdup",
      xaxis: "x2", hoverinfo: "skip", line: { color: "#1f77b4", dash: "dot" } },
    { x: wetAnn.map((p) => p.liquid_holdup), y: wetAnn.map((p) => p.depth_ft), mode: "lines",
      name: "Annulus liquid holdup", xaxis: "x2", hoverinfo: "skip", line: { color: "#d62728", dash: "dot" } },
  ], {
    title: { text: `Wellbore columns (drift flux): tubing ${regimes(tub)}; annulus ${regimes(wetAnn)}`, y: 0.98 },
    height: 520,
    xaxis: { title: "Pressure (psig)" },
    xaxis2: { title: { text: "Liquid holdup (dotted)", standoff: 4 }, overlaying: "x", side: "top", range: [0, 1.05] },
    yaxis: { title: "Depth (ft)", autorange: "reversed" },
    legend: { orientation: "h", x: 0, y: -0.2 },
    margin: { t: 110, b: 110 },
  }, PLOTLY_CONFIG);
}

// --- Group 2: well drawdown (docs/CHART_BASIS.md #2) — x = fluid level from surface -------------

// With an inflow curve: rates stacked against RPM along the curve (2025-07-16 workbook chart).
function renderInflowRpm(ir, op, useMeters, useM3d) {
  const el = document.getElementById("chart-inflow-rpm");
  const rateUnit = useM3d ? "m3/d" : "bpd";
  const pick = (k) => (useM3d ? ir[`${k}_m3d`] : ir[`${k}_bpd`]);
  const liquid = pick("liquid"), gas = pick("gas_inlet"), slip = pick("slip"), disp = pick("displacement");
  const toRate = (gpm) => gpm * (useM3d ? 5.450992969 : 34.28571429);
  const levelUnit = useMeters ? "m" : "ft";
  const lvl = (ft) => (useMeters ? ft * 0.3048 : ft);
  const offRate = useM3d ? ir.pump_off_rate_bpd / 6.2898 : ir.pump_off_rate_bpd;
  document.getElementById("drawdown-subtitle").textContent = ir.rpm.length
    ? `Along the inflow curve: each point is a full solve at that liquid rate, with the intake pressure from the ` +
      `curve and the fluid level back-solved. Liquid + gas at intake + slip = pump displacement. The curve ends at ` +
      `pump-off (${fmt(offRate, 0)} ${rateUnit}), where the fluid level reaches the pump. Operating point: ` +
      `${fmt(op.rpm, 0)} RPM, fluid level ${fmt(lvl(op.fluid_level_ft), 0)} ${levelUnit}.`
    : (ir.warnings[0] || "No operating range on the inflow curve.");
  if (!ir.rpm.length) {
    Plotly.purge(el);
    el.style.display = "none";
    return;
  }

  // Colours: reference categorical slots 1, 2, 4 (blue, orange, yellow), stacked-area fills at ~45 % so the
  // bands stay distinct; slip also carries a 45-degree texture so it reads without colour.
  const C = { liquid: "#2a78d6", gas: "#eb6834", slip: "#eda100", ink: "#52514e", grid: "#e6e5e1", op: "#0b0b0b" };
  const fill = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
  const band = (name, y, color, extra = {}) => ({
    x: ir.rpm, y, name, stackgroup: "q", mode: "lines", line: { color, width: 2 }, fillcolor: fill(color, 0.45),
    hovertemplate: `${name}: %{y:.1f} ${rateUnit}<extra></extra>`, ...extra,
  });
  const xMax = Math.max(...ir.rpm);
  const opRate = toRate(op.liquid_rate_gpm);
  const last = ir.rpm.length - 1;
  const label = (y, text, color) => ({
    x: ir.rpm[last], y, xref: "x", yref: "y", text, showarrow: false, xanchor: "left", xshift: 6,
    font: { size: 12, color: C.ink }, bgcolor: "rgba(255,255,255,0.8)", bordercolor: color, borderwidth: 1,
  });
  const axis = { gridcolor: C.grid, zerolinecolor: C.grid, linecolor: "#bdbcb6", tickfont: { color: C.ink },
    titlefont: { color: C.ink } };

  plot(el, [
    band("Liquid", liquid, C.liquid),
    band("Gas at intake", gas, C.gas),
    band("Slip", slip, C.slip, { fillpattern: { shape: "/", fgcolor: fill(C.slip, 0.9), bgcolor: fill(C.slip, 0.3),
      size: 7, solidity: 0.25 } }),
    { x: ir.rpm, y: disp, name: "Displacement", mode: "lines", line: { color: C.ink, width: 1, dash: "dot" },
      hovertemplate: `Displacement: %{y:.1f} ${rateUnit}<extra></extra>`, showlegend: false },
    { x: ir.rpm, y: ir.intake_pressure_psig, name: "Intake pressure", mode: "lines", xaxis: "x", yaxis: "y2",
      line: { color: "#e34948", width: 2 }, showlegend: false,
      customdata: ir.fluid_level_ft.map((f, i) => [lvl(f), ir.inlet_gvf[i]]),
      hovertemplate: `Intake: %{y:.0f} psig, fluid level %{customdata[0]:.0f} ${levelUnit}, GVF %{customdata[1]:.2f}<extra></extra>` },
    { x: [op.rpm], y: [opRate], name: "Operating point", mode: "markers", showlegend: false,
      marker: { symbol: "diamond", size: 11, color: C.op, line: { color: "#fff", width: 2 } },
      hovertemplate: `Operating point: %{x:.0f} RPM, %{y:.1f} ${rateUnit}<extra></extra>` },
    { x: [op.rpm], y: [op.inlet_pressure_psig], mode: "markers", yaxis: "y2", showlegend: false,
      marker: { symbol: "diamond", size: 11, color: C.op, line: { color: "#fff", width: 2 } }, hoverinfo: "skip" },
  ], {
    title: { text: "Flow and intake pressure vs RPM along the inflow curve", x: 0, xanchor: "left", font: { size: 15 } },
    height: 620,
    hovermode: "x unified",
    plot_bgcolor: "#fcfcfb",
    paper_bgcolor: "#fff",
    xaxis: { ...axis, title: { text: "RPM" }, range: [0, xMax * 1.02], anchor: "y2" },
    yaxis: { ...axis, title: { text: `Flow (${rateUnit})` }, domain: [0.38, 1], rangemode: "tozero" },
    yaxis2: { ...axis, title: { text: "Intake (psig)" }, domain: [0, 0.28], rangemode: "tozero" },
    shapes: [
      { type: "line", xref: "x", yref: "paper", x0: op.rpm, x1: op.rpm, y0: 0, y1: 1,
        line: { color: C.op, width: 1, dash: "dot" } },
    ],
    annotations: [
      label(liquid[last] / 2, "Liquid", C.liquid),
      label(liquid[last] + gas[last] / 2, "Gas", C.gas),
      label(liquid[last] + gas[last] + slip[last] / 2, "Slip", C.slip),
      { x: op.rpm, y: 1, xref: "x", yref: "paper", text: `Operating point ${fmt(op.rpm, 0)} RPM`, showarrow: false,
        xanchor: "left", xshift: 4, yanchor: "bottom", font: { size: 11, color: C.ink } },
    ],
    legend: { orientation: "h", x: 0, y: 1.08, xanchor: "left", traceorder: "normal", font: { color: C.ink } },
    margin: { t: 90, r: 70, b: 50, l: 60 },
  }, PLOTLY_CONFIG);
}

function renderDrawdownCurve(drawdown, op, useMeters, useM3d, enteredFluidLevel) {
  const basis = drawdown.basis;
  const rateUnit = useM3d ? "m3/d" : "bpd";
  const desiredRate = useM3d ? basis.desired_rate_bpd / 6.2898 : basis.desired_rate_bpd;
  document.getElementById("drawdown-subtitle").textContent =
    `Held constant: pump depth ${fmt(basis.pump_depth_ft, 0)} ft, desired rate ${fmt(desiredRate, 1)} ${rateUnit}, ` +
    `fixed RPM ${fmt(basis.rpm_fixed, 0)} for the deliverable-rate trace, ${basis.mode} mode.`;

  const x = useMeters ? drawdown.fluid_level_m : drawdown.fluid_level_ft;
  const xUnit = useMeters ? "m" : "ft";
  const opLevelX = enteredFluidLevel ?? x[0];

  const xTitle = { title: `Fluid level from surface (${xUnit})` };
  singleCurve("chart-dd-rpm", x, nan2null(drawdown.required_rpm), opLevelX, "Required RPM",
    { title: "Required RPM vs fluid level", xaxis: xTitle, yaxis: { title: "RPM" } }, { unit: "RPM" });
  singleCurve("chart-dd-torque", x, nan2null(drawdown.torque_ftlb), opLevelX, "Torque",
    { title: "Required torque vs fluid level", xaxis: xTitle, yaxis: { title: "Torque (ft.lb)" } }, { unit: "ft.lb" });
  singleCurve("chart-dd-power", x, nan2null(drawdown.power_hp), opLevelX, "Power",
    { title: "Required power vs fluid level", xaxis: xTitle, yaxis: { title: "Power (hp)" } }, { unit: "hp", digits: 1 });
  singleCurve("chart-dd-gvf", x, nan2null(drawdown.inlet_gvf), opLevelX, "Inlet GVF",
    { title: "Inlet GVF vs fluid level", xaxis: xTitle, yaxis: { title: "Inlet GVF" } }, { unit: "", digits: 3 });
  const rateY = nan2null(useM3d ? drawdown.fixed_rpm_rate_m3d : drawdown.fixed_rpm_rate_bpd);
  singleCurve("chart-dd-rate", x, rateY, opLevelX, "Deliverable rate",
    { title: `Deliverable liquid rate vs fluid level (fixed ${fmt(basis.rpm_fixed, 0)} RPM)`, xaxis: xTitle,
      yaxis: { title: `Rate (${rateUnit})` } }, { unit: rateUnit, digits: 1 });
}

// --- Optional: setting-depth sensitivity (docs/CHART_BASIS.md, "hump" reference) -----------------

function renderSettingDepth(settingDepth, useMeters, useM3d) {
  const x = useMeters ? settingDepth.pump_depth_m : settingDepth.pump_depth_ft;
  const xUnit = useMeters ? "m" : "ft";
  const rateUnit = useM3d ? "m3/d" : "bpd";
  const rateDict = useM3d ? settingDepth.fixed_rpm_rate_m3d : settingDepth.fixed_rpm_rate_bpd;

  plot("chart-sd-rate", [{ x, y: nan2null(rateDict), mode: "lines", name: "Deliverable rate" }], {
    title: `Deliverable liquid rate vs pump depth (fixed ${fmt(settingDepth.basis.rpm_fixed, 0)} RPM)`,
    xaxis: { title: `Pump depth (${xUnit})` }, yaxis: { title: `Rate (${rateUnit})` },
  }, PLOTLY_CONFIG);

  plot("chart-sd-rpm", [{ x, y: nan2null(settingDepth.required_rpm), mode: "lines", name: "Required RPM" }], {
    title: "Required RPM vs pump depth", xaxis: { title: `Pump depth (${xUnit})` }, yaxis: { title: "RPM" },
  }, PLOTLY_CONFIG);
}

// --- Group 3: legacy workbook sweeps (no gas) -----------------------------------------------------

function renderLegacyCharts(curvesData, op) {
  const ls = curvesData.lift_sweep;
  const rs = curvesData.rpm_sweep;
  const rpms = Object.keys(ls.flow_bpd);
  const opLiftM = op.generated_lift_m;
  const opRpm = op.rpm;

  const flowTraces = rpms.map((rpm) => ({
    x: ls.lift_m, y: ls.flow_bpd[rpm], name: `${rpm} RPM`, mode: "lines",
  }));
  plot("chart-flow-lift", flowTraces, {
    title: "Flow vs Lift", xaxis: { title: "Lift (m)" }, yaxis: { title: "Flow (bpd)" },
    shapes: [{ type: "line", x0: opLiftM, x1: opLiftM, y0: 0, y1: Math.max(...ls.flow_bpd[rpms[rpms.length - 1]]), line: { dash: "dot", color: "black" } }],
  }, PLOTLY_CONFIG);

  singleCurve("chart-torque-lift", ls.lift_m, ls.torque_ftlb, opLiftM, "Torque",
    { title: "Torque vs Lift", xaxis: { title: "Lift (m)" }, yaxis: { title: "Torque (ft.lb)" } }, { unit: "ft.lb" });

  const powerTraces = [];
  for (const rpm of rpms) {
    powerTraces.push({ x: ls.lift_m, y: ls.power_in_hp[rpm], name: `Power in ${rpm} RPM`, mode: "lines" });
  }
  plot("chart-power-lift", powerTraces, {
    title: "Power vs Lift", xaxis: { title: "Lift (m)" }, yaxis: { title: "Power (hp)" },
  }, PLOTLY_CONFIG);

  const effTraces = rpms.map((rpm) => ({ x: ls.lift_m, y: ls.efficiency[rpm], name: `${rpm} RPM`, mode: "lines" }));
  plot("chart-efficiency-lift", effTraces, {
    title: "Efficiency vs Lift", xaxis: { title: "Lift (m)" }, yaxis: { title: "Efficiency" },
  }, PLOTLY_CONFIG);

  singleCurve("chart-flow-rpm", rs.rpm, rs.flow_bpd, opRpm, "Flow",
    { title: "Flow vs RPM", xaxis: { title: "RPM" }, yaxis: { title: "Flow (bpd)" } }, { unit: "bpd" });
}

function renderCharts(curvesData, op) {
  const rateUnitEl = form.elements["desired_rate_unit"];
  const fluidLevelUnitEl = form.elements["fluid_level_unit"];
  const useM3d = rateUnitEl ? rateUnitEl.value === "m3/d" : false;
  const useMeters = fluidLevelUnitEl ? fluidLevelUnitEl.value === "m" : false;
  const enteredFluidLevel = Number(form.elements["fluid_level"]?.value);

  renderPumpCurve(curvesData.pump_curve, op, useM3d);
  const ddIds = ["chart-dd-rpm", "chart-dd-torque", "chart-dd-power", "chart-dd-gvf", "chart-dd-rate"];
  const inflowEl = document.getElementById("chart-inflow-rpm");
  const sdEl = document.getElementById("setting-depth-details");
  if (curvesData.inflow_rpm) {
    ddIds.forEach((id) => { Plotly.purge(id); document.getElementById(id).style.display = "none"; });
    if (sdEl) sdEl.style.display = "none";
    inflowEl.style.display = "";
    renderInflowRpm(curvesData.inflow_rpm, op, useMeters, useM3d);
  } else {
    Plotly.purge(inflowEl);
    inflowEl.style.display = "none";
    ddIds.forEach((id) => { document.getElementById(id).style.display = ""; });
    if (sdEl) sdEl.style.display = "";
    renderDrawdownCurve(curvesData.drawdown, op, useMeters, useM3d, enteredFluidLevel);
  }
  renderLegacyCharts(curvesData, op);

  lastCurvesContext = { useMeters, useM3d };
}

async function postJson(url, payload) {
  return api(url, payload);
}

async function analyze(payload) {
  statusEl.textContent = "Running...";
  lastPayload = payload;
  try {
    const [analyzeResult, curvesResult] = await Promise.all([
      postJson("/analyze", payload),
      postJson("/curves", payload),
    ]);
    renderTable(document.getElementById("imperial-table"), analyzeResult.imperial_report, IMPERIAL_ROWS);
    renderTable(document.getElementById("metric-table"), analyzeResult.metric_report, METRIC_ROWS);
    const mode = payload.options?.mode || "parity";
    document.getElementById("results-mode").textContent = mode === "physics" ? "Physics mode" : "Workbook parity mode";
    document.getElementById("results-heading").textContent = analyzeResult.imperial_report.pump_model || "Results";
    const h = payload.header || {};
    document.getElementById("results-job").textContent = [h.location, h.pad, h.well].filter(Boolean).join(" · ");
    lastReports = { imperial: analyzeResult.imperial_report, metric: analyzeResult.metric_report };
    renderKpis();
    const warningsEl = document.getElementById("warnings-notice");
    const warnings = analyzeResult.warnings || [];
    if (warnings.length) {
      warningsEl.innerHTML = warnings.map((w) => `<div>${w}</div>`).join("");
      warningsEl.hidden = false;
    } else {
      warningsEl.innerHTML = "";
      warningsEl.hidden = true;
    }
    document.getElementById("chart-title").innerHTML =
      `<pre>${analyzeResult.chart_titles.imperial}</pre><pre>${analyzeResult.chart_titles.metric}</pre>`;
    renderCharts(curvesResult, analyzeResult.operating_point);
    statusEl.textContent = "Done.";
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  analyze(formToPayload());
});

document.getElementById("save-case").addEventListener("click", () => {
  const payload = formToPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "case.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("load-case").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  const payload = JSON.parse(text);
  payloadToForm(payload);
});

document.querySelectorAll("#unit-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => setUnits(btn.dataset.units));
});
setUnits(unitSystem);

// A required field inside a collapsed input group cannot show its validation message: open the group.
form.addEventListener("invalid", (ev) => {
  const group = ev.target.closest("details");
  if (group) group.open = true;
}, true);

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".chart-group").forEach((g) => g.classList.remove("active"));
    btn.classList.add("active");
    const shown = document.getElementById(btn.dataset.tab);
    shown.classList.add("active");
    // Plots drawn while their tab was hidden (display:none) size to 0 width; resize on reveal.
    shown.querySelectorAll(".chart").forEach((el) => {
      if (el.querySelector(".plot-container")) Plotly.Plots.resize(el);
    });
  });
});

document.getElementById("setting-depth-compute").addEventListener("click", async () => {
  const statusSpan = document.getElementById("setting-depth-status");
  if (!lastPayload) {
    statusSpan.textContent = "Run Analyze first.";
    return;
  }
  statusSpan.textContent = "Computing...";
  try {
    const pumpDepthFt = lastPayload.well.pump_depth_unit === "ft"
      ? lastPayload.well.pump_depth
      : lastPayload.well.pump_depth / 0.3048; // m -> ft, matches units.FT_PER_M
    const factors = [0.5, 0.68, 0.86, 1.04, 1.22, 1.40, 1.58, 1.76, 1.94, 2.12, 2.31, 2.5];
    const depthsFt = factors.map((f) => pumpDepthFt * f);
    const payload = { ...lastPayload, setting_depths_ft: depthsFt };
    const curvesResult = await postJson("/curves", payload);
    const useMeters = lastCurvesContext?.useMeters ?? false;
    const useM3d = lastCurvesContext?.useM3d ?? false;
    renderSettingDepth(curvesResult.setting_depth, useMeters, useM3d);
    statusSpan.textContent = "Done.";
  } catch (err) {
    statusSpan.textContent = `Error: ${err.message}`;
  }
});

// Estimate helper (src/rti_app/estimates.py): fills viscosity, wellhead temperature and annulus gas for review.
document.getElementById("estimate-btn").addEventListener("click", async () => {
  const note = document.getElementById("estimate-note");
  const payload = formToPayload();
  if (!payload.oil_api_gravity) {
    note.hidden = false;
    note.textContent = "Enter the oil API gravity first.";
    return;
  }
  try {
    const est = await postJson("/estimate", {
      well: payload.well, oil_api_gravity: payload.oil_api_gravity,
      surface_earth_temp_c: num(form.elements["surface_earth_temp_c"].value) ?? 10,
    });
    const set = (name, v, digits) => {
      const el = form.elements[name];
      el.value = Number(v.toFixed(digits));
      el.classList.add("estimated");
    };
    set("viscosity_cp", est.viscosity_cp, est.viscosity_cp < 10 ? 2 : 1);
    set("wellhead_temp", est.wellhead_temp, 0);
    set("gas_through_annulus_pct", est.gas_through_annulus_pct, 0);
    note.hidden = false;
    note.innerHTML = est.notes.map((n) => `<div>${n}</div>`).join("") +
      "<div>Estimated fields are outlined; click Analyze to use them.</div>";
  } catch (err) {
    note.hidden = false;
    note.textContent = `Estimate failed: ${err.message}`;
  }
});
for (const name of ["viscosity_cp", "wellhead_temp", "gas_through_annulus_pct"]) {
  form.elements[name].addEventListener("input", (ev) => ev.target.classList.remove("estimated"));
}

form.elements["inflow_source"].addEventListener("change", showInflowBlocks);
showInflowBlocks();
if (browserEngine) {
  // The first visit downloads the Python runtime (tens of MB); the browser caches it afterwards.
  const analyzeBtn = document.getElementById("analyze-btn");
  analyzeBtn.disabled = true;
  statusEl.textContent = "Loading the calculation engine…";
  browserEngine.setProgress((text) => { statusEl.textContent = text; });
  browserEngine.ready.then(() => { analyzeBtn.disabled = false; });
}
loadCatalog().then(() => analyze(formToPayload())).catch((err) => {
  statusEl.textContent = `Could not start: ${err.message}`;
});
