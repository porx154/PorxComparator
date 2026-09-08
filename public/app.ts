type Status = "identical" | "different" | "left-only" | "right-only";

type BrowserFileInfo = {
  relativePath: string;
  size: number;
  modifiedAt: string;
  file: File;
};

type FileSide = Omit<BrowserFileInfo, "file" | "relativePath"> | null;

type ComparisonRow = {
  relativePath: string;
  status: Status;
  left: FileSide;
  right: FileSide;
};

type ComparisonResult = {
  leftPath: string;
  rightPath: string;
  durationMs: number;
  summary: {
    totalLeft: number;
    totalRight: number;
    identical: number;
    different: number;
    leftOnly: number;
    rightOnly: number;
  };
  rows: ComparisonRow[];
  warnings: string[];
};

type SelectedFolder = {
  name: string;
  files: BrowserFileInfo[];
};

const form = document.querySelector<HTMLFormElement>("#compare-form")!;
const leftInput = document.querySelector<HTMLInputElement>("#left-folder")!;
const rightInput = document.querySelector<HTMLInputElement>("#right-folder")!;
const compareButton = document.querySelector<HTMLButtonElement>("#compare-button")!;
const spinner = compareButton.querySelector<HTMLElement>(".spinner-border")!;
const buttonLabel = compareButton.querySelector<HTMLElement>(".button-label")!;
const results = document.querySelector<HTMLElement>("#results")!;
const alertRegion = document.querySelector<HTMLElement>("#alert-region")!;
const body = document.querySelector<HTMLTableSectionElement>("#comparison-body")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const search = document.querySelector<HTMLInputElement>("#search")!;
const warnings = document.querySelector<HTMLElement>("#warnings")!;
const progressRegion = document.querySelector<HTMLElement>("#progress-region")!;
const progressBar = document.querySelector<HTMLElement>("#comparison-progress")!;
const progressLabel = document.querySelector<HTMLElement>("#progress-label")!;

let leftFolder: SelectedFolder | null = null;
let rightFolder: SelectedFolder | null = null;
let data: ComparisonResult | null = null;
let activeFilter: Status | "all" = "all";

leftInput.addEventListener("change", () => selectFolder("left", leftInput));
rightInput.addEventListener("change", () => selectFolder("right", rightInput));

document.querySelector<HTMLButtonElement>("#swap-button")!.addEventListener("click", () => {
  [leftFolder, rightFolder] = [rightFolder, leftFolder];
  leftInput.value = "";
  rightInput.value = "";
  resetComparison();
  renderFolderSelections();
});

document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter as Status | "all";
    renderRows();
  });
});

search.addEventListener("input", renderRows);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  alertRegion.replaceChildren();
  warnings.replaceChildren();

  if (!leftFolder || !rightFolder) {
    showAlert("Selecciona las dos carpetas antes de iniciar la comparación.", "danger");
    return;
  }

  data = null;
  results.classList.add("d-none");
  setLoading(true);
  updateProgress(0, Math.max(leftFolder.files.length, rightFolder.files.length), "Preparando la comparación…");

  try {
    const result = await compareFolders(leftFolder, rightFolder);
    data = result;
    resetFilters();
    updateSummary(result);
    renderRows();
    renderWarnings(result.warnings);
    results.classList.remove("d-none");
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "Ha ocurrido un error inesperado.", "danger");
  } finally {
    setLoading(false);
  }
});

function selectFolder(side: "left" | "right", input: HTMLInputElement): void {
  alertRegion.replaceChildren();
  const files = Array.from(input.files ?? []);
  if (!files.length) {
    if (side === "left") leftFolder = null;
    else rightFolder = null;
    resetComparison();
    renderFolderSelections();
    showAlert("La carpeta está vacía, no es accesible o no contiene ficheros seleccionables.", "danger");
    return;
  }

  const folder = createSelectedFolder(files);
  if (side === "left") leftFolder = folder;
  else rightFolder = folder;
  resetComparison();
  renderFolderSelections();
}

function createSelectedFolder(files: File[]): SelectedFolder {
  const firstPath = files[0]?.webkitRelativePath || files[0]?.name || "Carpeta";
  const rootName = firstPath.split(/[\\/]/)[0] || "Carpeta";
  const entries = files.map((file) => ({
    relativePath: getRelativePath(file),
    size: file.size,
    modifiedAt: new Date(file.lastModified).toISOString(),
    file,
  }));
  return { name: rootName, files: entries };
}

function getRelativePath(file: File): string {
  const path = file.webkitRelativePath || file.name;
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length > 1) parts.shift();
  return parts.join("/") || file.name;
}

function renderFolderSelections(): void {
  renderFolderSelection("left", leftFolder);
  renderFolderSelection("right", rightFolder);
  compareButton.disabled = !leftFolder || !rightFolder;
}

function renderFolderSelection(side: "left" | "right", folder: SelectedFolder | null): void {
  const name = document.querySelector<HTMLElement>(`#${side}-folder-name`)!;
  const detail = document.querySelector<HTMLElement>(`#${side}-folder-detail`)!;
  const picker = document.querySelector<HTMLElement>(`#${side}-picker`)!;
  name.textContent = folder?.name ?? "Seleccionar carpeta";
  detail.textContent = folder
    ? `${folder.files.length} ${folder.files.length === 1 ? "fichero" : "ficheros"}`
    : "Haz clic para elegirla en tu equipo";
  picker.classList.toggle("folder-selected", Boolean(folder));
}

function resetComparison(): void {
  data = null;
  results.classList.add("d-none");
  progressRegion.classList.add("d-none");
  warnings.replaceChildren();
  alertRegion.replaceChildren();
}

async function compareFolders(left: SelectedFolder, right: SelectedFolder): Promise<ComparisonResult> {
  const startedAt = performance.now();
  const comparisonWarnings: string[] = [];
  const leftFiles = createInventory(left.files, "Carpeta 1", comparisonWarnings);
  const rightFiles = createInventory(right.files, "Carpeta 2", comparisonWarnings);
  const keys = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" }),
  );
  const rows: ComparisonRow[] = [];

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const leftFile = leftFiles.get(key);
    const rightFile = rightFiles.get(key);
    let status: Status;

    if (!leftFile) status = "right-only";
    else if (!rightFile) status = "left-only";
    else if (leftFile.size !== rightFile.size) status = "different";
    else {
      try {
        const leftHash = await sha256(leftFile.file);
        const rightHash = await sha256(rightFile.file);
        status = leftHash === rightHash ? "identical" : "different";
      } catch (error) {
        status = "different";
        comparisonWarnings.push(
          `No se pudo calcular el hash de ${leftFile.relativePath}: ${error instanceof Error ? error.message : "error desconocido"}`,
        );
      }
    }

    rows.push({
      relativePath: leftFile?.relativePath ?? rightFile?.relativePath ?? key,
      status,
      left: publicInfo(leftFile),
      right: publicInfo(rightFile),
    });
    updateProgress(index + 1, keys.length, `Comparando ${index + 1} de ${keys.length} ficheros…`);
    if (index % 20 === 0) await nextFrame();
  }

  const count = (status: Status): number => rows.filter((row) => row.status === status).length;
  return {
    leftPath: left.name,
    rightPath: right.name,
    durationMs: Math.round(performance.now() - startedAt),
    summary: {
      totalLeft: leftFiles.size,
      totalRight: rightFiles.size,
      identical: count("identical"),
      different: count("different"),
      leftOnly: count("left-only"),
      rightOnly: count("right-only"),
    },
    rows,
    warnings: comparisonWarnings,
  };
}

function createInventory(
  files: BrowserFileInfo[],
  label: string,
  comparisonWarnings: string[],
): Map<string, BrowserFileInfo> {
  const inventory = new Map<string, BrowserFileInfo>();
  for (const file of files) {
    const key = normalizeKey(file.relativePath);
    if (inventory.has(key)) {
      comparisonWarnings.push(`${label}: se omitió una ruta duplicada por diferencias entre mayúsculas y minúsculas: ${file.relativePath}`);
      continue;
    }
    inventory.set(key, file);
  }
  return inventory;
}

function normalizeKey(relativePath: string): string {
  return relativePath.normalize("NFC").toLocaleLowerCase("es");
}

async function sha256(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("el navegador no permite usar SHA-256 en este contexto");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicInfo(file: BrowserFileInfo | undefined): FileSide {
  return file ? { size: file.size, modifiedAt: file.modifiedAt } : null;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function updateProgress(processed: number, total: number, label: string): void {
  const percentage = total ? Math.round((processed / total) * 100) : 0;
  progressRegion.classList.remove("d-none");
  progressBar.style.width = `${percentage}%`;
  progressBar.setAttribute("aria-valuenow", String(percentage));
  progressLabel.textContent = label;
}

function setLoading(loading: boolean): void {
  compareButton.disabled = loading || !leftFolder || !rightFolder;
  spinner.classList.toggle("d-none", !loading);
  buttonLabel.textContent = loading ? "Comparando…" : "Comparar carpetas";
  if (!loading) progressRegion.classList.add("d-none");
}

function resetFilters(): void {
  activeFilter = "all";
  search.value = "";
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === "all");
  });
}

function updateSummary(result: ComparisonResult): void {
  setText("#total-left", result.summary.totalLeft);
  setText("#total-right", result.summary.totalRight);
  setText("#total-identical", result.summary.identical);
  setText("#total-different", result.summary.different);
  setText("#total-missing", result.summary.leftOnly + result.summary.rightOnly);
  setText("#duration", `Completado en ${formatDuration(result.durationMs)}`);
}

function renderRows(): void {
  if (!data) return;
  const query = search.value.trim().toLocaleLowerCase("es");
  const filtered = data.rows.filter(
    (row) =>
      (activeFilter === "all" || row.status === activeFilter) &&
      row.relativePath.toLocaleLowerCase("es").includes(query),
  );

  const fragment = document.createDocumentFragment();
  for (const row of filtered) fragment.append(createRow(row));
  body.replaceChildren(fragment);
  emptyState.classList.toggle("d-none", filtered.length > 0);
  setText("#result-count", `${filtered.length} ${filtered.length === 1 ? "fichero" : "ficheros"}`);
}

function createRow(row: ComparisonRow): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = `status-${row.status}`;
  tr.append(fileCell(row.relativePath, row.left));
  tr.append(sizeCell(row.left));

  const status = document.createElement("td");
  status.className = "status-column text-center";
  const badge = document.createElement("span");
  badge.className = `status-badge badge-${row.status}`;
  badge.textContent = statusLabel(row.status);
  status.append(badge);
  tr.append(status);

  tr.append(fileCell(row.relativePath, row.right));
  tr.append(sizeCell(row.right));
  return tr;
}

function fileCell(relativePath: string, side: FileSide): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.className = `file-column ${side ? "" : "missing-cell"}`;
  if (!side) {
    cell.textContent = "— No existe —";
    return cell;
  }

  const parts = relativePath.split("/");
  const name = parts.pop() ?? relativePath;
  const folder = parts.join("/");
  const wrapper = document.createElement("div");
  wrapper.className = "file-entry";
  const icon = document.createElement("span");
  icon.className = "file-icon";
  icon.textContent = "▰";
  const labels = document.createElement("div");
  const filename = document.createElement("div");
  filename.className = "filename";
  filename.textContent = name;
  const pathLabel = document.createElement("div");
  pathLabel.className = "relative-path";
  pathLabel.textContent = folder || "Raíz";
  labels.append(filename, pathLabel);
  wrapper.append(icon, labels);
  cell.title = `${relativePath}\nModificado: ${new Date(side.modifiedAt).toLocaleString("es-ES")}`;
  cell.append(wrapper);
  return cell;
}

function sizeCell(side: FileSide): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.className = "size-column text-end font-monospace";
  cell.textContent = side ? formatBytes(side.size) : "—";
  return cell;
}

function statusLabel(status: Status): string {
  return {
    identical: "Igual",
    different: "Distinto",
    "left-only": "Solo C1",
    "right-only": "Solo C2",
  }[status];
}

function renderWarnings(items: string[]): void {
  if (!items.length) return;
  const alert = document.createElement("div");
  alert.className = "alert alert-warning";
  const title = document.createElement("strong");
  title.textContent = `${items.length} aviso${items.length === 1 ? "" : "s"} durante la lectura`;
  const list = document.createElement("ul");
  list.className = "mb-0 mt-2 small";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
  alert.append(title, list);
  warnings.append(alert);
}

function showAlert(message: string, type: "danger" | "success"): void {
  const alert = document.createElement("div");
  alert.className = `alert alert-${type} shadow-sm`;
  alert.textContent = message;
  alertRegion.replaceChildren(alert);
}

function setText(selector: string, value: string | number): void {
  document.querySelector<HTMLElement>(selector)!.textContent = String(value);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: exponent ? 1 : 0 }).format(value)} ${units[exponent]}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s`;
}

renderFolderSelections();
