"use strict";
// Минималистичный роутер: сопоставление «метод + шаблон пути» → обработчик.
// Шаблон поддерживает параметры вида :id. Совпадения передаются в handler
// как (req, res, params, ctx). Без внешних зависимостей.

function compile(pattern) {
  const keys = [];
  const rx = new RegExp("^" + pattern
    .replace(/\/+$/, "")
    .replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === "*" ? "*" : "\\" + m))
    .replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; })
    + "/?$");
  return { rx, keys };
}

class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    this.routes.push({ method: method.toUpperCase(), ...compile(pattern), handler });
    return this;
  }
  get(p, h) { return this.add("GET", p, h); }
  post(p, h) { return this.add("POST", p, h); }
  put(p, h) { return this.add("PUT", p, h); }
  delete(p, h) { return this.add("DELETE", p, h); }

  // Находит совпадение. Возвращает { handler, params } или null.
  match(method, pathname) {
    const clean = pathname.replace(/\/+$/, "") || "/";
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = r.rx.exec(clean);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }
}

module.exports = { Router };
