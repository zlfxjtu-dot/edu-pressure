// 把页面生成的 SVG 结构 dump 成文本，用「读文本」代替「看图」验证曲线画对没有。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

function makeEl(tag) {
  const el = {
    tagName: tag, children: [], attributes: {}, style: {}, dataset: {},
    className: '', textContent: '', value: '', selected: false,
    draggable: false, title: '', onclick: null, oninput: null, onchange: null,
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { this['on' + t] = fn; },
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} },
    // 模拟真实浏览器：HTML 命名空间元素 appendChild 进 svg 仍可，但真实浏览器不渲染；
    // 这里记录 namespace 便于检查
    _ns: 'html',
    _parentTag: null,
  };
  Object.defineProperty(el, 'innerHTML', { set() { el.children.length = 0; }, get() { return ''; } });
  return el;
}

const registry = {};
const sandbox = {
  console, prompt: () => null,
  document: {
    getElementById(id) { if (!registry[id]) { registry[id] = makeEl('div'); registry[id].id = id; } return registry[id]; },
    createElement(t) { const e = makeEl(t); e._ns = 'html'; return e; },
    createElementNS(ns, t) { const e = makeEl(t); e._ns = ns.includes('svg') ? 'svg' : 'other'; return e; },
    createTextNode(t) { return { textContent: t }; },
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'pressure.js'), 'utf8'), sandbox);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach(s => vm.runInContext(s, sandbox));

function serialize(el, depth = 0) {
  const pad = '  '.repeat(depth);
  const attrs = Object.entries(el.attributes || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
  const ns = el._ns === 'svg' ? '' : `[!!${el._ns}]`;
  let line = `${pad}<${el.tagName}${ns}${attrs ? ' ' + attrs : ''}>`;
  if (el.textContent) line += ` "${el.textContent}"`;
  const kids = (el.children || []).map(c => serialize(c, depth + 1)).join('\n');
  return kids ? line + '\n' + kids : line;
}

const svg = registry['chart'];
const out = [];
out.push('===== SVG 内容（缩进表示层级）=====');
out.push('');

// 统计
const kids = svg.children;
const polys = kids.filter(c => c.tagName === 'path');
const circles = kids.filter(c => c.tagName === 'circle');
const lines = kids.filter(c => c.tagName === 'line');
const texts = kids.filter(c => c.tagName === 'text');

out.push(`元素统计: path=${polys.length}  circle=${circles.length}  line=${lines.length}  text=${texts.length}`);
out.push('');
out.push('--- 每条 path 的 stroke / width / d ---');
polys.forEach((p, i) => {
  out.push(`[${i}] namespace=${p._ns}  stroke=${p.attributes.stroke || '(无!)'}  dash=${p.attributes['stroke-dasharray'] || '实线'}  width=${p.attributes['stroke-width'] || '(无)'}`);
  out.push(`     d=${p.attributes.d}`);
  out.push(`     起点=${(p.attributes.d || '').match(/^M([\d.]+),([\d.]+)/)?.slice(1).join(',')}`);
  // 所有控制点/端点的 y，检查有没有越界（下方 0 线 y=320，上方顶 y=16）
  const ys = [...(p.attributes.d || '').matchAll(/[ ,]([\d.]+),([\d.]+)/g)].map(m => parseFloat(m[2]));
  const cys = [...(p.attributes.d || '').matchAll(/C([\d.]+),([\d.]+) ([\d.]+),([\d.]+) ([\d.]+),([\d.]+)/g)]
    .flatMap(m => [parseFloat(m[2]), parseFloat(m[4]), parseFloat(m[6])]);
  out.push(`     y 范围: ${Math.min(...cys).toFixed(1)} ~ ${Math.max(...cys).toFixed(1)}   (画布 16~320，越界即过冲)`);
});
out.push('');
out.push('--- 每个 circle 的 fill / 位置 ---');
circles.forEach((c, i) => {
  out.push(`[${i}] namespace=${c._ns}  fill=${c.attributes.fill || '(无!)'}  cx=${c.attributes.cx}  cy=${c.attributes.cy}`);
});
out.push('');
out.push('--- 坐标轴文字 ---');
texts.forEach(t => out.push(`"${t.textContent}" @ (${t.attributes.x},${t.attributes.y})`));

fs.writeFileSync(path.join(ROOT, '_svg-dump.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));
