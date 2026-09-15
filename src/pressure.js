/**
 * 学历序列就业压力 · 核心引擎（纯函数，浏览器 + Node 通用）
 *
 * 输入：一个「序列」（每层学历 + 人数 + 位次 tier，同 tier = 并列）＋ 一个「岗位」（学历区间 + 类型）
 * 输出：区间内每层学历的「挤压阻力」（上方往下挤）与「替代压力」（下方往上顶）。
 *
 * 两种岗位类型：
 *   - normal 普通岗：压力 = 区间内、位次更高的学历人数；替代 = 位次更低的学历人数（上下不对称，同层不算）
 *   - exam   考试岗：只看分数和门槛，过了门槛学历高低不起作用 → 压力 = 替代 = 区间内**总人数（含本层）**。
 *             它描述的是「池子规模」，与是哪一层无关，所以区间内每层取值相同 —— 一条水平线。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PressureModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 默认序列（8 层）：二本 < 双非 < 211本 < 双非硕 < 985本 < 211硕 < [985硕 = 双九硕]
  // 985本 故意压得低：这一档大部分去读研了，真正进就业市场的很少
  var DEFAULT_SEQUENCE = [
    { name: '二本',   count: 50000, tier: 0 },
    { name: '双非',   count: 25000, tier: 1 },
    { name: '211本',  count: 10000, tier: 2 },
    { name: '双非硕', count: 15000, tier: 3 },
    { name: '985本',  count: 5000,  tier: 4 },
    { name: '211硕',  count: 8000,  tier: 5 },
    { name: '985硕',  count: 6000,  tier: 6 },
    { name: '双九硕', count: 3000,  tier: 6 },
  ];

  // 默认岗位：本科岗（二本 ~ 985本）＋ 硕士岗（双非硕 ~ 双九硕）
  // 两个区间在 双非硕 / 985本 处重叠 —— 这正是「本科可投、硕士也来」的那条边界
  var DEFAULT_JOBS = [
    { name: '本科岗', type: 'normal', lower: '二本',   upper: '985本' },
    { name: '硕士岗', type: 'normal', lower: '双非硕', upper: '双九硕' },
  ];

  // 边界渗透率：紧邻区间外的一档按这个比例计入，再往外按它的幂衰减
  var DEFAULT_SPILLOVER = 0.15;
  // 基准竞争：每层垫的底。序列最顶 / 最底那两档只能靠它避免归零
  var DEFAULT_BASELINE = 500;

  /**
   * 算一个岗位在序列上的结果。
   *
   * 两条修正，都是为了让「压力恰好为 0」这种不真实的情况不出现：
   *   1) 边界渗透 spillover：岗位区间不是硬墙。区间外紧邻的学历按 k 计入，再往外按 k 的幂衰减。
   *      岗位写「985本~双九硕」，双非硕的人照样会投，只是量级小得多。
   *   2) 基准竞争 baseline：无论什么岗位，总有一批人跨区间乱投，给每层垫一个固定底。
   *      序列最顶端（上方确实无人）和最底层（下方确实无人）只能靠这个兜底。
   *
   * @param {Array} sequence [{name, count, tier}]
   * @param {Object} job {name, type:'normal'|'exam', lower, upper}
   * @param {Object} [opts] {spillover, baseline} 不传则用默认值
   * @returns {Array} 区间内每层 {name, tier, count, pressure, substitution, pressureRatio, substitutionRatio}
   */
  function solve(sequence, job, opts) {
    var o = opts || {};
    var k = o.spillover != null ? o.spillover : DEFAULT_SPILLOVER;
    var base = o.baseline != null ? o.baseline : DEFAULT_BASELINE;

    var byName = {};
    sequence.forEach(function (l) { byName[l.name] = l.tier; });

    var lt = byName[job.lower];
    var ut = byName[job.upper];
    if (lt == null || ut == null) return []; // 区间端点不在序列里

    var lo = Math.min(lt, ut);
    var hi = Math.max(lt, ut);
    var inRange = sequence.filter(function (l) { return l.tier >= lo && l.tier <= hi; });
    var isExam = job.type === 'exam';

    // 到区间的 tier 距离：区间内 = 0，区间外 = 隔了几档
    function distOutside(tier) {
      if (tier >= lo && tier <= hi) return 0;
      return tier < lo ? lo - tier : tier - hi;
    }
    // 权重：区间内算满，区间外按渗透率逐档衰减
    function weight(tier) {
      var d = distOutside(tier);
      return d === 0 ? 1 : Math.pow(k, d);
    }

    // 考试岗：只看分数和门槛，过了门槛学历高低不起作用 ——
    // 区间内每一层面对的都是**同一个池子**，所以压力 = 区间内总人数（含本层）＋渗透＋基准。
    // 它与「是哪一层」无关，所有层取值相同 —— 画出来是一条**水平线**。
    // 注意这里**不排除本层**：压力描述的是池子规模，你自己也在池子里。
    var examPool = 0;
    if (isExam) {
      examPool = base;
      sequence.forEach(function (ol) { examPool += ol.count * weight(ol.tier); });
    }

    var out = [];

    for (var i = 0; i < inRange.length; i++) {
      var l = inRange[i];
      var pressure = 0;
      var substitution = 0;

      if (isExam) {
        pressure = substitution = examPool;
      } else {
        // 遍历整条序列，不再只遍历区间内 —— 区间外的人也会来投
        for (var j = 0; j < sequence.length; j++) {
          var ol = sequence[j];
          if (ol.name === l.name) continue;
          if (ol.tier === l.tier) continue;   // 同 tier 并列，既不算挤也不算替

          var w = weight(ol.tier);
          if (ol.tier > l.tier) pressure += ol.count * w;   // 上方往下挤
          else substitution += ol.count * w;                // 下方往上顶
        }
        pressure += base;
        substitution += base;
      }

      out.push({
        name: l.name,
        tier: l.tier,
        count: l.count,
        pressure: pressure,
        substitution: substitution,
        pressureRatio: l.count ? pressure / l.count : null,
        substitutionRatio: l.count ? substitution / l.count : null,
      });
    }
    return out;
  }

  /** 一组岗位分别算，返回 { job, rows } */
  function solveAll(sequence, jobs, opts) {
    return (jobs || []).map(function (job) {
      return { job: job, rows: solve(sequence, job, opts) };
    });
  }

  return {
    DEFAULT_SEQUENCE: DEFAULT_SEQUENCE,
    DEFAULT_JOBS: DEFAULT_JOBS,
    DEFAULT_SPILLOVER: DEFAULT_SPILLOVER,
    DEFAULT_BASELINE: DEFAULT_BASELINE,
    solve: solve,
    solveAll: solveAll,
  };
});
