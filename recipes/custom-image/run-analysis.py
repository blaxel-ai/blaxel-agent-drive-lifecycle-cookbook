#!/usr/bin/env python3
import argparse
import json
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    response = subprocess.run(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "30",
            "--header",
            "Accept: application/json",
            args.source,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(response.stdout)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    if isinstance(payload, list):
        record_count = len(payload)
    elif isinstance(payload, dict) and isinstance(payload.get("records"), list):
        record_count = len(payload["records"])
    elif isinstance(payload, dict):
        record_count = len(payload)
    else:
        record_count = 1

    print(
        json.dumps(
            {
                "artifact": str(output),
                "records": record_count,
                "status": "completed",
            }
        )
    )


if __name__ == "__main__":
    main()
