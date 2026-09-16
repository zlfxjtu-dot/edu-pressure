// 用最小 DOM 桩把 index.html 的内联脚本真跑一遍，确认「语法过 + 渲染不炸 + 曲线画得出来」。
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
    addEventListener(type, fn) { this['on' + type] = fn; },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    set() { el.children.length = 0; },
    get() { return ''; },
  });
  return el;
}

const registry = {};
const sandbox = {
  console,
  prompt: () => null,
  document: {
    getElementById(id) { if (!registry[id]) { registry[id] = makeEl('div'); registry[id].id = id; } return registry[id]; },
    createElement(t) { return makeEl(t); },
    createElementNS(ns, t) { return makeEl(t); },
    createTextNode(t) { return { textContent: t }; },
  },
};
sandbox.window = sandbox;

vm.createContext(sandbox);

// 1. 跑外部引擎 pressure.js（UMD 挂到 this = sandbox）
const engine = fs.readFileSync(path.join(ROOT, 'src', 'pressure.js'), 'utf8');
vm.runInContext(engine, sandbox);
console.log('PressureModel 已加载:', typeof sandbox.PressureModel === 'object');

// 2. 提取内联脚本
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('内联脚本数:', scripts.length);

// 3. 语法检查
let syntaxOk = true;
scripts.forEach((s, i) => {
  try { new vm.Script(s); } catch (e) { syntaxOk = false; console.error(`  脚本 ${i} 语法错误:`, e.message); }
});
console.log('语法检查:', syntaxOk ? '通过' : '失败');

// 4. 真跑
let runOk = true;
scripts.forEach((s, i) => {
  try { vm.runInContext(s, sandbox); } catch (e) { runOk = false; console.error(`  脚本 ${i} 运行错误:`, e.message); }
});
console.log('真跑:', runOk ? '不炸' : '炸了');

// 5. 验证渲染结果
const chart = registry['chart'];
const seq = registry['sequence'];
const jobs = registry['jobs'];
const count = (tag) => (chart ? chart.children.filter(c => c.tagName === tag).length : 0);
// #sequence 里现在还有插入槽，只数 group
console.log('序列 group 行数:',
  seq ? seq.children.filter(c => c.className === 'group').length : 'N/A', '(应 7)');
console.log('岗位卡片数:', jobs ? jobs.children.length : 'N/A', '(默认 2：本科岗 + 硕士岗)');
console.log('曲线 path:', count('path'), '(2 岗位 × 2 条 = 4)');
console.log('曲线数据点 circle:', count('circle'), '(本科岗 5 层 + 硕士岗 5 层，各 ×2 = 20)');
console.log('Y 轴网格 line:', count('line'), '(对数轴 9 条 1-2-5 刻度 + 1 条并列下划线 = 10)');

const pyr = registry['pyramid'];
const pkids = pyr ? pyr.children : [];
const pcount = (tag) => pkids.filter(c => c.tagName === tag).length;
const bands = pkids.filter(c => c.tagName === 'rect' && c.attributes.opacity);
const pedges = pkids.filter(c => c.tagName === 'line' && c.attributes.opacity);
console.log('金字塔 rect:', pcount('rect'), '(8 柱 + 2 岗位区间带 = 10)');
console.log('金字塔 区间上下线 line:', pedges.length, '(2 岗位 × 上下两条 = 4)');
console.log('金字塔 viewBox:', pyr ? pyr.attributes.viewBox : 'N/A');
const pleg = registry['pyramidLegend'];
console.log('金字塔图例条目:', pleg ? pleg.children.length : 'N/A', '(应 2 = 岗位数)');

// 口径标签：改成「专业」后，提示文字和每个人数框的说明都应跟着变
const dim = registry['dimLabel'];
// #sequence 现在混着插入槽，得先筛出 group
const firstGroup = seq && seq.children.find(c => c.className === 'group');
const firstChip = firstGroup && firstGroup.children[1] && firstGroup.children[1].children[0];
const countInput = firstChip && firstChip.children[1];
console.log('');
console.log('口径标签 改前:', JSON.stringify(dim.value), '/ 人数框 title:', countInput && countInput.title);
dim.value = '专业';
if (typeof dim.oninput === 'function') dim.oninput();
console.log('口径标签 改后:', JSON.stringify(dim.value));
console.log('  提示文字:', registry['seqHint'] ? registry['seqHint'].textContent : 'N/A');
console.log('  人数框 title:', countInput ? countInput.title : 'N/A');
console.log('  金字塔是否跟着变（应「否」——金字塔画的是人数，与口径标签无关）:',
  registry['pyramid'].children.filter(c => c.tagName === 'rect').length, '个 rect');

// ---------- 拖放：合并 & 拆分 ----------
// 回归：以前只有 moveLayerTo（并进去），没有拆出来的路径，合并是单向的。
// 断言不能写「每行都只有 1 层」—— 默认数据里 985硕+双九硕 本来就是并列的。
const seqBox = registry['sequence'];
const grps = () => seqBox.children.filter(c => c.className === 'group');
const gapsList = () => seqBox.children.filter(c => c.className === 'dropgap');
const chipsOf = (g) => g.children[1].children;
const nameOf = (c) => c.children[0].textContent;
const EVT = { preventDefault() {} };

console.log('');
const nRow = grps().length;
console.log('拖放 初始:', nRow, '行 /', gapsList().length, '槽', '(槽应 = 行数+1)');

// ① 合并：把第 2 行的第一层拖到第 1 行上
const movingName = nameOf(chipsOf(grps()[1])[0]);
chipsOf(grps()[1])[0].ondragstart();
grps()[0].ondrop(EVT);
console.log('① 合并「' + movingName + '」→', grps().length, '行',
  grps().length === nRow - 1 && chipsOf(grps()[0]).length === 2 ? '✓' : '✗');

// ② 拆分：从合并行里把它拖到缝里（缝隙 = 行的上方）
const back = chipsOf(grps()[0]).find(c => nameOf(c) === movingName);
back.ondragstart();
gapsList()[2].ondrop(EVT);
const splitOk = grps().length === nRow && chipsOf(grps()[0]).length === 1
  && grps().some(g => chipsOf(g).length === 1 && nameOf(chipsOf(g)[0]) === movingName);
console.log('② 拆分「' + movingName + '」→', grps().length, '行', splitOk ? '✓ 拆回独立一行' : '✗');

// ③ 边界：把独占一行的层拖到缝里 —— 原行被抽空应被删掉，行数不变
const solo = grps()[1];
const soloName = nameOf(chipsOf(solo)[0]);
if (chipsOf(solo).length === 1) {
  chipsOf(solo)[0].ondragstart();
  gapsList()[0].ondrop(EVT);
  console.log('③ 独层「' + soloName + '」拖到最上面 →', grps().length, '行',
    grps().length === nRow ? '✓ 空行已清除' : '✗ 行数应不变');
  console.log('   最终布局:', grps().map(g => chipsOf(g).map(nameOf).join('+')).join(' | '));
}
