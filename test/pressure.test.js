const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../src/pressure.js');

const SEQ = M.DEFAULT_SEQUENCE;
// 人数一律按名字取，不写字面量 —— 否则改一次人数就要满文件改断言
const CNT = Object.fromEntries(SEQ.map(l => [l.name, l.count]));
const TIER = Object.fromEntries(SEQ.map(l => [l.name, l.tier]));
const TOTAL = SEQ.reduce((s, l) => s + l.count, 0);

const K = M.DEFAULT_SPILLOVER;   // 0.15
const BASE = M.DEFAULT_BASELINE; // 500
// 关掉渗透和基准，用来单独验「区间内」的老语义
const PURE = { spillover: 0, baseline: 0 };

function byName(rows, name) { return rows.find(r => r.name === name); }
function job(lower, upper, type) {
  return { name: 'j', type: type || 'normal', lower: lower, upper: upper };
}
// 浮点别用 ===，渗透算出来是小数
function near(a, b, msg) {
  assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} 期望 ${b}，实得 ${a}`);
}

// ---------- 默认数据 ----------

test('默认序列：985本 明显低于 211硕（大部分读研了，进就业市场的少）', () => {
  assert.strictEqual(CNT['985本'], 5000);
  assert.ok(CNT['985本'] < CNT['211硕'], '985本 应少于 211硕');
});

test('默认岗位：本科岗与硕士岗，区间在 双非硕/985本 处重叠', () => {
  assert.strictEqual(M.DEFAULT_JOBS.length, 2);
  const [本科, 硕士] = M.DEFAULT_JOBS;
  assert.strictEqual(本科.name, '本科岗');
  assert.strictEqual(硕士.name, '硕士岗');

  const span = (j) => [TIER[j.lower], TIER[j.upper]].sort((a, b) => a - b);
  const [bl, bh] = span(本科), [ml, mh] = span(硕士);
  const overlap = SEQ.filter(l => l.tier >= bl && l.tier <= bh && l.tier >= ml && l.tier <= mh);
  assert.deepStrictEqual(overlap.map(l => l.name), ['双非硕', '985本']);
});

// ---------- 区间内语义（关掉渗透和基准）----------

test('普通岗：区间最低层替代为 0，压力 = 上方全部', () => {
  const r = byName(M.solve(SEQ, job('985本', '双九硕'), PURE), '985本');
  assert.strictEqual(r.substitution, 0);                                    // 区间内下方没人
  assert.strictEqual(r.pressure, CNT['211硕'] + CNT['985硕'] + CNT['双九硕']);
});

test('普通岗：顶端压力为 0，替代 = 下方全部', () => {
  const r = byName(M.solve(SEQ, job('985本', '双九硕'), PURE), '双九硕');
  assert.strictEqual(r.pressure, 0);                                        // 区间内上方没人
  assert.strictEqual(r.substitution, CNT['985本'] + CNT['211硕']);
});

test('普通岗：同 tier（并列）不算压力也不算替代', () => {
  const rows = M.solve(SEQ, job('985本', '双九硕'), PURE);
  const a = byName(rows, '985硕'), b = byName(rows, '双九硕');
  assert.strictEqual(a.substitution, CNT['985本'] + CNT['211硕']);   // 不含同层的双九硕
  assert.strictEqual(a.pressure, 0);
  assert.strictEqual(b.substitution, CNT['985本'] + CNT['211硕']);   // 不含同层的 985硕
  assert.strictEqual(b.pressure, 0);
});

test('考试岗：压力 = 替代（对称），值 = 区间内其他所有人', () => {
  const rows = M.solve(SEQ, job('二本', '双九硕', 'exam'), PURE);
  for (const r of rows) {
    assert.strictEqual(r.pressure, r.substitution, `${r.name} 应压力=替代`);
    assert.strictEqual(r.pressure, TOTAL - r.count, `${r.name} 应等于其他人总和`);
  }
});

test('考试岗：并列的两层彼此也算「其他人」', () => {
  const rows = M.solve(SEQ, job('二本', '双九硕', 'exam'), PURE);
  assert.strictEqual(byName(rows, '985硕').pressure, TOTAL - CNT['985硕']); // 含双九硕
});

test('区间端点不在序列里 → 空结果', () => {
  assert.deepStrictEqual(M.solve(SEQ, job('博士', '双九硕')), []);
  assert.deepStrictEqual(M.solve(SEQ, job('二本', '博士')), []);
});

test('倍数 = 人数 ÷ 本层人数，人数为 0 时倍数为 null', () => {
  const r = byName(M.solve(SEQ, job('985本', '双九硕'), PURE), '985本');
  assert.strictEqual(r.pressureRatio, (CNT['211硕'] + CNT['985硕'] + CNT['双九硕']) / CNT['985本']);
  assert.strictEqual(r.substitutionRatio, 0);

  const zero = [{ name: '空层', count: 0, tier: 0 }, { name: '二本', count: 100, tier: 1 }];
  const zr = M.solve(zero, { name: 'j', type: 'exam', lower: '空层', upper: '二本' });
  assert.strictEqual(byName(zr, '空层').pressureRatio, null);
});

// ---------- 边界渗透 ----------

test('渗透：硕士岗底层（双非硕）的替代不再为 0，来自区间外的 211本/双非/二本', () => {
  const r = byName(M.solve(SEQ, job('双非硕', '双九硕'), { spillover: K, baseline: 0 }), '双非硕');
  // 211本 隔 1 档 → k，双非 隔 2 档 → k²，二本 隔 3 档 → k³
  near(r.substitution,
    CNT['211本'] * Math.pow(K, 1) + CNT['双非'] * Math.pow(K, 2) + CNT['二本'] * Math.pow(K, 3),
    '双非硕 替代');
  assert.ok(r.substitution > 0);
});

test('渗透：本科岗顶层（985本）的挤压不再为 0，来自区间外的 211硕/985硕/双九硕', () => {
  const r = byName(M.solve(SEQ, job('二本', '985本'), { spillover: K, baseline: 0 }), '985本');
  near(r.pressure,
    CNT['211硕'] * Math.pow(K, 1) + CNT['985硕'] * Math.pow(K, 2) + CNT['双九硕'] * Math.pow(K, 2),
    '985本 挤压');
  assert.ok(r.pressure > 0);
});

test('渗透：按距离衰减，隔得越远权重越小', () => {
  const r = byName(M.solve(SEQ, job('双非硕', '双九硕'), { spillover: K, baseline: 0 }), '双非硕');
  const w1 = CNT['211本'] * Math.pow(K, 1);   // 隔 1 档
  const w2 = CNT['双非'] * Math.pow(K, 2);    // 隔 2 档
  // 权重本身在衰减（虽然远处人数多，绝对贡献不一定小）
  assert.ok(Math.pow(K, 1) > Math.pow(K, 2));
  assert.ok(r.substitution >= w1 && r.substitution >= w2);
});

test('渗透率为 0 时退回原语义', () => {
  const a = M.solve(SEQ, job('985本', '双九硕'), { spillover: 0, baseline: 0 });
  const b = M.solve(SEQ, job('985本', '双九硕'), PURE);
  assert.deepStrictEqual(a, b);
});

// ---------- 基准竞争 ----------

test('基准：序列两端也不会归零（本科岗底 = 二本，硕士岗顶 = 双九硕）', () => {
  const 本 = byName(M.solve(SEQ, job('二本', '985本')), '二本');
  assert.strictEqual(本.substitution, BASE, '二本 下方确实无人，只剩基准');
  assert.ok(本.substitution > 0);

  const 硕 = byName(M.solve(SEQ, job('双非硕', '双九硕')), '双九硕');
  assert.strictEqual(硕.pressure, BASE, '双九硕 上方确实无人，只剩基准');
  assert.ok(硕.pressure > 0);
});

test('基准：每层都垫，且与渗透叠加', () => {
  const opts = { spillover: K, baseline: BASE };
  const withBase = byName(M.solve(SEQ, job('双非硕', '双九硕'), opts), '双非硕').substitution;
  const noBase = byName(M.solve(SEQ, job('双非硕', '双九硕'), { spillover: K, baseline: 0 }), '双非硕').substitution;
  near(withBase, noBase + BASE);
});

// ---------- 整体 ----------

test('默认两个岗位：曲线上没有任何一点贴到 x 轴（压力、替代全为正）', () => {
  const all = M.solveAll(SEQ, M.DEFAULT_JOBS);
  assert.strictEqual(all.length, 2);
  for (const { job: j, rows } of all) {
    assert.ok(rows.length > 0, `${j.name} 应有数据`);
    for (const r of rows) {
      assert.ok(r.pressure > 0, `${j.name} / ${r.name} 挤压应为正，实得 ${r.pressure}`);
      assert.ok(r.substitution > 0, `${j.name} / ${r.name} 替代应为正，实得 ${r.substitution}`);
    }
  }
});

test('solveAll：多个岗位分别算，层数各按自己的区间', () => {
  const all = M.solveAll(SEQ, M.DEFAULT_JOBS);
  assert.strictEqual(all[0].rows.length, 5);  // 本科岗 二本~985本 = tier 0..4
  assert.strictEqual(all[1].rows.length, 5);  // 硕士岗 双非硕~双九硕 = tier 3..6
});
