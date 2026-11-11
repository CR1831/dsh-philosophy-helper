# 哲学回答评分器（DSPy GEPA）

`philosophy_metric.py` —— 给 GEPA 用的富反馈 metric。

## 为什么不用字符串匹配

上一版的四条规则里有一条是 `"弱" not in strongest_objection`。中文里「弱」是高频字（削弱、薄弱、弱点、软弱），真正的稻草人只要不含这个字就能拿满分，而一句「这条论证的薄弱处在于……」会被判死。

GEPA 会拿 feedback 去改提示词，于是它学到的不是「想得更清楚」，而是「论辩时别出现弱字」。这是 reward hacking。

所以这一版：**格式用程序判，语义用 LLM 判。**

## 两层评分

### 硬门（任一不过 → 0.0）

| 门 | 查什么 |
|---|---|
| 字段齐全 | 七个输出字段都在 |
| 非空壳 | 回答去掉套话后仍有实质长度（< 80 字直接不过） |
| 引文可追溯 | 正文出现《…》就必须在 `citations` 里申报 |

引文造假在质量分之外单独判：judge 返回 `fabricated_citations: true` 时直接 0 分。
**这样 GEPA 没法用「少写引文」换分**——它只能选择「写得准」或「老实说记不清」。

### 质量分（四项均值，LLM-as-Judge）

| 项 | 判什么 |
|---|---|
| `interpretation_distinctness` | 两个解释是否按**不同判准**分开，而不是换个说法 |
| `objection_strength` | 是否先复述对方最强版本再打 |
| `descriptive_normative` | 描述性与规范性是否分清 |
| `sourcing` | 依据标签与争议度是否标在该标的地方 |

`interpretation_distinctness` 为 0 时，总分封顶 0.6 —— 概念没分开，别的做得再好也不是哲学分析。

## 用法

```python
import dspy
from philosophy_metric import philosophy_metric, PhilosophyAnalysis

program = dspy.ChainOfThought(PhilosophyAnalysis)

gepa = dspy.GEPA(
    metric=philosophy_metric,
    auto="light",          # 或 num_threads / reflection_lm
)
optimized = gepa.compile(program, trainset=trainset, valset=valset)
```

GEPA 会这样调用两次：

```python
philosophy_metric(gold, pred, trace=None, pred_name=None, pred_trace=None)   # module 级
philosophy_metric(gold, pred, trace=None, pred_name="…", pred_trace=…)       # per-predictor
```

两次返回同一套评分；per-predictor 那次字段可能不全，按缺省处理，不会崩。

## output 字段

全部用 `str` 承载，JSON 放字符串里，兼容性最好（不依赖 Pydantic adapter）：

| 字段 | 形状 |
|---|---|
| `answer` | Markdown 正文 |
| `interpretations` | `["消极自由：不存在他人强制", "积极自由：按真正的自我实现"]` |
| `strongest_objection` | 先复述最强版本，再反驳 |
| `normative_load` | 价值负载；纯描述写 `none` |
| `citations` | `["《论自由》伤害原则"]`；查不到写 `[]` |
| `stance` | 回答所站立场 |
| `confidence` | `consensus` / `debatable` / `contested` / `speculative` |

## 缓存与兜底

- judge 结果按 `question + answer` 的 sha1 缓存，同一答案只判一次。
- judge 调用失败 → 退回启发式评分，并在 `notes` 里写明「可信度低」。
- metric 自身抛错 → 返回 `0.0` 加错误信息，**不让 GEPA 崩**。

## 冒烟测试

```bash
python philosophy_metric.py
```

不装 dspy 也能跑，验证硬门与兜底路径：

```
good  -> {'score': 0.8,  'feedback': '...'}
hollow-> {'score': 0.0,  'feedback': '硬门未过：回答只有 24 字，不够实质（下限 80）'}
empty -> {'score': 0.0,  'feedback': '硬门未过：缺字段：…'}
```

装了 dspy 且有 LM 时，`good` 那条会改走真 judge。

## 与插件的接口

面板里的案件存在 `~/.dsh/storages/philosophy-agent/cases.json`，每条 `findings[].body` 对应一个引擎的输出。
要做离线评测，把案件转成 `gold` / `pred` 对即可：

- `pred.answer` ← 拼合的 findings 正文
- `pred.citations` ← `findings[].sources`
- `pred.confidence` ← `findings[].controversy`

六个引擎各有自己的契约（见 `skills/philosophy-workbench/SKILL.md`），所以**别把所有引擎压成一个扁平 Signature**——按引擎分别定义 Signature、分别评。
