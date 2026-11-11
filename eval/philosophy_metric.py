"""DSPy GEPA 富反馈评分器：哲学回答。

契约（DSPy 2.5+ / 3.x）::

    metric(gold, pred, trace=None, pred_name=None, pred_trace=None)
        -> dspy.Prediction(score=float, feedback=str)

GEPA 每个样本调用两次：一次 module 级（pred_name=None），一次 per-predictor 级。
两个调用都返回同一套评分；per-predictor 那次字段可能不全，按缺省处理。

评分分两层
----------
硬门（任一不过 → 0.0，不再算质量）
    1. 字段齐全
    2. 非空壳（回答要有实质长度，不是「这个问题很复杂」）
    3. 引文可追溯（文中出现《…》就必须在 citations 里申报）

质量（四项均值 → 0-1，LLM-as-Judge）
    1. 解释区分度  —— 两个解释是否真的按不同判准分开
    2. 反驳强度    —— 是否先复述对方最强版本再打
    3. 描述/规范分离
    4. 依据与争议度标注

针对上一版的反 reward-hacking 修正
----------------------------------
- 不用字符串匹配判语义（删掉了 `"弱" not in objection` 这类规则）
- 引文造假是硬门，不是扣分项——GEPA 无法用「少写引文」换分
- feedback 必须指名对象，不写「可能是稻草人」，写「你打的是 X，对方最强是 Y」

用法::

    import dspy
    from philosophy_metric import philosophy_metric, PhilosophyAnalysis

    program = dspy.ChainOfThought(PhilosophyAnalysis)
    optimized = dspy.GEPA(metric=philosophy_metric, auto="light").compile(program, trainset=trainset)
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

try:  # DSPy 可选：没有它也能单测纯函数部分
    import dspy
except ImportError:  # pragma: no cover
    dspy = None  # type: ignore[assignment]


# --------------------------------------------------------------------------
# Signature
# --------------------------------------------------------------------------

if dspy is not None:

    class PhilosophyAnalysis(dspy.Signature):
        """用哲学工作台回答一个问题。默认平直克制，不铺排，不抒情。

        硬约束：
        - 触碰争议核心时句子收紧，给判准而不是漂亮话。
        - 结论段之前必须先给反方最强版本。
        - 引文只写你确实记得篇目的；记不清就写 []，禁止编造。
        - 不替提问者裁决价值排序。
        """

        question: str = dspy.InputField(desc="用户的问题，或待审查的论证原文")
        mode: str = dspy.InputField(desc="advisor 顾问 / coach 教练 / review 评审 / debate 辩论")

        answer: str = dspy.OutputField(desc="回答正文，Markdown，克制语气")
        interpretations: str = dspy.OutputField(
            desc='JSON 数组，每个元素是「概念名：一句判准」。至少两个才算区分了概念。例：["消极自由：不存在他人强制","积极自由：按真正的自我行动"]'
        )
        strongest_objection: str = dspy.OutputField(
            desc="反方最强版本：先用一到两句把对方说到最强，再给反驳。禁止直接写稻草人。"
        )
        normative_load: str = dspy.OutputField(
            desc="这段回答里承载的价值立场；纯描述性回答写 none"
        )
        citations: str = dspy.OutputField(
            desc='JSON 数组，每条形如「《篇目》要点」。查不到确切篇目就写 []，禁止编造。'
        )
        stance: str = dspy.OutputField(desc="这段回答站在哪个立场上说话")
        confidence: str = dspy.OutputField(
            desc="争议度：consensus / debatable / contested / speculative"
        )

    class _JudgeRubric(dspy.Signature):
        """给一段哲学回答打分。只评估，不改写，不补充内容。"""

        question: str = dspy.InputField()
        answer: str = dspy.InputField()
        interpretations: str = dspy.InputField()
        objection: str = dspy.InputField()
        normative: str = dspy.InputField()
        citations: str = dspy.InputField()

        verdict: str = dspy.OutputField(
            desc=(
                "严格 JSON，不要 markdown 代码块："
                '{"interpretation_distinctness":0到1,'
                '"objection_strength":0到1,'
                '"descriptive_normative":0到1,'
                '"sourcing":0到1,'
                '"fabricated_citations":true或false,'
                '"notes":"每条不足一句可操作的话，必须指名具体内容"}'
            )
        )

else:  # pragma: no cover
    PhilosophyAnalysis = None  # type: ignore[assignment]


# --------------------------------------------------------------------------
# 字段读取与容错
# --------------------------------------------------------------------------

REQUIRED_FIELDS = (
    "answer",
    "interpretations",
    "strongest_objection",
    "normative_load",
    "citations",
    "stance",
    "confidence",
)

CITATION_RE = re.compile(r"《[^》]{1,40}》")
MIN_ANSWER_CHARS = 80

# 空壳判定：整段只有这些词，视为没答
HOLLOW_MARKERS = (
    "这是一个复杂的问题",
    "这是一个复杂而深刻的问题",
    "有很多角度",
    "因人而异",
    "没有标准答案",
)


def _get(obj: Any, name: str, default: Any = None) -> Any:
    """安全读字段。dspy.Prediction 缺失键时属性访问会抛 AttributeError，这里统一兜住。"""
    try:
        value = getattr(obj, name)
    except Exception:
        value = None
    if value is None and isinstance(obj, dict):
        value = obj.get(name, default)
    return default if value is None else value


def _as_list(value: Any) -> list[str]:
    """把 list / JSON 字符串 / 普通字符串统一成 list[str]。"""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(x).strip() for x in value if str(x).strip()]
    text = str(value).strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if str(x).strip()]
        except Exception:
            pass
    return [text]


# --------------------------------------------------------------------------
# 硬门
# --------------------------------------------------------------------------

def _gate_fields(pred: Any) -> str | None:
    missing = [name for name in REQUIRED_FIELDS if _get(pred, name) in (None, "")]
    if missing:
        return "缺字段：" + "、".join(missing)
    return None


def _gate_substance(pred: Any) -> str | None:
    answer = str(_get(pred, "answer", ""))
    body = answer.strip()
    if len(body) < MIN_ANSWER_CHARS:
        return f"回答只有 {len(body)} 字，不够实质（下限 {MIN_ANSWER_CHARS}）"
    stripped = body
    for marker in HOLLOW_MARKERS:
        stripped = stripped.replace(marker, "")
    if len(stripped.strip()) < MIN_ANSWER_CHARS * 0.5:
        return "回答主要靠空话填充，去掉套话后几乎没有内容"
    return None


def _gate_citations(pred: Any) -> str | None:
    """文中出现《…》就必须在 citations 里申报。申报了但完全是另一批，也算不过。"""
    answer = str(_get(pred, "answer", ""))
    in_text = set(CITATION_RE.findall(answer))
    declared_raw = _as_list(_get(pred, "citations"))
    declared_text = " ".join(declared_raw)
    declared = set(CITATION_RE.findall(declared_text))

    if in_text and not declared:
        return "正文引了 " + "、".join(sorted(in_text)[:3]) + "，但 citations 是空的——要么补申报，要么别引"

    if declared:
        unexplained = {c for c in declared if c not in in_text and c not in answer}
        if len(unexplained) == len(declared) and in_text:
            return "citations 申报的篇目和正文里的引文完全对不上"
    return None


def _hard_gates(pred: Any) -> list[str]:
    problems = []
    for gate in (_gate_fields, _gate_substance, _gate_citations):
        failure = gate(pred)
        if failure:
            problems.append(failure)
    return problems


# --------------------------------------------------------------------------
# LLM-as-Judge
# --------------------------------------------------------------------------

_JUDGE_CACHE: dict[str, dict[str, Any]] = {}
_JUDGE_PREDICTOR: Any = None


def _judge_predictor() -> Any:
    global _JUDGE_PREDICTOR
    if _JUDGE_PREDICTOR is None:
        _JUDGE_PREDICTOR = dspy.Predict(_JudgeRubric)  # type: ignore[union-attr]
    return _JUDGE_PREDICTOR


def _parse_verdict(raw: Any) -> dict[str, Any] | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _clamp(value: Any, low: float = 0.0, high: float = 1.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return low
    return max(low, min(high, number))


def _judge(pred: Any) -> dict[str, Any]:
    """调 judge；失败时返回启发式兜底并把原因写进 notes。"""
    question = str(_get(pred, "question", _get(pred, "_question", "")))
    answer = str(_get(pred, "answer", ""))
    key = hashlib.sha1((question + "\u0000" + answer).encode("utf-8")).hexdigest()
    if key in _JUDGE_CACHE:
        return _JUDGE_CACHE[key]

    if dspy is None:
        data = _heuristic_scores(pred)
        data["notes"] = "未安装 dspy，使用启发式评分（仅供冒烟测试，不可用于真实优化）"
        _JUDGE_CACHE[key] = data
        return data

    try:
        raw = _judge_predictor()(
            question=question or "(未提供)",
            answer=answer,
            interpretations=str(_get(pred, "interpretations", "")),
            objection=str(_get(pred, "strongest_objection", "")),
            normative=str(_get(pred, "normative_load", "")),
            citations=str(_get(pred, "citations", "")),
        )
        data = _parse_verdict(getattr(raw, "verdict", None))
    except Exception as error:  # judge 不可用不该让 GEPA 崩
        data = None
        fallback_note = f"judge 调用失败，退回启发式评分：{error}"
    else:
        fallback_note = ""

    if data is None:
        data = _heuristic_scores(pred)
        if fallback_note:
            data["notes"] = (data.get("notes", "") + "；" + fallback_note).strip("；")
        elif not data.get("notes"):
            data["notes"] = "judge 输出无法解析为 JSON，退回启发式评分"

    _JUDGE_CACHE[key] = data
    return data


def _heuristic_scores(pred: Any) -> dict[str, Any]:
    """没有 judge 时的兜底：只做结构判断，明确标出这是低可信度评分。"""
    interpretations = _as_list(_get(pred, "interpretations", ""))
    objection = str(_get(pred, "strongest_objection", ""))
    normative = str(_get(pred, "normative_load", ""))
    citations = _as_list(_get(pred, "citations", ""))
    confidence = str(_get(pred, "confidence", ""))

    distinct = 1.0 if len({i.split("：")[0].split(":")[0].strip() for i in interpretations}) >= 2 else 0.0
    mentions_other = any(word in objection for word in ("对方", "反方", "他们会说", "最强版本", "最强的说法"))
    objection_score = 0.7 if mentions_other else 0.2
    normative_score = 1.0 if normative and normative.lower() not in ("none", "n/a", "无") else 0.4
    sourcing_score = 1.0 if citations else 0.5
    if confidence.lower() not in ("consensus", "debatable", "contested", "speculative", "共识", "可辩", "争议", "推测"):
        sourcing_score = max(0.0, sourcing_score - 0.3)

    return {
        "interpretation_distinctness": distinct,
        "objection_strength": objection_score,
        "descriptive_normative": normative_score,
        "sourcing": sourcing_score,
        "fabricated_citations": False,
        "notes": "无 judge 的启发式评分，可信度低，仅用于冒烟测试",
    }


# --------------------------------------------------------------------------
# feedback
# --------------------------------------------------------------------------

def _feedback_lines(pred: Any, verdict: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    notes = str(verdict.get("notes", "")).strip()
    if notes:
        lines.append(notes)

    interpretations = _as_list(_get(pred, "interpretations", ""))
    if len(interpretations) < 2:
        lines.append("只给了一种解释；补第二条时必须换一个判准，不是换个说法")
    else:
        heads = {i.split("：")[0].split(":")[0].strip() for i in interpretations}
        if len(heads) < 2:
            lines.append("两个解释的名字相同，等于没区分")

    objection = str(_get(pred, "strongest_objection", "")).strip()
    if not objection:
        lines.append("缺 strongest_objection：结论前必须先给反方最强版本")
    elif _clamp(verdict.get("objection_strength")) < 0.5:
        excerpt = objection[:40].replace("\n", " ")
        lines.append(f"反驳打的是「{excerpt}…」这一版，不是对方最强版本；先把对方说到最强再打")

    normative = str(_get(pred, "normative_load", "")).strip().lower()
    if normative in ("", "none", "n/a", "无", "不适用"):
        if _clamp(verdict.get("descriptive_normative")) < 0.5:
            lines.append("没识别出价值负载；如果确实没有，也要明说这是纯描述")

    if verdict.get("fabricated_citations"):
        lines.append("judge 判定有编造引文，这条应直接判 0；请删掉或改成「记不清具体篇目」")

    return lines


# --------------------------------------------------------------------------
# metric
# --------------------------------------------------------------------------

QUALITY_KEYS = (
    "interpretation_distinctness",
    "objection_strength",
    "descriptive_normative",
    "sourcing",
)


def _pack(score: float, feedback: str) -> Any:
    score = round(max(0.0, min(1.0, score)), 4)
    if dspy is not None:
        return dspy.Prediction(score=score, feedback=feedback)
    return {"score": score, "feedback": feedback}


def philosophy_metric(gold: Any, pred: Any, trace: Any = None, pred_name: Any = None, pred_trace: Any = None) -> Any:
    """GEPA 富反馈 metric。返回 dspy.Prediction(score, feedback)。"""
    try:
        problems = _hard_gates(pred)
        if problems:
            return _pack(0.0, "硬门未过：" + "；".join(problems))

        verdict = _judge(pred)
        if verdict.get("fabricated_citations"):
            return _pack(
                0.0,
                "硬门未过：judge 判定存在编造引文。删掉它们，或改写为「记不清具体篇目」。",
            )

        quality = sum(_clamp(verdict.get(key)) for key in QUALITY_KEYS) / len(QUALITY_KEYS)
        lines = _feedback_lines(pred, verdict)
        feedback = "；".join(line for line in lines if line) or "四项均达标：解释按判准分开、先复述最强版本再反驳、价值负载已标明、引文有申报"
        if _clamp(verdict.get("interpretation_distinctness")) == 0:
            quality = min(quality, 0.6)
        return _pack(quality, feedback)
    except Exception as error:  # metric 自身出错不能让 GEPA 崩
        return _pack(0.0, f"metric 自身出错：{type(error).__name__}: {error}")


__all__ = [
    "PhilosophyAnalysis",
    "philosophy_metric",
]


# --------------------------------------------------------------------------
# 冒烟测试：不依赖 LM，只验硬门与兜底路径
# --------------------------------------------------------------------------

if __name__ == "__main__":  # pragma: no cover
    class _Fake:
        def __init__(self, **kw: Any) -> None:
            self._d = kw

        def __getattr__(self, name: str) -> Any:
            if name in self._d:
                return self._d[name]
            raise AttributeError(name)

        def get(self, name: str, default: Any = None) -> Any:
            return self._d.get(name, default)

    good = _Fake(
        question="自由是人的本质吗",
        answer="分三义。消极自由指无人强制；积极自由指按真正的自我行动；形而上学自由指不由外因完全决定。三者对「本质」的相容性不同，只有第三支必须是本质。" * 2,
        interpretations='["消极自由：不存在他人强制","积极自由：按真正的自我行动"]',
        strongest_objection="密尔会反问：若自由是本质，被舆论压制的社会里人是否就不算人？他给的是条件论证，不是本质论证。",
        normative_load="承认自由具有不可让渡的优先性",
        citations='["《论自由》伤害原则"]',
        stance="分析性，不下判决",
        confidence="debatable",
    )

    hollow = _Fake(
        question="x",
        answer="这是一个复杂而深刻的问题，有很多角度，因人而异。",
        interpretations="[]",
        strongest_objection="对方太弱了",
        normative_load="none",
        citations="[]",
        stance="中立",
        confidence="consensus",
    )

    print("good  ->", philosophy_metric(None, good))
    print("hollow->", philosophy_metric(None, hollow))
    print("empty ->", philosophy_metric(None, _Fake()))
