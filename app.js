"use strict";

const canvas = document.getElementById("artboard");
const ctx = canvas.getContext("2d");

const els = {
  tools: Array.from(document.querySelectorAll(".tool")),
  layers: document.getElementById("layers"),
  imageFile: document.getElementById("imageFile"),
  projectFile: document.getElementById("projectFile"),
  newDoc: document.getElementById("newDoc"),
  openProject: document.getElementById("openProject"),
  importImage: document.getElementById("importImage"),
  saveProject: document.getElementById("saveProject"),
  exportImage: document.getElementById("exportImage"),
  exportFormat: document.getElementById("exportFormat"),
  undoBtn: document.getElementById("undoBtn"),
  redoBtn: document.getElementById("redoBtn"),
  canvasWidth: document.getElementById("canvasWidth"),
  canvasHeight: document.getElementById("canvasHeight"),
  resizeCanvas: document.getElementById("resizeCanvas"),
  zoomRange: document.getElementById("zoomRange"),
  fitCanvas: document.getElementById("fitCanvas"),
  strokeColor: document.getElementById("strokeColor"),
  fillColor: document.getElementById("fillColor"),
  fillEnabled: document.getElementById("fillEnabled"),
  strokeWidth: document.getElementById("strokeWidth"),
  strokeWidthRange: document.getElementById("strokeWidthRange"),
  opacity: document.getElementById("opacity"),
  fontSize: document.getElementById("fontSize"),
  addTextBox: document.getElementById("addTextBox"),
  textValue: document.getElementById("textValue"),
  backgroundColor: document.getElementById("backgroundColor"),
  transparentCanvas: document.getElementById("transparentCanvas"),
  moveLayerUp: document.getElementById("moveLayerUp"),
  moveLayerDown: document.getElementById("moveLayerDown"),
  duplicateLayer: document.getElementById("duplicateLayer"),
  deleteLayer: document.getElementById("deleteLayer"),
  stageWrap: document.getElementById("stageWrap")
};

const state = {
  version: 1,
  tool: "select",
  objects: [],
  selectedId: null,
  background: "#ffffff",
  transparent: false,
  zoom: 0.75,
  style: {
    stroke: "#111111",
    fill: "#f97316",
    fillEnabled: false,
    strokeWidth: 4,
    opacity: 1,
    fontSize: 42,
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  },
  gesture: null,
  history: [],
  future: [],
  clipboard: null,
  dirtyTextEdit: false
};

let nextId = 0;
const imageCache = new Map();

function uid() {
  nextId += 1;
  return `o${nextId}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshot() {
  return JSON.stringify({
    version: state.version,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      background: state.background,
      transparent: state.transparent
    },
    objects: state.objects,
    selectedId: state.selectedId
  });
}

function restore(serialized) {
  const data = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  const savedCanvas = data.canvas || {};
  canvas.width = clampInt(savedCanvas.width || 1280, 64, 8192);
  canvas.height = clampInt(savedCanvas.height || 720, 64, 8192);
  state.background = savedCanvas.background || "#ffffff";
  state.transparent = Boolean(savedCanvas.transparent);
  state.objects = Array.isArray(data.objects) ? data.objects : [];
  state.selectedId = data.selectedId || null;
  nextId = state.objects.reduce((max, object) => {
    const numeric = Number(String(object.id || "").replace(/\D/g, ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, nextId);
  preloadImages();
  syncControlsFromState();
  render();
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 80) {
    state.history.shift();
  }
  state.future = [];
  updateHistoryButtons();
}

function undo() {
  if (!state.history.length) {
    return;
  }
  state.future.push(snapshot());
  restore(state.history.pop());
  updateHistoryButtons();
}

function redo() {
  if (!state.future.length) {
    return;
  }
  state.history.push(snapshot());
  restore(state.future.pop());
  updateHistoryButtons();
}

function updateHistoryButtons() {
  els.undoBtn.disabled = state.history.length === 0;
  els.redoBtn.disabled = state.future.length === 0;
}

function clamp(number, min, max) {
  return Math.min(max, Math.max(min, number));
}

function clampInt(number, min, max) {
  return Math.round(clamp(Number(number) || min, min, max));
}

function selectedObject() {
  return state.objects.find((object) => object.id === state.selectedId) || null;
}

function setTool(tool) {
  state.tool = tool;
  els.tools.forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  canvas.style.cursor = tool === "select" ? "default" : "crosshair";
}

function setSelected(id) {
  state.selectedId = id;
  state.dirtyTextEdit = false;
  syncControlsFromSelection();
  render();
}

function objectName(object) {
  const type = {
    path: object.erase ? "Eraser" : "Brush",
    image: object.name || "Image",
    rect: "Rectangle",
    ellipse: "Ellipse",
    line: "Line",
    arrow: "Arrow",
    text: object.text ? `Text: ${object.text}` : "Text"
  }[object.type] || "Layer";
  return type.length > 34 ? `${type.slice(0, 31)}...` : type;
}

function currentStyle() {
  return {
    stroke: state.style.stroke,
    fill: state.style.fillEnabled ? state.style.fill : "transparent",
    strokeWidth: state.style.strokeWidth,
    opacity: state.style.opacity,
    fontSize: state.style.fontSize,
    fontFamily: state.style.fontFamily
  };
}

function makeBase(type) {
  return {
    id: uid(),
    type,
    visible: true,
    locked: false,
    ...currentStyle()
  };
}

function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function canvasScale() {
  const rect = canvas.getBoundingClientRect();
  return rect.width / canvas.width;
}

function normalizeBox(box) {
  const x = Math.min(box.x, box.x + box.w);
  const y = Math.min(box.y, box.y + box.h);
  return {
    x,
    y,
    w: Math.abs(box.w),
    h: Math.abs(box.h)
  };
}

function objectBounds(object) {
  if (object.type === "rect" || object.type === "ellipse" || object.type === "image") {
    return normalizeBox(object);
  }
  if (object.type === "line" || object.type === "arrow") {
    return {
      x: Math.min(object.x1, object.x2),
      y: Math.min(object.y1, object.y2),
      w: Math.abs(object.x2 - object.x1),
      h: Math.abs(object.y2 - object.y1)
    };
  }
  if (object.type === "path") {
    const xs = object.points.map((point) => point.x);
    const ys = object.points.map((point) => point.y);
    const pad = object.strokeWidth || 1;
    return {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2,
      h: Math.max(...ys) - Math.min(...ys) + pad * 2
    };
  }
  if (object.type === "text") {
    const lines = textLines(object.text);
    const width = Math.max(...lines.map((line) => measureText(line, object)), 1);
    const lineHeight = object.fontSize * 1.2;
    return {
      x: object.x,
      y: object.y - object.fontSize,
      w: width,
      h: Math.max(lineHeight * lines.length, object.fontSize)
    };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function textLines(text) {
  return String(text || "").split(/\r?\n/);
}

function measureText(text, object) {
  ctx.save();
  ctx.font = fontFor(object);
  const width = ctx.measureText(text || " ").width;
  ctx.restore();
  return width;
}

function fontFor(object) {
  return `${object.fontSize || state.style.fontSize}px ${object.fontFamily || state.style.fontFamily}`;
}

function hitObject(point) {
  for (let index = state.objects.length - 1; index >= 0; index -= 1) {
    const object = state.objects[index];
    if (!object.visible) {
      continue;
    }
    if (hitTest(object, point)) {
      return object;
    }
  }
  return null;
}

function hitTest(object, point) {
  const pad = Math.max(6 / canvasScale(), object.strokeWidth || 1);
  if (object.type === "line" || object.type === "arrow") {
    return distanceToSegment(point, { x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }) <= pad;
  }
  const bounds = objectBounds(object);
  return point.x >= bounds.x - pad &&
    point.y >= bounds.y - pad &&
    point.x <= bounds.x + bounds.w + pad &&
    point.y <= bounds.y + bounds.h + pad;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function handleAt(point, object) {
  if (!object) {
    return null;
  }
  const size = 9 / canvasScale();
  if (object.type === "line" || object.type === "arrow") {
    if (insideHandle(point, object.x1, object.y1, size)) {
      return "start";
    }
    if (insideHandle(point, object.x2, object.y2, size)) {
      return "end";
    }
    return null;
  }
  if (object.type === "path") {
    return null;
  }
  const box = objectBounds(object);
  const handles = {
    nw: [box.x, box.y],
    ne: [box.x + box.w, box.y],
    sw: [box.x, box.y + box.h],
    se: [box.x + box.w, box.y + box.h]
  };
  return Object.entries(handles).find(([, pos]) => insideHandle(point, pos[0], pos[1], size))?.[0] || null;
}

function insideHandle(point, x, y, size) {
  return point.x >= x - size && point.x <= x + size && point.y >= y - size && point.y <= y + size;
}

function moveObject(object, dx, dy) {
  if (object.type === "line" || object.type === "arrow") {
    object.x1 += dx;
    object.y1 += dy;
    object.x2 += dx;
    object.y2 += dy;
    return;
  }
  if (object.type === "path") {
    object.points.forEach((point) => {
      point.x += dx;
      point.y += dy;
    });
    return;
  }
  object.x += dx;
  object.y += dy;
}

function resizeObject(object, original, handle, startPoint, point) {
  if (object.type === "line" || object.type === "arrow") {
    if (handle === "start") {
      object.x1 = point.x;
      object.y1 = point.y;
    } else if (handle === "end") {
      object.x2 = point.x;
      object.y2 = point.y;
    }
    return;
  }

  const originalBox = objectBounds(original);
  let x1 = originalBox.x;
  let y1 = originalBox.y;
  let x2 = originalBox.x + originalBox.w;
  let y2 = originalBox.y + originalBox.h;

  if (handle.includes("w")) {
    x1 = point.x;
  }
  if (handle.includes("e")) {
    x2 = point.x;
  }
  if (handle.includes("n")) {
    y1 = point.y;
  }
  if (handle.includes("s")) {
    y2 = point.y;
  }

  const next = {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.max(4, Math.abs(x2 - x1)),
    h: Math.max(4, Math.abs(y2 - y1))
  };

  if (object.type === "text") {
    const ratio = next.h / Math.max(1, originalBox.h);
    object.x = next.x;
    object.y = next.y + Math.max(8, original.fontSize * ratio);
    object.fontSize = Math.round(clamp(original.fontSize * ratio, 8, 240));
    return;
  }

  object.x = next.x;
  object.y = next.y;
  object.w = next.w;
  object.h = next.h;
}

function addObject(object) {
  state.objects.push(object);
  state.selectedId = object.id;
  syncControlsFromSelection();
  render();
}

function createTextObject(point, textValue = "Text") {
  return {
    ...makeBase("text"),
    x: point.x,
    y: point.y,
    fill: state.style.fillEnabled ? state.style.fill : state.style.stroke,
    text: textValue
  };
}

function addTextBox() {
  pushHistory();
  const text = createTextObject({
    x: Math.round(canvas.width * 0.5 - state.style.fontSize),
    y: Math.round(canvas.height * 0.5)
  });
  addObject(text);
  setTool("select");
  els.textValue.focus();
  els.textValue.select();
}

function deleteSelected() {
  if (!state.selectedId) {
    return;
  }
  pushHistory();
  state.objects = state.objects.filter((object) => object.id !== state.selectedId);
  state.selectedId = null;
  syncControlsFromSelection();
  render();
}

function duplicateSelected() {
  const object = selectedObject();
  if (!object) {
    return;
  }
  pushHistory();
  const copy = clone(object);
  copy.id = uid();
  copy.locked = false;
  moveObject(copy, 24, 24);
  state.objects.push(copy);
  state.selectedId = copy.id;
  render();
}

function moveLayer(direction) {
  const index = state.objects.findIndex((object) => object.id === state.selectedId);
  if (index < 0) {
    return;
  }
  const next = index + direction;
  if (next < 0 || next >= state.objects.length) {
    return;
  }
  pushHistory();
  const [object] = state.objects.splice(index, 1);
  state.objects.splice(next, 0, object);
  render();
}

function drawScene(targetCtx, options = {}) {
  targetCtx.save();
  targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
  if (!state.transparent || options.forceBackground) {
    targetCtx.fillStyle = options.forceBackground || state.background;
    targetCtx.fillRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
  }
  state.objects.forEach((object) => {
    if (object.visible) {
      drawObject(targetCtx, object);
    }
  });
  if (options.selection !== false) {
    drawSelection(targetCtx);
  }
  targetCtx.restore();
}

function render() {
  drawScene(ctx);
  renderLayers();
  updateHistoryButtons();
}

function drawObject(targetCtx, object) {
  targetCtx.save();
  targetCtx.globalAlpha = object.opacity ?? 1;
  targetCtx.lineWidth = object.strokeWidth || 1;
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.strokeStyle = object.erase ? "#000000" : object.stroke || "#111111";
  targetCtx.fillStyle = object.fill && object.fill !== "transparent" ? object.fill : "transparent";
  if (object.erase) {
    targetCtx.globalCompositeOperation = "destination-out";
  }

  if (object.type === "path") {
    drawPath(targetCtx, object);
  } else if (object.type === "rect") {
    drawRect(targetCtx, object);
  } else if (object.type === "ellipse") {
    drawEllipse(targetCtx, object);
  } else if (object.type === "line") {
    drawLine(targetCtx, object, false);
  } else if (object.type === "arrow") {
    drawLine(targetCtx, object, true);
  } else if (object.type === "text") {
    drawText(targetCtx, object);
  } else if (object.type === "image") {
    drawImageObject(targetCtx, object);
  }
  targetCtx.restore();
}

function drawPath(targetCtx, object) {
  if (!object.points.length) {
    return;
  }
  targetCtx.beginPath();
  targetCtx.moveTo(object.points[0].x, object.points[0].y);
  for (let index = 1; index < object.points.length; index += 1) {
    const previous = object.points[index - 1];
    const point = object.points[index];
    targetCtx.quadraticCurveTo(previous.x, previous.y, (previous.x + point.x) / 2, (previous.y + point.y) / 2);
  }
  targetCtx.stroke();
}

function drawRect(targetCtx, object) {
  const box = normalizeBox(object);
  if (object.fill && object.fill !== "transparent") {
    targetCtx.fillRect(box.x, box.y, box.w, box.h);
  }
  targetCtx.strokeRect(box.x, box.y, box.w, box.h);
}

function drawEllipse(targetCtx, object) {
  const box = normalizeBox(object);
  targetCtx.beginPath();
  targetCtx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
  if (object.fill && object.fill !== "transparent") {
    targetCtx.fill();
  }
  targetCtx.stroke();
}

function drawLine(targetCtx, object, withArrow) {
  targetCtx.beginPath();
  targetCtx.moveTo(object.x1, object.y1);
  targetCtx.lineTo(object.x2, object.y2);
  targetCtx.stroke();
  if (!withArrow) {
    return;
  }
  const angle = Math.atan2(object.y2 - object.y1, object.x2 - object.x1);
  const size = Math.max(10, (object.strokeWidth || 1) * 4);
  targetCtx.beginPath();
  targetCtx.moveTo(object.x2, object.y2);
  targetCtx.lineTo(object.x2 - Math.cos(angle - Math.PI / 6) * size, object.y2 - Math.sin(angle - Math.PI / 6) * size);
  targetCtx.moveTo(object.x2, object.y2);
  targetCtx.lineTo(object.x2 - Math.cos(angle + Math.PI / 6) * size, object.y2 - Math.sin(angle + Math.PI / 6) * size);
  targetCtx.stroke();
}

function drawText(targetCtx, object) {
  targetCtx.font = fontFor(object);
  targetCtx.fillStyle = object.fill && object.fill !== "transparent" ? object.fill : object.stroke || "#111111";
  targetCtx.textBaseline = "alphabetic";
  const lineHeight = (object.fontSize || state.style.fontSize) * 1.2;
  textLines(object.text).forEach((line, index) => {
    targetCtx.fillText(line || " ", object.x, object.y + index * lineHeight);
  });
}

function drawImageObject(targetCtx, object) {
  const image = imageFor(object.src);
  if (!image || !image.complete) {
    return;
  }
  targetCtx.drawImage(image, object.x, object.y, object.w, object.h);
}

function drawSelection(targetCtx) {
  const object = selectedObject();
  if (!object || !object.visible) {
    return;
  }
  const scale = canvasScale();
  const box = objectBounds(object);
  const handle = 7 / scale;
  targetCtx.save();
  targetCtx.strokeStyle = "#22d3ee";
  targetCtx.fillStyle = "#111111";
  targetCtx.lineWidth = 1.5 / scale;
  targetCtx.setLineDash([7 / scale, 5 / scale]);
  targetCtx.strokeRect(box.x, box.y, box.w, box.h);
  targetCtx.setLineDash([]);

  if (object.type === "line" || object.type === "arrow") {
    drawHandle(targetCtx, object.x1, object.y1, handle);
    drawHandle(targetCtx, object.x2, object.y2, handle);
  } else if (object.type !== "path") {
    drawHandle(targetCtx, box.x, box.y, handle);
    drawHandle(targetCtx, box.x + box.w, box.y, handle);
    drawHandle(targetCtx, box.x, box.y + box.h, handle);
    drawHandle(targetCtx, box.x + box.w, box.y + box.h, handle);
  }
  targetCtx.restore();
}

function drawHandle(targetCtx, x, y, size) {
  targetCtx.fillRect(x - size / 2, y - size / 2, size, size);
  targetCtx.strokeRect(x - size / 2, y - size / 2, size, size);
}

function imageFor(src) {
  if (!src) {
    return null;
  }
  if (imageCache.has(src)) {
    return imageCache.get(src);
  }
  const image = new Image();
  image.onload = render;
  image.src = src;
  imageCache.set(src, image);
  return image;
}

function preloadImages() {
  state.objects.filter((object) => object.type === "image").forEach((object) => imageFor(object.src));
}

function renderLayers() {
  els.layers.innerHTML = "";
  [...state.objects].reverse().forEach((object) => {
    const row = document.createElement("div");
    row.className = `layer-row${object.id === state.selectedId ? " selected" : ""}`;
    row.dataset.id = object.id;

    const visible = document.createElement("button");
    visible.type = "button";
    visible.textContent = object.visible ? "V" : "-";
    visible.title = object.visible ? "Hide layer" : "Show layer";
    visible.addEventListener("click", (event) => {
      event.stopPropagation();
      pushHistory();
      object.visible = !object.visible;
      render();
    });

    const locked = document.createElement("button");
    locked.type = "button";
    locked.textContent = object.locked ? "L" : ".";
    locked.title = object.locked ? "Unlock layer" : "Lock layer";
    locked.addEventListener("click", (event) => {
      event.stopPropagation();
      pushHistory();
      object.locked = !object.locked;
      render();
    });

    const name = document.createElement("div");
    name.className = "layer-name";
    name.textContent = objectName(object);

    row.append(visible, locked, name);
    row.addEventListener("click", () => setSelected(object.id));
    els.layers.append(row);
  });
}

function syncControlsFromState() {
  els.canvasWidth.value = canvas.width;
  els.canvasHeight.value = canvas.height;
  els.backgroundColor.value = state.background;
  els.transparentCanvas.checked = state.transparent;
  els.zoomRange.value = Math.round(state.zoom * 100);
  setZoom(state.zoom);
  syncControlsFromSelection();
}

function syncControlsFromSelection() {
  const object = selectedObject();
  const source = object || state.style;
  els.strokeColor.value = colorOrFallback(source.stroke, state.style.stroke);
  if (object) {
    els.fillColor.value = colorOrFallback(object.fill === "transparent" ? state.style.fill : object.fill, state.style.fill);
    els.fillEnabled.checked = Boolean(object.fill && object.fill !== "transparent");
  } else {
    els.fillColor.value = colorOrFallback(state.style.fill, "#f97316");
    els.fillEnabled.checked = state.style.fillEnabled;
  }
  els.strokeWidth.value = source.strokeWidth || state.style.strokeWidth;
  els.strokeWidthRange.value = source.strokeWidth || state.style.strokeWidth;
  els.opacity.value = Math.round((source.opacity ?? state.style.opacity) * 100);
  els.fontSize.value = source.fontSize || state.style.fontSize;
  els.textValue.value = object && object.type === "text" ? object.text : "";
  els.textValue.disabled = !(object && object.type === "text");
}

function colorOrFallback(color, fallback) {
  return /^#[0-9a-f]{6}$/i.test(color || "") ? color : fallback;
}

function applyStyleChange(mutator) {
  const object = selectedObject();
  if (object) {
    pushHistory();
    mutator(object);
  }
  mutator(state.style);
  render();
}

function setStrokeColor(value) {
  const object = selectedObject();
  if (object) {
    pushHistory();
    object.stroke = value;
  }
  state.style.stroke = value;
  render();
}

function setFillColor(value) {
  const object = selectedObject();
  if (object && els.fillEnabled.checked) {
    pushHistory();
    object.fill = value;
  }
  state.style.fill = value;
  render();
}

function setFillEnabled(enabled) {
  const object = selectedObject();
  if (object) {
    pushHistory();
    object.fill = enabled ? state.style.fill : "transparent";
  }
  state.style.fillEnabled = enabled;
  render();
}

function setStrokeWidth(value) {
  const width = clampInt(value, 1, 80);
  els.strokeWidth.value = width;
  els.strokeWidthRange.value = width;
  applyStyleChange((target) => {
    target.strokeWidth = width;
  });
}

function setZoom(zoom) {
  state.zoom = clamp(Number(zoom) || 0.75, 0.15, 2);
  canvas.style.width = `${Math.round(canvas.width * state.zoom)}px`;
  canvas.style.height = `${Math.round(canvas.height * state.zoom)}px`;
}

function fitCanvas() {
  const availableW = Math.max(240, els.stageWrap.clientWidth - 72);
  const availableH = Math.max(220, els.stageWrap.clientHeight - 72);
  const zoom = clamp(Math.min(availableW / canvas.width, availableH / canvas.height), 0.15, 2);
  els.zoomRange.value = Math.round(zoom * 100);
  setZoom(zoom);
  render();
}

function handlePointerDown(event) {
  if (event.button !== 0) {
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  const point = pointerPoint(event);
  const object = selectedObject();
  const handle = handleAt(point, object);

  if (state.tool === "select") {
    if (handle && object && !object.locked) {
      pushHistory();
      state.gesture = {
        mode: "resize",
        id: object.id,
        handle,
        start: point,
        original: clone(object)
      };
      return;
    }

    const hit = hitObject(point);
    setSelected(hit ? hit.id : null);
    if (hit && !hit.locked) {
      pushHistory();
      state.gesture = {
        mode: "move",
        id: hit.id,
        start: point,
        original: clone(hit)
      };
    }
    return;
  }

  pushHistory();
  if (state.tool === "brush" || state.tool === "eraser") {
    const path = {
      ...makeBase("path"),
      points: [point],
      erase: state.tool === "eraser",
      strokeWidth: state.tool === "eraser" ? Math.max(8, state.style.strokeWidth * 2) : state.style.strokeWidth
    };
    addObject(path);
    state.gesture = { mode: "drawPath", id: path.id };
    return;
  }

  if (state.tool === "rect" || state.tool === "ellipse") {
    const shape = {
      ...makeBase(state.tool),
      x: point.x,
      y: point.y,
      w: 0,
      h: 0
    };
    addObject(shape);
    state.gesture = { mode: "drawBox", id: shape.id, start: point };
    return;
  }

  if (state.tool === "line" || state.tool === "arrow") {
    const line = {
      ...makeBase(state.tool),
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y
    };
    addObject(line);
    state.gesture = { mode: "drawLine", id: line.id, start: point };
    return;
  }

  if (state.tool === "text") {
    addObject(createTextObject(point));
    setTool("select");
    els.textValue.focus();
    els.textValue.select();
  }
}

function handlePointerMove(event) {
  if (!state.gesture) {
    return;
  }
  const point = pointerPoint(event);
  const object = state.objects.find((item) => item.id === state.gesture.id);
  if (!object) {
    return;
  }

  if (state.gesture.mode === "move") {
    Object.assign(object, clone(state.gesture.original));
    moveObject(object, point.x - state.gesture.start.x, point.y - state.gesture.start.y);
  } else if (state.gesture.mode === "resize") {
    Object.assign(object, clone(state.gesture.original));
    resizeObject(object, state.gesture.original, state.gesture.handle, state.gesture.start, point);
  } else if (state.gesture.mode === "drawPath") {
    object.points.push(point);
  } else if (state.gesture.mode === "drawBox") {
    object.w = point.x - state.gesture.start.x;
    object.h = point.y - state.gesture.start.y;
  } else if (state.gesture.mode === "drawLine") {
    object.x2 = point.x;
    object.y2 = point.y;
  }
  syncControlsFromSelection();
  render();
}

function handlePointerUp(event) {
  if (state.gesture) {
    const object = state.objects.find((item) => item.id === state.gesture.id);
    if (object && (object.type === "rect" || object.type === "ellipse" || object.type === "image")) {
      Object.assign(object, normalizeBox(object));
    }
    state.gesture = null;
    render();
  }
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function importImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const src = String(reader.result || "");
    const image = new Image();
    image.onload = () => {
      imageCache.set(src, image);
      const maxW = canvas.width * 0.68;
      const maxH = canvas.height * 0.68;
      const ratio = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight, 1);
      const w = Math.max(1, image.naturalWidth * ratio);
      const h = Math.max(1, image.naturalHeight * ratio);
      pushHistory();
      addObject({
        id: uid(),
        type: "image",
        visible: true,
        locked: false,
        name: file.name.replace(/\.[^.]+$/, ""),
        src,
        x: (canvas.width - w) / 2,
        y: (canvas.height - h) / 2,
        w,
        h,
        opacity: 1
      });
      setTool("select");
    };
    image.src = src;
  };
  reader.readAsDataURL(file);
}

function saveProject() {
  downloadBlob(`${projectName()}.daublet.json`, JSON.stringify(JSON.parse(snapshot()), null, 2), "application/json");
}

function openProjectFile(file) {
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    pushHistory();
    restore(String(reader.result || "{}"));
  };
  reader.readAsText(file);
}

function exportImage() {
  const type = els.exportFormat.value;
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const outCtx = out.getContext("2d");
  const forceBackground = type === "image/jpeg" && state.transparent ? "#ffffff" : null;
  drawScene(outCtx, { selection: false, forceBackground });
  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
  }[type] || "png";
  const quality = type === "image/png" ? undefined : 0.92;
  out.toBlob((blob) => {
    if (blob) {
      downloadBlob(`${projectName()}.${extension}`, blob, type);
    }
  }, type, quality);
}

function projectName() {
  const date = new Date().toISOString().slice(0, 10);
  return `daublet-${date}`;
}

function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function newDocument() {
  if (state.objects.length && !window.confirm("Start a new document?")) {
    return;
  }
  pushHistory();
  state.objects = [];
  state.selectedId = null;
  state.background = "#ffffff";
  state.transparent = false;
  canvas.width = 1280;
  canvas.height = 720;
  syncControlsFromState();
  render();
}

function resizeCanvas() {
  pushHistory();
  canvas.width = clampInt(els.canvasWidth.value, 64, 8192);
  canvas.height = clampInt(els.canvasHeight.value, 64, 8192);
  setZoom(state.zoom);
  render();
}

function isTypingTarget(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function handleKeydown(event) {
  if (isTypingTarget(event.target)) {
    return;
  }
  const object = selectedObject();
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }
  if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (mod && event.key.toLowerCase() === "c" && object) {
    event.preventDefault();
    state.clipboard = clone(object);
    return;
  }
  if (mod && event.key.toLowerCase() === "v" && state.clipboard) {
    event.preventDefault();
    pushHistory();
    const copy = clone(state.clipboard);
    copy.id = uid();
    moveObject(copy, 24, 24);
    state.objects.push(copy);
    state.selectedId = copy.id;
    render();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && object) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if (event.key === "Escape") {
    setSelected(null);
    return;
  }
  if (object && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && !object.locked) {
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    pushHistory();
    moveObject(object, dx, dy);
    render();
  }
}

function wireEvents() {
  els.tools.forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);

  els.newDoc.addEventListener("click", newDocument);
  els.openProject.addEventListener("click", () => els.projectFile.click());
  els.importImage.addEventListener("click", () => els.imageFile.click());
  els.saveProject.addEventListener("click", saveProject);
  els.exportImage.addEventListener("click", exportImage);
  els.undoBtn.addEventListener("click", undo);
  els.redoBtn.addEventListener("click", redo);
  els.resizeCanvas.addEventListener("click", resizeCanvas);
  els.fitCanvas.addEventListener("click", fitCanvas);

  els.imageFile.addEventListener("change", () => {
    importImageFile(els.imageFile.files[0]);
    els.imageFile.value = "";
  });
  els.projectFile.addEventListener("change", () => {
    openProjectFile(els.projectFile.files[0]);
    els.projectFile.value = "";
  });

  els.zoomRange.addEventListener("input", () => {
    setZoom(Number(els.zoomRange.value) / 100);
    render();
  });

  els.strokeColor.addEventListener("input", () => setStrokeColor(els.strokeColor.value));
  els.fillColor.addEventListener("input", () => setFillColor(els.fillColor.value));
  els.fillEnabled.addEventListener("change", () => setFillEnabled(els.fillEnabled.checked));
  els.strokeWidth.addEventListener("change", () => setStrokeWidth(els.strokeWidth.value));
  els.strokeWidthRange.addEventListener("input", () => setStrokeWidth(els.strokeWidthRange.value));
  els.opacity.addEventListener("input", () => applyStyleChange((target) => { target.opacity = clamp(Number(els.opacity.value) / 100, 0.05, 1); }));
  els.fontSize.addEventListener("change", () => applyStyleChange((target) => { target.fontSize = clampInt(els.fontSize.value, 8, 240); }));
  els.addTextBox.addEventListener("click", addTextBox);

  els.textValue.addEventListener("focus", () => {
    state.dirtyTextEdit = false;
  });
  els.textValue.addEventListener("input", () => {
    const object = selectedObject();
    if (!object || object.type !== "text") {
      return;
    }
    if (!state.dirtyTextEdit) {
      pushHistory();
      state.dirtyTextEdit = true;
    }
    object.text = els.textValue.value;
    render();
  });

  els.backgroundColor.addEventListener("input", () => {
    pushHistory();
    state.background = els.backgroundColor.value;
    render();
  });
  els.transparentCanvas.addEventListener("change", () => {
    pushHistory();
    state.transparent = els.transparentCanvas.checked;
    render();
  });

  els.moveLayerUp.addEventListener("click", () => moveLayer(1));
  els.moveLayerDown.addEventListener("click", () => moveLayer(-1));
  els.duplicateLayer.addEventListener("click", duplicateSelected);
  els.deleteLayer.addEventListener("click", deleteSelected);

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("paste", (event) => {
    const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith("image/"));
    if (item) {
      importImageFile(item.getAsFile());
    }
  });

  els.stageWrap.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  els.stageWrap.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer?.files || []).find((entry) => entry.type.startsWith("image/"));
    if (file) {
      importImageFile(file);
    }
  });
}

function init() {
  wireEvents();
  setTool("select");
  syncControlsFromState();
  fitCanvas();
  render();
}

init();
