type Status = "identical" | "different" | "left-only" | "right-only";
type Side = "left" | "right";
type MessageType = "info" | "success" | "danger";
type LocalPermissionState = "granted" | "denied" | "prompt";

type LocalWritableFile = {
  write(data: Uint8Array | Blob | string): Promise<void>;
  close(): Promise<void>;
};

type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<LocalWritableFile>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<LocalPermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<LocalPermissionState>;
};

type LocalDirectoryHandle = {
  kind: "directory";
  name: string;
  values(): AsyncIterableIterator<LocalDirectoryHandle | LocalFileHandle>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<LocalDirectoryHandle>;
};

type BrowserFileInfo = {
  relativePath: string;
  size: number;
  modifiedAt: string;
  file: File;
  handle?: LocalFileHandle;
};

type ComparisonRow = {
  relativePath: string;
  status: Status;
  left: BrowserFileInfo | null;
  right: BrowserFileInfo | null;
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
  directWrite: boolean;
};

type TextEncoding = {
  kind: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
  bom: boolean;
  label: string;
};

type EditorDocument = {
  info: BrowserFileInfo;
  originalText: string;
  encoding: TextEncoding;
};

type EditorContext = {
  row: ComparisonRow;
  left: EditorDocument;
  right: EditorDocument;
};

const MAX_EDITABLE_BYTES = 8 * 1024 * 1024;

const form = document.querySelector<HTMLFormElement>("#compare-form")!;
const leftInput = document.querySelector<HTMLInputElement>("#left-folder")!;
const rightInput = document.querySelector<HTMLInputElement>("#right-folder")!;
const folderPickers: Record<Side, HTMLButtonElement> = {
  left: document.querySelector<HTMLButtonElement>("#left-picker")!,
  right: document.querySelector<HTMLButtonElement>("#right-picker")!,
};
const swapButton = document.querySelector<HTMLButtonElement>("#swap-button")!;
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

const editorOverlay = document.querySelector<HTMLElement>("#diff-editor")!;
const editorTitle = document.querySelector<HTMLElement>("#editor-title")!;
const editorComparisonStatus = document.querySelector<HTMLElement>("#editor-comparison-status")!;
const editorMessage = document.querySelector<HTMLElement>("#editor-message")!;
const differenceSummary = document.querySelector<HTMLElement>("#difference-summary")!;
const leftEditor = document.querySelector<HTMLTextAreaElement>("#editor-left")!;
const rightEditor = document.querySelector<HTMLTextAreaElement>("#editor-right")!;
const copyLeftToRight = document.querySelector<HTMLButtonElement>("#copy-left-to-right")!;
const copyRightToLeft = document.querySelector<HTMLButtonElement>("#copy-right-to-left")!;
const saveLeft = document.querySelector<HTMLButtonElement>("#save-left")!;
const saveRight = document.querySelector<HTMLButtonElement>("#save-right")!;

let leftFolder: SelectedFolder | null = null;
let rightFolder: SelectedFolder | null = null;
let data: ComparisonResult | null = null;
let activeFilter: Status | "all" = "all";
let editorContext: EditorContext | null = null;
let synchronizingScroll = false;

folderPickers.left.addEventListener("click", () => void chooseFolder("left"));
folderPickers.right.addEventListener("click", () => void chooseFolder("right"));
leftInput.addEventListener("change", () => selectFolderFromInput("left", leftInput));
rightInput.addEventListener("change", () => selectFolderFromInput("right", rightInput));

swapButton.addEventListener("click", () => {
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

document.querySelector<HTMLButtonElement>("#editor-close")!.addEventListener("click", () => closeEditor());
copyLeftToRight.addEventListener("click", () => {
  rightEditor.value = leftEditor.value;
  updateEditorState();
  rightEditor.focus();
});
copyRightToLeft.addEventListener("click", () => {
  leftEditor.value = rightEditor.value;
  updateEditorState();
  leftEditor.focus();
});
leftEditor.addEventListener("input", updateEditorState);
rightEditor.addEventListener("input", updateEditorState);
leftEditor.addEventListener("scroll", () => syncEditorScroll(leftEditor, rightEditor));
rightEditor.addEventListener("scroll", () => syncEditorScroll(rightEditor, leftEditor));
saveLeft.addEventListener("click", () => void saveEditorSide("left"));
saveRight.addEventListener("click", () => void saveEditorSide("right"));

document.addEventListener("keydown", (event) => {
  if (editorOverlay.classList.contains("d-none")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeEditor();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("es") === "s") {
    event.preventDefault();
    const side: Side = document.activeElement === rightEditor ? "right" : "left";
    void saveEditorSide(side);
  }
});

async function chooseFolder(side: Side): Promise<void> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    const input = side === "left" ? leftInput : rightInput;
    input.value = "";
    input.click();
    return;
  }

  setFolderPickerBusy(side, true);
  try {
    const handle = await picker.call(window, { mode: "read" });
    const files = await readDirectoryFiles(handle);
    if (!files.length) {
      setSelectedFolder(side, null);
      showAlert("La carpeta seleccionada está vacía o no contiene ficheros accesibles.", "danger");
      return;
    }
    setSelectedFolder(side, { name: handle.name, files, directWrite: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      showAlert(error instanceof Error ? error.message : "No se pudo leer la carpeta seleccionada.", "danger");
    }
  } finally {
    setFolderPickerBusy(side, false);
    renderFolderSelections();
  }
}

async function readDirectoryFiles(root: LocalDirectoryHandle): Promise<BrowserFileInfo[]> {
  const files: BrowserFileInfo[] = [];

  async function walk(directory: LocalDirectoryHandle, parentParts: string[]): Promise<void> {
    const entries: Array<LocalDirectoryHandle | LocalFileHandle> = [];
    for await (const entry of directory.values()) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));

    for (const entry of entries) {
      if (entry.kind === "directory") {
        await walk(entry, [...parentParts, entry.name]);
      } else {
        const file = await entry.getFile();
        files.push({
          relativePath: [...parentParts, entry.name].join("/"),
          size: file.size,
          modifiedAt: new Date(file.lastModified).toISOString(),
          file,
          handle: entry,
        });
      }
    }
  }

  await walk(root, []);
  return files;
}

function selectFolderFromInput(side: Side, input: HTMLInputElement): void {
  alertRegion.replaceChildren();
  const files = Array.from(input.files ?? []);
  if (!files.length) {
    setSelectedFolder(side, null);
    showAlert("La carpeta está vacía, no es accesible o no contiene ficheros seleccionables.", "danger");
    return;
  }

  setSelectedFolder(side, createSelectedFolder(files));
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
  return { name: rootName, files: entries, directWrite: false };
}

function getRelativePath(file: File): string {
  const path = file.webkitRelativePath || file.name;
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length > 1) parts.shift();
  return parts.join("/") || file.name;
}

function setSelectedFolder(side: Side, folder: SelectedFolder | null): void {
  if (side === "left") leftFolder = folder;
  else rightFolder = folder;
  resetComparison();
  renderFolderSelections();
}

function setFolderPickerBusy(side: Side, busy: boolean): void {
  folderPickers[side].disabled = busy;
  if (busy) {
    setText(`#${side}-folder-name`, "Leyendo carpeta…");
    setText(`#${side}-folder-detail`, "Preparando el inventario de ficheros");
  }
}

function renderFolderSelections(): void {
  renderFolderSelection("left", leftFolder);
  renderFolderSelection("right", rightFolder);
  compareButton.disabled = !leftFolder || !rightFolder;
}

function renderFolderSelection(side: Side, folder: SelectedFolder | null): void {
  const name = document.querySelector<HTMLElement>(`#${side}-folder-name`)!;
  const detail = document.querySelector<HTMLElement>(`#${side}-folder-detail`)!;
  const picker = folderPickers[side];
  if (picker.disabled) return;
  name.textContent = folder?.name ?? "Seleccionar carpeta";
  detail.textContent = folder
    ? `${folder.files.length} ${folder.files.length === 1 ? "fichero" : "ficheros"} · ${folder.directWrite ? "edición directa" : "guardado como copia"}`
    : "Haz clic para elegirla en tu equipo";
  picker.classList.toggle("folder-selected", Boolean(folder));
}

function resetComparison(): void {
  if (!editorOverlay.classList.contains("d-none")) closeEditor(true);
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
    const leftFile = leftFiles.get(key) ?? null;
    const rightFile = rightFiles.get(key) ?? null;
    const status = await compareFilePair(leftFile, rightFile, comparisonWarnings);

    rows.push({
      relativePath: leftFile?.relativePath ?? rightFile?.relativePath ?? key,
      status,
      left: leftFile,
      right: rightFile,
    });
    updateProgress(index + 1, keys.length, `Comparando ${index + 1} de ${keys.length} ficheros…`);
    if (index % 20 === 0) await nextFrame();
  }

  const result: ComparisonResult = {
    leftPath: left.name,
    rightPath: right.name,
    durationMs: Math.round(performance.now() - startedAt),
    summary: { totalLeft: leftFiles.size, totalRight: rightFiles.size, identical: 0, different: 0, leftOnly: 0, rightOnly: 0 },
    rows,
    warnings: comparisonWarnings,
  };
  recalculateSummary(result);
  return result;
}

async function compareFilePair(
  leftFile: BrowserFileInfo | null,
  rightFile: BrowserFileInfo | null,
  comparisonWarnings: string[] = [],
): Promise<Status> {
  if (!leftFile) return "right-only";
  if (!rightFile) return "left-only";
  if (leftFile.size !== rightFile.size) return "different";
  try {
    const leftHash = await sha256(leftFile.file);
    const rightHash = await sha256(rightFile.file);
    return leftHash === rightHash ? "identical" : "different";
  } catch (error) {
    comparisonWarnings.push(
      `No se pudo calcular el hash de ${leftFile.relativePath}: ${error instanceof Error ? error.message : "error desconocido"}`,
    );
    return "different";
  }
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
  folderPickers.left.disabled = loading;
  folderPickers.right.disabled = loading;
  swapButton.disabled = loading;
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

function recalculateSummary(result: ComparisonResult): void {
  result.summary.identical = result.rows.filter((row) => row.status === "identical").length;
  result.summary.different = result.rows.filter((row) => row.status === "different").length;
  result.summary.leftOnly = result.rows.filter((row) => row.status === "left-only").length;
  result.summary.rightOnly = result.rows.filter((row) => row.status === "right-only").length;
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
  if (row.status === "different" && row.left && row.right) {
    const hint = document.createElement("span");
    hint.className = "editor-row-hint";
    hint.textContent = "✎ Abrir editor";
    status.append(hint);
    tr.classList.add("is-editable");
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `Abrir editor para ${row.relativePath}`);
    tr.addEventListener("click", () => void openDiffEditor(row));
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void openDiffEditor(row);
      }
    });
  }
  tr.append(status);

  tr.append(fileCell(row.relativePath, row.right));
  tr.append(sizeCell(row.right));
  return tr;
}

function fileCell(relativePath: string, side: BrowserFileInfo | null): HTMLTableCellElement {
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

function sizeCell(side: BrowserFileInfo | null): HTMLTableCellElement {
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

async function openDiffEditor(row: ComparisonRow): Promise<void> {
  if (!row.left || !row.right || row.status !== "different") return;
  editorContext = null;
  editorTitle.textContent = row.relativePath;
  editorComparisonStatus.className = "status-badge badge-different";
  editorComparisonStatus.textContent = "Distinto";
  setText("#editor-left-name", row.relativePath);
  setText("#editor-right-name", row.relativePath);
  leftEditor.value = "";
  rightEditor.value = "";
  setEditorControlsDisabled(true);
  showEditorMessage("Leyendo los dos ficheros y detectando su codificación…", "info");
  editorOverlay.classList.remove("d-none");
  document.body.classList.add("editor-open");

  try {
    const [leftDocument, rightDocument] = await Promise.all([
      readEditorDocument(row.left),
      readEditorDocument(row.right),
    ]);
    editorContext = { row, left: leftDocument, right: rightDocument };
    leftEditor.value = leftDocument.originalText;
    rightEditor.value = rightDocument.originalText;
    configureEditorSide("left", leftDocument);
    configureEditorSide("right", rightDocument);
    setEditorControlsDisabled(false);
    showEditorMessage("Edita cualquiera de los lados o copia el contenido completo en una dirección.", "info");
    updateEditorState();
    leftEditor.focus();
  } catch (error) {
    closeEditor(true);
    showAlert(error instanceof Error ? error.message : "No se pudo abrir el editor.", "danger");
    alertRegion.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function readEditorDocument(info: BrowserFileInfo): Promise<EditorDocument> {
  if (info.size > MAX_EDITABLE_BYTES) {
    throw new Error(`No se puede editar ${info.relativePath}: supera el límite de ${formatBytes(MAX_EDITABLE_BYTES)} del editor.`);
  }
  const bytes = new Uint8Array(await info.file.arrayBuffer());
  const { text, encoding } = decodeText(bytes, info.relativePath);
  return { info, originalText: text, encoding };
}

function decodeText(bytes: Uint8Array, relativePath: string): { text: string; encoding: TextEncoding } {
  if (startsWithBytes(bytes, [0xef, 0xbb, 0xbf])) {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3)),
      encoding: { kind: "utf-8", bom: true, label: "UTF-8 con BOM" },
    };
  }
  if (startsWithBytes(bytes, [0xff, 0xfe])) {
    return {
      text: new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2)),
      encoding: { kind: "utf-16le", bom: true, label: "UTF-16 LE" },
    };
  }
  if (startsWithBytes(bytes, [0xfe, 0xff])) {
    return {
      text: new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2)),
      encoding: { kind: "utf-16be", bom: true, label: "UTF-16 BE" },
    };
  }

  const utf16 = detectUtf16WithoutBom(bytes);
  if (utf16) {
    return {
      text: new TextDecoder(utf16, { fatal: true }).decode(bytes),
      encoding: {
        kind: utf16,
        bom: false,
        label: utf16 === "utf-16le" ? "UTF-16 LE (sin BOM)" : "UTF-16 BE (sin BOM)",
      },
    };
  }
  if (isLikelyBinary(bytes)) {
    throw new Error(`${relativePath} parece ser un fichero binario y no puede editarse como texto.`);
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const ascii = bytes.every((byte) => byte < 0x80);
    return {
      text,
      encoding: { kind: "utf-8", bom: false, label: ascii ? "ASCII / UTF-8" : "UTF-8" },
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      encoding: { kind: "windows-1252", bom: false, label: "ANSI (Windows-1252)" },
    };
  }
}

function startsWithBytes(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function detectUtf16WithoutBom(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const pairs = Math.min(Math.floor(bytes.length / 2), 2048);
  if (pairs < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index < pairs * 2; index += 2) {
    if (bytes[index] === 0) evenZeros += 1;
    if (bytes[index + 1] === 0) oddZeros += 1;
  }
  if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.1) return "utf-16le";
  if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.1) return "utf-16be";
  return null;
}

function isLikelyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.some((byte) => byte === 0)) return true;
  let controls = 0;
  for (const byte of sample) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) controls += 1;
  }
  return sample.length > 0 && controls / sample.length > 0.05;
}

function configureEditorSide(side: Side, documentInfo: EditorDocument): void {
  setText(`#editor-${side}-encoding`, documentInfo.encoding.label);
  setText(`#editor-${side}-meta`, `${formatBytes(documentInfo.info.size)} · ${lineCount(documentInfo.originalText)} líneas`);
  const saveButton = side === "left" ? saveLeft : saveRight;
  saveButton.textContent = documentInfo.info.handle
    ? side === "left" ? "Guardar izquierda" : "Guardar derecha"
    : side === "left" ? "Descargar izquierda" : "Descargar derecha";
}

function setEditorControlsDisabled(disabled: boolean): void {
  leftEditor.disabled = disabled;
  rightEditor.disabled = disabled;
  copyLeftToRight.disabled = disabled;
  copyRightToLeft.disabled = disabled;
  saveLeft.disabled = disabled;
  saveRight.disabled = disabled;
}

function updateEditorState(): void {
  if (!editorContext) return;
  const leftDirty = leftEditor.value !== editorContext.left.originalText;
  const rightDirty = rightEditor.value !== editorContext.right.originalText;
  updateDirtyBadge("left", leftDirty);
  updateDirtyBadge("right", rightDirty);
  saveLeft.disabled = !leftDirty;
  saveRight.disabled = !rightDirty;
  copyLeftToRight.disabled = leftEditor.value === rightEditor.value;
  copyRightToLeft.disabled = leftEditor.value === rightEditor.value;
  setText("#editor-left-encoding", visibleEncoding(editorContext.left.encoding, leftEditor.value));
  setText("#editor-right-encoding", visibleEncoding(editorContext.right.encoding, rightEditor.value));
  setText("#editor-left-meta", `${formatBytes(new TextEncoder().encode(leftEditor.value).byteLength)} aprox. · ${lineCount(leftEditor.value)} líneas`);
  setText("#editor-right-meta", `${formatBytes(new TextEncoder().encode(rightEditor.value).byteLength)} aprox. · ${lineCount(rightEditor.value)} líneas`);

  const differingLines = countDifferingLines(leftEditor.value, rightEditor.value);
  differenceSummary.textContent = differingLines === 0
    ? "El contenido de ambos editores es idéntico"
    : `${differingLines} ${differingLines === 1 ? "línea no coincide" : "líneas no coinciden"}`;
}

function updateDirtyBadge(side: Side, dirty: boolean): void {
  const badge = document.querySelector<HTMLElement>(`#editor-${side}-state`)!;
  badge.textContent = dirty ? "Sin guardar" : "Sin cambios";
  badge.classList.toggle("is-dirty", dirty);
}

function visibleEncoding(encoding: TextEncoding, text: string): string {
  if (encoding.label === "ASCII / UTF-8" && /[^\x00-\x7f]/.test(text)) return "UTF-8 al guardar";
  return encoding.label;
}

function lineCount(text: string): number {
  return text.length ? text.replace(/\r\n?/g, "\n").split("\n").length : 0;
}

function countDifferingLines(leftText: string, rightText: string): number {
  const leftLines = leftText.length ? leftText.replace(/\r\n?/g, "\n").split("\n") : [];
  const rightLines = rightText.length ? rightText.replace(/\r\n?/g, "\n").split("\n") : [];
  const total = Math.max(leftLines.length, rightLines.length);
  let differences = 0;
  for (let index = 0; index < total; index += 1) {
    if (leftLines[index] !== rightLines[index]) differences += 1;
  }
  return differences;
}

function syncEditorScroll(source: HTMLTextAreaElement, target: HTMLTextAreaElement): void {
  if (synchronizingScroll) return;
  synchronizingScroll = true;
  const sourceVerticalRange = source.scrollHeight - source.clientHeight;
  const targetVerticalRange = target.scrollHeight - target.clientHeight;
  const sourceHorizontalRange = source.scrollWidth - source.clientWidth;
  const targetHorizontalRange = target.scrollWidth - target.clientWidth;
  target.scrollTop = sourceVerticalRange > 0 ? (source.scrollTop / sourceVerticalRange) * targetVerticalRange : 0;
  target.scrollLeft = sourceHorizontalRange > 0 ? (source.scrollLeft / sourceHorizontalRange) * targetHorizontalRange : 0;
  requestAnimationFrame(() => { synchronizingScroll = false; });
}

async function saveEditorSide(side: Side): Promise<void> {
  if (!editorContext) return;
  const documentInfo = editorContext[side];
  const editor = side === "left" ? leftEditor : rightEditor;
  const saveButton = side === "left" ? saveLeft : saveRight;
  if (editor.value === documentInfo.originalText) return;

  saveButton.disabled = true;
  showEditorMessage("Preparando el contenido para guardar…", "info");
  try {
    const bytes = encodeText(editor.value, documentInfo.encoding);
    if (documentInfo.encoding.label === "ASCII / UTF-8" && /[^\x00-\x7f]/.test(editor.value)) {
      documentInfo.encoding.label = "UTF-8";
    }
    if (documentInfo.info.handle) {
      const permission = await requestWritePermission(documentInfo.info.handle);
      if (permission === "denied") throw new Error("El navegador no concedió permiso para modificar este fichero.");
      const writable = await documentInfo.info.handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      const refreshedFile = await documentInfo.info.handle.getFile();
      documentInfo.info.file = refreshedFile;
      documentInfo.info.size = refreshedFile.size;
      documentInfo.info.modifiedAt = new Date(refreshedFile.lastModified).toISOString();
      documentInfo.originalText = editor.value;
      showEditorMessage(`${documentInfo.info.relativePath} se guardó en la carpeta ${side === "left" ? "1" : "2"}.`, "success");
      await refreshEditedRow(editorContext.row);
    } else {
      downloadEditedFile(bytes, documentInfo.info.file.name);
      documentInfo.originalText = editor.value;
      showEditorMessage("El navegador no permite sobrescribir esa selección: se descargó una copia editada.", "success");
    }
    configureEditorSide(side, documentInfo);
    updateEditorState();
  } catch (error) {
    showEditorMessage(error instanceof Error ? error.message : "No se pudo guardar el fichero.", "danger");
    updateEditorState();
  }
}

async function requestWritePermission(handle: LocalFileHandle): Promise<LocalPermissionState> {
  if (handle.requestPermission) return handle.requestPermission({ mode: "readwrite" });
  if (handle.queryPermission) return handle.queryPermission({ mode: "readwrite" });
  return "granted";
}

function encodeText(text: string, encoding: TextEncoding): Uint8Array {
  if (encoding.kind === "utf-8") {
    const content = new TextEncoder().encode(text);
    return encoding.bom ? prependBytes([0xef, 0xbb, 0xbf], content) : content;
  }
  if (encoding.kind === "utf-16le" || encoding.kind === "utf-16be") {
    return encodeUtf16(text, encoding.kind === "utf-16le", encoding.bom);
  }
  return encodeWindows1252(text);
}

function prependBytes(prefix: number[], content: Uint8Array): Uint8Array {
  const result = new Uint8Array(prefix.length + content.length);
  result.set(prefix);
  result.set(content, prefix.length);
  return result;
}

function encodeUtf16(text: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const offset = bom ? 2 : 0;
  const result = new Uint8Array(offset + text.length * 2);
  if (bom) {
    result[0] = littleEndian ? 0xff : 0xfe;
    result[1] = littleEndian ? 0xfe : 0xff;
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const position = offset + index * 2;
    result[position] = littleEndian ? code & 0xff : code >> 8;
    result[position + 1] = littleEndian ? code >> 8 : code & 0xff;
  }
  return result;
}

const windows1252Characters = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function encodeWindows1252(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else if (windows1252Characters.has(code)) bytes.push(windows1252Characters.get(code)!);
    else throw new Error(`El carácter “${character}” no puede guardarse en ANSI (Windows-1252).`);
  }
  return Uint8Array.from(bytes);
}

function downloadEditedFile(bytes: Uint8Array, fileName: string): void {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refreshEditedRow(row: ComparisonRow): Promise<void> {
  row.status = await compareFilePair(row.left, row.right);
  if (data) {
    recalculateSummary(data);
    updateSummary(data);
    renderRows();
  }
  editorComparisonStatus.className = `status-badge badge-${row.status}`;
  editorComparisonStatus.textContent = statusLabel(row.status);
}

function showEditorMessage(message: string, type: MessageType): void {
  editorMessage.textContent = message;
  editorMessage.className = `editor-message message-${type}`;
}

function closeEditor(force = false): void {
  if (!force && editorContext) {
    const hasChanges = leftEditor.value !== editorContext.left.originalText || rightEditor.value !== editorContext.right.originalText;
    if (hasChanges && !window.confirm("Hay cambios sin guardar. ¿Quieres cerrar el editor igualmente?")) return;
  }
  editorOverlay.classList.add("d-none");
  document.body.classList.remove("editor-open");
  editorContext = null;
  leftEditor.value = "";
  rightEditor.value = "";
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
