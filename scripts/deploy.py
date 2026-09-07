"""Publish the Three.js production build to a static Hugging Face Space.
Usage: python scripts/deploy.py [commit message] [namespace/space]
"""
from pathlib import Path
import sys
import os
from huggingface_hub import HfApi

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
if not (dist / "index.html").exists():
    raise SystemExit("Run npm run build before deployment.")
api = HfApi()
repo = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("HF_SPACE_REPO", "sankalphs/singularity")
api.create_repo(repo, repo_type="space", space_sdk="static", exist_ok=True)
(dist / "README.md").write_text((root / "README.md").read_text(encoding="utf-8"), encoding="utf-8")
# Replace obsolete hosted build files while preserving Space configuration.
info = api.upload_folder(
    repo_id=repo, repo_type="space", folder_path=str(dist),
    delete_patterns=["assets/*", "native/**", "web/**"],
    commit_message=sys.argv[1] if len(sys.argv) > 1 else "Deploy three-course coordination game",
)
print(info.commit_url)
print("https://huggingface.co/spaces/" + repo)
