"use strict";
// Утилиты фронтенда: DOM-хелперы, API-клиент, тосты. Без внешних зависимостей.
// Обёрнуто в IIFE: имена не утекают в глобальную область (наружу — только window.UI),
// иначе они конфликтуют с одноимёнными const в app.js (общий global scope браузера).
(function () {

// Экранирование текста для вставки в HTML.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Простой создатель элемента: el("div", {class:"x"}, [children|string]).
function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  if (children != null) {
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
  }
  return n;
}

// API-клиент. Возвращает распарсенный JSON или бросает { status, message }.
const api = {
  async request(method, url, body, raw) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      if (raw) { opts.body = body; }
      else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    }
    const res = await fetch(url, opts);
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) throw { status: res.status, message: (data && data.error) || res.statusText };
    return data;
  },
  get(u) { return this.request("GET", u); },
  post(u, b) { return this.request("POST", u, b === undefined ? {} : b); },
  put(u, b) { return this.request("PUT", u, b); },
  putRaw(u, buf) { return this.request("PUT", u, buf, true); },
  del(u) { return this.request("DELETE", u); },
};

let _toastTimer = null;
function toast(msg, isErr) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = "toast"; }, 2600);
}

function badge(status) {
  const s = status || "none";
  return `<span class="badge ${esc(s)}">${esc(status || "нет данных")}</span>`;
}

function progressBar(percent) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return el("div", { class: "progress" }, [el("span", { style: `width:${p}%` })]);
}

// Копирование в буфер обмена. clipboard API + фолбэк на execCommand (http/localhost).
async function copy(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* фолбэк ниже */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}

window.UI = { esc, el, api, toast, badge, progressBar, copy };

})();
