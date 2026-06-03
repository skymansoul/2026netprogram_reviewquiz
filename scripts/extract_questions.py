import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "fuxi_clean_qa.docx"
OUTPUT = ROOT / "app" / "data.js"
NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def read_docx_paragraphs(path: Path) -> list[str]:
    with ZipFile(path) as archive:
        document = archive.read("word/document.xml")

    root = ET.fromstring(document)
    paragraphs: list[str] = []
    for paragraph in root.iter(NS + "p"):
        text = "".join(node.text or "" for node in paragraph.iter(NS + "t")).strip()
        if text:
            paragraphs.append(text)
    return paragraphs


def is_section(text: str) -> bool:
    return bool(re.match(r"^[一二三四五六七八九十]+、", text))


QUESTION_RE = re.compile(r"^(\d+)\.\s*（(.+?)题[,，]\s*(\d+)分）\s*(.*)$")


def is_question_start(text: str) -> bool:
    return bool(QUESTION_RE.match(text))


def is_answer_marker(text: str) -> bool:
    return text in {"答案：", "答案:", "参考答案：", "参考答案:"}


def parse_questions(paragraphs: list[str]) -> tuple[str, list[dict]]:
    title = paragraphs[0]
    questions: list[dict] = []
    current_section = ""
    index = 0

    while index < len(paragraphs):
        text = paragraphs[index]

        if is_section(text):
            current_section = text
            index += 1
            continue

        if not is_question_start(text):
            index += 1
            continue

        match = QUESTION_RE.match(text)
        if not match:
            index += 1
            continue

        number, kind, score, inline_prompt = match.groups()
        index += 1
        prompt: list[str] = []
        answer: list[str] = []
        target = prompt

        if inline_prompt:
            prompt.append(inline_prompt)

        while index < len(paragraphs):
            candidate = paragraphs[index]
            if is_section(candidate) or is_question_start(candidate):
                break
            if is_answer_marker(candidate):
                target = answer
                index += 1
                continue
            target.append(candidate)
            index += 1

        prompt_text = "\n".join(prompt).strip()
        answer_text = "\n".join(answer).strip()
        questions.append(
            {
                "id": f"q{len(questions) + 1}",
                "number": int(number),
                "type": kind,
                "score": int(score),
                "section": current_section,
                "prompt": prompt_text,
                "answer": answer_text,
            }
        )

    return title, questions


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source file: {SOURCE}")

    title, questions = parse_questions(read_docx_paragraphs(SOURCE))
    type_counts: dict[str, int] = {}
    for item in questions:
        type_counts[item["type"]] = type_counts.get(item["type"], 0) + 1

    payload = {
        "title": title,
        "source": SOURCE.name,
        "total": len(questions),
        "typeCounts": type_counts,
        "questions": questions,
    }

    OUTPUT.write_text(
        "window.QUESTION_BANK = "
        + json.dumps(payload, ensure_ascii=True, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(questions)} questions to {OUTPUT}")
    print(type_counts)


if __name__ == "__main__":
    main()
