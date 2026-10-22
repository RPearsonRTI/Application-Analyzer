// Printable report of the last analysis. It is a page view inside the app: the browser's own Print dialog
// turns it into paper or a PDF, so it works the same on the server, the offline app and the browser-only site.
// Loaded after app.js and uses its globals (lastRun, unitSystem, fmt, setUnits, caseFileName).

const reportBtn = document.getElementById("report-btn");
const reportView = document.getElementById("report-view");
const reportSheet = document.getElementById("report-sheet");

const UNIT_TEXT = { C: "°C", F: "°F", "m3/d": "m³/d", "sm3/m3": "sm³/m³", "deg/100 ft": "°/100 ft" };
const unitText = (u) => UNIT_TEXT[u] ?? u ?? "";
const pct = (x) => `${fmt(x * 100, 0)}%`;
const SOURCE_TEXT = { given: "Entered", user_assumed: "Assumed by user", estimated: "Estimated", assumed: "Assumed" };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function tableOf(headers, rows, cls) {
  const table = el("table", `data-table ${cls || ""}`.trim());
  if (headers) {
    const tr = el("tr");
    headers.forEach((h) => tr.appendChild(el("th", null, h)));
    table.appendChild(el("thead")).appendChild(tr);
  }
  const body = table.appendChild(el("tbody"));
  for (const cells of rows) {
    const tr = el("tr");
    for (const cell of cells) {
      const [content, cellCls] = Array.isArray(cell) ? cell : [cell];
      const td = el("td", cellCls);
      td.append(content ?? "");
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  return table;
}

function section(title) {
  const s = el("section", "report-section");
  s.appendChild(el("h2", null, title));
  return s;
}

const sourceTag = (source) => el("span", `tag ${source}`, SOURCE_TEXT[source]);

// Result rows: [label, [imperial key, unit], [metric key, unit], digits, multiplier, note].
// A row whose value is missing (rod loads and tubing friction outside physics mode) is left out.
function resultGroups(run) {
  const op = run.result.operating_point;
  const rep = run.result[unitSystem === "metric" ? "metric_report" : "imperial_report"];
  const imp = run.result.imperial_report;
  const hasRods = rep.rod_torque_ftlb != null || rep.rod_torque_nm != null;
  const levelSource = (run.resolved.inputs.find((i) => i.field === "fluid_level") || {}).source;
  const torqueNote = [
    op.headline_is_design ? "design value, for a liquid-filled tubing" : "running value",
    hasRods ? "at the polished rod (pump and rod string)" : "pump only; the rod string is not included",
  ].join("; ");
  return [
    ["Pump", [
      ["Stages", ["stages", ""], ["stages", ""], 1],
      ["Displacement", ["displacement_bpd_per_100rpm", "bpd per 100 RPM"], ["displacement_m3d_per_100rpm", "m³/d per 100 RPM"], 0],
      ["Speed", ["rpm", "RPM"], ["rpm", "RPM"], 0, 1,
        imp.speed_loading > 0 ? `${pct(imp.speed_loading)} of the rated maximum of ${fmt(imp.rpm / imp.speed_loading, 0)} RPM` : ""],
      ["Liquid rate", ["rate_bpd", "bpd"], ["rate_m3d", "m³/d"], 1],
      ["Differential pressure", ["dp_psi", "psi"], ["dp_kpa", "kPa"], 0],
      ["Differential pressure per stage", ["dp_per_stage_psi", "psi"], ["dp_per_stage_kpa", "kPa"], 1, 1,
        imp.pressure_loading > 0 ? `${pct(imp.pressure_loading)} of the rating of ${fmt(imp.dp_per_stage_psi / imp.pressure_loading, 0)} psi per stage` : ""],
      ["Volumetric efficiency", ["ve", "%"], ["ve", "%"], 1, 100],
      ["Overall efficiency", ["overall_efficiency", "%"], ["overall_efficiency", "%"], 1, 100, "hydraulic power over shaft power"],
    ]],
    ["Well", [
      ["Intake pressure", ["inlet_pressure_psig", "psig"], ["inlet_pressure_kpa", "kPa"], 0],
      ["Discharge pressure", ["discharge_pressure_psig", "psig"], ["discharge_pressure_kpa", "kPa"], 0],
      ["Fluid level from surface", ["fluid_level_ft", "ft"], ["fluid_level_m", "m"], 0, 1,
        imp.inflow_intake_pressure_psig != null ? "calculated from the well inflow data"
          : (levelSource === "user_assumed" ? "assumed by the user" : "as entered")],
      ["Submergence", ["submergence_ft", "ft"], ["submergence_m", "m"], 0],
      ["Free gas at the intake", ["inlet_gvf", "% by volume"], ["inlet_gvf", "% by volume"], 1, 100],
      ["Flow losses in the tubing", ["tubing_friction_psi", "psi"], ["tubing_friction_kpa", "kPa"], 1, 1, "included in the differential pressure"],
    ]],
    ["Loads and power", [
      ["Torque", ["torque_ftlb", "ft·lb"], ["torque_nm", "N·m"], 0, 1, torqueNote],
      ["Pump share of torque", ["pump_torque_ftlb", "ft·lb"], ["pump_torque_nm", "N·m"], 0],
      ["Rod string share of torque", ["rod_torque_ftlb", "ft·lb"], ["rod_torque_nm", "N·m"], 0],
      ["Power", ["power_hp", "hp"], ["power_kw", "kW"], 1, 1,
        `${hasRods ? "at the polished rod" : "at the pump"}; drivehead and motor losses are not included`],
      ["Hydraulic power", ["hydraulic_power_hp", "hp"], ["hydraulic_power_kw", "kW"], 1],
      ["Rod axial load at surface", ["rod_axial_load_lbf", "lbf"], ["rod_axial_load_kn", "kN"], unitSystem === "metric" ? 1 : 0, 1, "carried by the drivehead"],
      ["Rod stress at surface", ["rod_top_stress_psi", "psi"], ["rod_top_stress_mpa", "MPa"], unitSystem === "metric" ? 1 : 0, 1,
        "axial load and torque combined (von Mises)"],
    ]],
  ].map(([title, rows]) => [title, rows.map(([label, i, m, digits, mult, note]) => {
    const [key, unit] = unitSystem === "metric" ? m : i;
    const v = rep[key];
    return typeof v === "number" && Number.isFinite(v) ? [label, `${fmt(v * (mult ?? 1), digits)} ${unit}`.trim(), note || ""] : null;
  }).filter(Boolean)]);
}

// The well inflow data, in a sentence (it is entered as a block, not as tracked inputs).
function inflowText(well) {
  const ref = well.inflow_reference_depth != null
    ? ` Pressures given at ${fmt(well.inflow_reference_depth, 1)} ${unitText(well.inflow_reference_depth_unit)}.` : "";
  if (Array.isArray(well.inflow_rate) && well.inflow_rate.length) {
    const pts = well.inflow_rate.map((q, k) => `${fmt(q, 1)} at ${fmt(well.inflow_pressure[k], 0)}`).join("; ");
    return `Pressure–rate points (${unitText(well.inflow_rate_unit)} at ${unitText(well.inflow_pressure_unit)}): ${pts}.${ref}`;
  }
  if (well.inflow_reservoir_pressure == null) return null;
  const parts = [`static reservoir pressure ${fmt(well.inflow_reservoir_pressure, 0)} ${unitText(well.inflow_reservoir_pressure_unit)}`];
  if (well.inflow_bubble_point != null) parts.push(`bubble point ${fmt(well.inflow_bubble_point, 0)} ${unitText(well.inflow_reservoir_pressure_unit)}`);
  (well.inflow_test_rate || []).forEach((q, k) => parts.push(
    `test ${k + 1}: ${fmt(q, 1)} ${unitText(well.inflow_test_rate_unit)} at ${fmt(well.inflow_test_pressure[k], 0)} ${unitText(well.inflow_test_pressure_unit)}`));
  if (well.inflow_productivity_index != null) parts.push(`productivity index ${fmt(well.inflow_productivity_index, 3)} ${unitText(well.inflow_productivity_index_unit)}`);
  return `Reservoir data: ${parts.join(", ")}.${ref}`;
}

// Vector copies of the charts on the page (drawn for the same run), at a fixed size so they print the same from
// any window. Charts are in the units of the inputs.
const REPORT_CHARTS = [
  ["chart-pump-flow", 560, 400], ["chart-pump-torque", 560, 400], ["chart-pump-power", 560, 400],
  ["chart-pump-efficiency", 560, 400], ["chart-inflow-rpm", 1120, 760, true], ["chart-wellbore", 1120, 460, true],
];

async function chartImages() {
  const out = [];
  for (const [id, width, height, wide] of REPORT_CHARTS) {
    const gd = document.getElementById(id);
    if (!gd || !gd.data || !gd.data.length) continue;
    const layout = { ...gd.layout };
    const legend = gd._fullLayout.showlegend ? gd._fullLayout.legend : null;
    if (legend && legend.y < 0) {                       // at this size a legend under the plot needs more room
      layout.legend = { ...(gd.layout.legend || {}), orientation: "h", x: 0, xanchor: "left", y: -0.34, yanchor: "top" };
    }
    try {
      const url = await Plotly.toImage({ data: gd.data, layout }, { format: "svg", width, height });
      out.push({ svg: decodeURIComponent(url.slice(url.indexOf(",") + 1)), width, height, wide: Boolean(wide) });
    } catch (err) { /* a chart that cannot be drawn is left out */ }
  }
  return out;
}

function buildReport(run, images) {
  const rep = run.result[unitSystem === "metric" ? "metric_report" : "imperial_report"];
  const payload = run.payload;
  const header = payload.header || {};
  const mode = payload.options?.mode === "physics" ? "Physics model" : "Excel analyzer model";
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  reportSheet.innerHTML = "";

  const top = reportSheet.appendChild(el("header", "report-head"));
  const logo = top.appendChild(el("img"));
  logo.src = "img/rotoliptic-logo.png";
  logo.alt = "Rotoliptic";
  const title = top.appendChild(el("div", "report-title"));
  title.appendChild(el("h1", null, "Application Analysis"));
  title.appendChild(el("p", null, today));

  const job = reportSheet.appendChild(el("dl", "report-job"));
  for (const [label, value] of [["Location", header.location], ["Pad", header.pad], ["Well", header.well],
    ["Pump", run.design ? `${rep.pump_model} (not yet built)` : rep.pump_model]]) {
    const item = job.appendChild(el("div"));
    item.appendChild(el("dt", null, label));
    item.appendChild(el("dd", null, value || "–"));
  }

  const kpis = reportSheet.appendChild(el("div", "report-kpis"));
  for (const [label, key, unit, digits, mult, loadKey] of KPI_DEFS[unitSystem]) {
    const v = rep[key];
    const tile = kpis.appendChild(el("div", "report-kpi"));
    tile.appendChild(el("div", "report-kpi-label", label));
    const value = tile.appendChild(el("div", "report-kpi-value", typeof v === "number" ? fmt(v * (mult ?? 1), digits) : "–"));
    value.appendChild(el("span", null, ` ${unit}`));
    const load = loadKey ? rep[loadKey] : null;
    if (typeof load === "number" && load > 0) {
      tile.appendChild(el("div", `report-kpi-note${load > 1 ? " over" : ""}`, `${pct(load)} of rating${load > 1 ? ", over" : ""}`));
    }
  }

  if (run.design) {
    const d = run.design;
    const s = reportSheet.appendChild(section("Pump design"));
    s.appendChild(el("p", "report-flag",
      `${d.name} is a new design that has not been built or tested: ${fmt(d.displacement_m3d_per_100rpm, 1)} m³/d per 100 RPM, ` +
      `${fmt(d.stages, 1)} stages in ${fmt(d.length_in, 0)} in, stator outside diameter ${fmt(d.stator_od_in, 2)} in. ` +
      "Its performance is scaled from tested Rotoliptic pumps and carries more uncertainty than a catalog pump."));
  }

  const warnings = run.result.warnings || [];
  if (warnings.length) {
    const s = reportSheet.appendChild(section("Warnings"));
    const list = s.appendChild(el("ul", "report-warnings"));
    warnings.forEach((w) => list.appendChild(el("li", null, w)));
  }

  const results = reportSheet.appendChild(section("Predicted operating point"));
  const groups = resultGroups(run);
  for (const [groupTitle, rows] of groups) {
    if (!rows.length) continue;
    const group = results.appendChild(el("div", "report-group"));
    group.appendChild(el("h3", null, groupTitle));
    group.appendChild(tableOf(null, rows.map(([label, value, note]) => [label, [value, "num"], [note, "basis"]]), "report-results"));
  }
  if (payload.options?.mode !== "physics") {
    results.appendChild(el("p", "report-note",
      "Rod string loads and tubing flow losses are calculated by the Physics model only and are not part of this report."));
  }

  const inputs = reportSheet.appendChild(section("Inputs"));
  const well = payload.well;
  const inputRows = [["Pump model", [rep.pump_model, "num"], sourceTag("given")]];
  for (const i of run.resolved.inputs) {
    inputRows.push([i.label, [`${fmt(i.value, 4)} ${unitText(i.unit)}`.trim(), "num"], sourceTag(i.source)]);
  }
  if (payload.oil_api_gravity != null) inputRows.push(["Oil API gravity", [`${fmt(payload.oil_api_gravity, 1)} °API`, "num"], sourceTag("given")]);
  if (payload.alpha_override != null) inputRows.push(["Pump slip coefficient override", [fmt(payload.alpha_override, 3), "num"], sourceTag("given")]);
  // Two columns of inputs keep the section to half a page.
  const half = Math.ceil(inputRows.length / 2);
  const cols = inputs.appendChild(el("div", "report-columns"));
  cols.appendChild(tableOf(["Input", "Value", "Source"], inputRows.slice(0, half), "report-inputs"));
  cols.appendChild(tableOf(["Input", "Value", "Source"], inputRows.slice(half), "report-inputs"));
  const inflow = inflowText(well);
  if (inflow) inputs.appendChild(el("p", "report-note", `Well inflow. ${inflow}`));

  const notGiven = run.resolved.inputs.filter((i) => i.source !== "given");
  const assumptions = reportSheet.appendChild(section("Assumptions"));
  if (notGiven.length) {
    const nUser = notGiven.filter((i) => i.source === "user_assumed").length;
    const nAuto = notGiven.length - nUser;
    const parts = [];
    if (nAuto) parts.push(`${nAuto} ${nAuto === 1 ? "was" : "were"} filled in by the software from the other inputs`);
    if (nUser) parts.push(`${nUser} ${nUser === 1 ? "was" : "were"} entered as the user's own assumption`);
    assumptions.appendChild(el("p", "report-note",
      `Of the ${run.resolved.inputs.length} well inputs, ${parts.join(" and ")}. Each one is listed with its basis.`));
    // One block per input: the case-specific basis beside the value, the general method and its limits beneath.
    const table = assumptions.appendChild(tableOf(["Input", "Value", "Source", "Basis"], [], "report-assumptions"));
    table.querySelector("tbody").remove();
    for (const i of notGiven) {
      const body = table.appendChild(el("tbody"));
      const tr = body.appendChild(el("tr"));
      tr.appendChild(el("td", null, i.label));
      tr.appendChild(el("td", "num", `${fmt(i.value, 4)} ${unitText(i.unit)}`.trim()));
      tr.appendChild(el("td")).appendChild(sourceTag(i.source));
      tr.appendChild(el("td", "basis", i.basis));
      if (i.source !== "user_assumed" && i.rule) {
        const rule = body.appendChild(el("tr", "report-rule")).appendChild(el("td", null, `Method and limits: ${i.rule}`));
        rule.colSpan = 4;
      }
    }
  } else {
    assumptions.appendChild(el("p", "report-note", "Every well input was entered as known data; nothing was estimated or assumed."));
  }
  (run.resolved.notes || []).forEach((n) => assumptions.appendChild(el("p", "report-note", n)));
  assumptions.appendChild(el("p", "report-disclaimer",
    "This report is a performance prediction for the inputs listed above. Inputs marked Estimated or Assumed were not " +
    "supplied as known data, and the results change if the real values differ. Estimates come from published " +
    "correlations and typical defaults; they are a starting point when data is missing, not a substitute for measured " +
    "well data. The prediction is not a guarantee of field performance."));

  if (images.length) {
    const charts = reportSheet.appendChild(section("Charts"));
    charts.classList.add("report-charts");
    const caption = document.getElementById("pump-curve-subtitle").textContent;
    if (caption) charts.appendChild(el("p", "report-note", `Pump curves. ${caption}`));
    const grid = charts.appendChild(el("div", "report-chart-grid"));
    for (const image of images) {
      const holder = grid.appendChild(el("div", image.wide ? "report-chart wide" : "report-chart"));
      holder.innerHTML = image.svg;                     // Plotly's own SVG export, inline so it uses the page fonts
      const svg = holder.querySelector("svg");
      svg.setAttribute("viewBox", `0 0 ${image.width} ${image.height}`);
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.removeAttribute("style");
    }
  }

  reportSheet.appendChild(el("footer", "report-foot",
    `Rotoliptic Application Analyzer · ${mode} · ${today}`));
}

let reportImages = [];
let pageTitle = document.title;

async function openReport() {
  if (!lastRun) return;
  reportBtn.disabled = true;
  statusEl.textContent = "Building the report...";
  try {
    reportImages = lastRun.chartsReady ? await chartImages() : [];      // taken while the charts are still on screen
    buildReport(lastRun, reportImages);
    pageTitle = document.title;
    document.title = caseFileName(lastRun.payload).replace(/\.json$/, "") + " - report";   // the PDF's default name
    document.body.classList.add("report-open");
    reportView.hidden = false;
    window.scrollTo(0, 0);
    statusEl.textContent = "Done.";
  } catch (err) {
    statusEl.textContent = `Could not build the report: ${err.message}`;
  } finally {
    reportBtn.disabled = false;
  }
}

function closeReport() {
  document.body.classList.remove("report-open");
  reportView.hidden = true;
  document.title = pageTitle;
  window.dispatchEvent(new Event("resize"));          // the charts were hidden; let them size themselves again
}

reportBtn.addEventListener("click", openReport);
document.getElementById("report-close").addEventListener("click", closeReport);
document.getElementById("report-print").addEventListener("click", () => window.print());
document.querySelectorAll("#report-units button").forEach((btn) => {
  btn.addEventListener("click", () => {
    setUnits(btn.dataset.units);
    if (lastRun) buildReport(lastRun, reportImages);
  });
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !reportView.hidden) closeReport();
});
