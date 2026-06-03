"""A5:ER フィクスチャ生成スクリプト。

tests/fixtures/a5er/ に fixture_100tables.a5er (テキスト形式) と
fixture_100tables.a5er.xml (XML 形式) を生成する。

使い方:
    uv run scripts/gen_a5er_fixture.py
    uv run scripts/gen_a5er_fixture.py --tables 200 --out tests/fixtures/a5er

テーブル数・出力先は引数で変更可能。再生成時はファイルを上書きする。
"""

from __future__ import annotations

import argparse
from pathlib import Path


def gen_text(num_tables: int) -> str:
    """テキスト形式 A5:ER を生成する。"""
    lines: list[str] = [
        "# A5:ER FORMAT:19",
        "# A5:ER ENCODING:UTF-8",
        "",
    ]

    for i in range(1, num_tables + 1):
        x = ((i - 1) % 10) * 200
        y = ((i - 1) // 10) * 250
        lines += [
            "[Entity]",
            f"PName=table_{i:03d}",
            f"LName=Table {i:03d}",
            f"Comment=Fixture table {i:03d}",
            "Page=MAIN",
            f"Left={x}",
            f"Top={y}",
            'Field="id","id","INT","NOT NULL",0,"",""',
            'Field="name","name","NVARCHAR(100)","NOT NULL","","",""',
            'Field="value","value","NVARCHAR(255)","NULL","","",""',
            'Field="created_at","created_at","DATETIME","NULL","","",""',
            'Field="updated_at","updated_at","DATETIME","NULL","","",""',
            "DEL",
            "",
        ]

    for i in range(1, num_tables):
        lines += [
            "[Relation]",
            f"Entity1=table_{i:03d}",
            f"Entity2=table_{i + 1:03d}",
            "RelationType1=2",
            "RelationType2=3",
            "Fields1=id",
            "Fields2=id",
            "Dependence=0",
            "DEL",
            "",
        ]

    return "\n".join(lines) + "\n"


def gen_xml(num_tables: int) -> str:
    """XML 形式 A5:ER を生成する。"""
    lines: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<A5ER Name="Fixture100Tables" DatabaseType="SQLServer">',
    ]

    for i in range(1, num_tables + 1):
        x = ((i - 1) % 10) * 200
        y = ((i - 1) // 10) * 250
        lines += [
            f'  <Entity Name="table_{i:03d}" LogicalName="Table {i:03d}"'
            f' Comment="Fixture table {i:03d}" Page="MAIN" X="{x}" Y="{y}">',
            '    <Attribute Name="id" LogicalName="id" Type="INT" Nullable="false" PK="true"/>',
            '    <Attribute Name="name" LogicalName="name" Type="NVARCHAR" Size="100" Nullable="false"/>',
            '    <Attribute Name="value" LogicalName="value" Type="NVARCHAR" Size="255" Nullable="true"/>',
            '    <Attribute Name="created_at" LogicalName="created_at" Type="DATETIME" Nullable="true"/>',
            '    <Attribute Name="updated_at" LogicalName="updated_at" Type="DATETIME" Nullable="true"/>',
            "  </Entity>",
        ]

    for i in range(1, num_tables):
        lines.append(
            f'  <Relation Name="FK_table_{i + 1:03d}_table_{i:03d}"'
            f' ParentEntity="table_{i:03d}" ChildEntity="table_{i + 1:03d}"'
            ' ParentAttribute="id" ChildAttribute="id" Cardinality="1:N"/>'
        )

    lines.append("</A5ER>")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tables", type=int, default=100, help="生成するテーブル数 (default: 100)")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).parent.parent / "tests" / "fixtures" / "a5er",
        help="出力先ディレクトリ",
    )
    args = parser.parse_args()

    if not (1 <= args.tables <= 10_000):
        raise SystemExit("Error: --tables must be between 1 and 10000")

    repo_root = Path(__file__).parent.parent.resolve()
    out_dir = args.out.resolve()
    if not str(out_dir).startswith(str(repo_root)):
        raise SystemExit(f"Error: --out must be within the repository root ({repo_root})")

    out_dir.mkdir(parents=True, exist_ok=True)

    text_path = out_dir / f"fixture_{args.tables}tables.a5er"
    xml_path = out_dir / f"fixture_{args.tables}tables.a5er.xml"

    text_path.write_text(gen_text(args.tables), encoding="utf-8")
    xml_path.write_text(gen_xml(args.tables), encoding="utf-8")

    print(f"Generated: {text_path} ({text_path.stat().st_size} bytes)")
    print(f"Generated: {xml_path}  ({xml_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
