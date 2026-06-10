#!/usr/bin/env python3
import json
import os
import re
import shutil
import subprocess
import tempfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(BASE, "website")
TASKS_DIR = os.path.join(BASE, "WM-H-tasks")
WO_SA_TASKS_DIR = os.path.join(BASE, "wm-h-wo-sa-tasks")
IMAGE_DPI = 2400
FIGURES = (
    ("teaser (2).pdf", "teaser.png"),
    ("wm-h.pdf", "wm-h.png"),
    ("model2.pdf", "model2.png"),
    ("exp-setup.pdf", "exp-setup.png"),
)

PIPELINE_ASSETS = (
    ("hand_motion.mp4", "hand_motion.mp4"),
    ("desktop/img_20260316_225124_466615.jpg", "scene-bg.jpg"),
    ("video/gpu0_task000000/000000.jpg", "scene-edited.jpg"),
)

POLICY_ASSETS = (
    ("hand-mesh-state.png", "hand-mesh-state.png"),
    ("hand-mesh-action.png", "hand-mesh-action.png"),
)


def parse_instruction(desc):
    match = re.search(r"Right hand:\s*(.+)", desc, re.I)
    return match.group(1).strip() if match else desc.strip()


def load_tasks():
    tasks = {}
    for name in sorted(os.listdir(TASKS_DIR)):
        if not name.endswith(".json"):
            continue
        task_id = name[:-5]
        with open(os.path.join(TASKS_DIR, name), encoding="utf-8") as handle:
            data = json.load(handle)
        tasks[task_id] = parse_instruction(data["task_description"])
    return tasks


def load_wo_sa_tasks():
    tasks = {}
    for name in sorted(os.listdir(WO_SA_TASKS_DIR)):
        if not name.endswith("_task_en.json"):
            continue
        task_id = name[: -len("_task_en.json")]
        with open(os.path.join(WO_SA_TASKS_DIR, name), encoding="utf-8") as handle:
            data = json.load(handle)
        tasks[task_id] = data["task_description"].strip()
    return tasks


def build_list(src_dir, tasks=None, skip_demo=False, task_key=None):
    items = []
    for name in sorted(os.listdir(src_dir)):
        if not name.endswith(".mp4"):
            continue
        if skip_demo and name.startswith("demo"):
            continue
        stem = name[:-4]
        lookup = task_key(stem) if task_key else stem
        instruction = tasks.get(lookup, stem) if tasks else stem
        items.append({"file": name, "instruction": instruction})
    return items


def sync_images():
    dst_dir = os.path.join(WEB, "assets", "images")
    os.makedirs(dst_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        for pdf_name, png_name in FIGURES:
            pdf_path = os.path.join(BASE, pdf_name)
            if not os.path.isfile(pdf_path):
                print(f"  skip image (missing): {pdf_name}")
                continue

            subprocess.run(
                [
                    "qlmanage",
                    "-t",
                    "-s",
                    str(IMAGE_DPI),
                    "-o",
                    tmp_dir,
                    pdf_path,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            generated = os.path.join(tmp_dir, f"{pdf_name}.png")
            shutil.move(generated, os.path.join(dst_dir, png_name))
            print(f"  image: {png_name} ({IMAGE_DPI}px)")


def sync_pipeline_assets():
    dst_dir = os.path.join(WEB, "assets", "pipeline")
    os.makedirs(dst_dir, exist_ok=True)
    for src_rel, dst_name in PIPELINE_ASSETS:
        src_path = os.path.join(BASE, src_rel)
        if not os.path.isfile(src_path):
            print(f"  skip pipeline asset (missing): {src_rel}")
            continue
        shutil.copy2(src_path, os.path.join(dst_dir, dst_name))
        print(f"  pipeline: {dst_name}")


def sync_policy_assets():
    dst_dir = os.path.join(WEB, "assets", "images")
    os.makedirs(dst_dir, exist_ok=True)
    for src_rel, dst_name in POLICY_ASSETS:
        src_path = os.path.join(BASE, src_rel)
        if not os.path.isfile(src_path):
            print(f"  skip policy asset (missing): {src_rel}")
            continue
        shutil.copy2(src_path, os.path.join(dst_dir, dst_name))
        print(f"  policy: {dst_name}")


def write_asset_versions():
    versions = {}
    for rel_dir in ("assets/images", "assets/pipeline"):
        src_dir = os.path.join(WEB, rel_dir)
        if not os.path.isdir(src_dir):
            continue
        for name in os.listdir(src_dir):
            if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                continue
            path = os.path.join(src_dir, name)
            versions[f"{rel_dir}/{name}"] = int(os.path.getmtime(path))

    data_dir = os.path.join(WEB, "data")
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, "assets.js"), "w", encoding="utf-8") as handle:
        handle.write("window.ASSET_VERSIONS = ")
        json.dump(versions, handle, ensure_ascii=False)
        handle.write(";\n")


def sync_videos(src_dir, dst_dir, skip_demo=False):
    os.makedirs(dst_dir, exist_ok=True)
    for name in os.listdir(dst_dir):
        if name.endswith(".mp4"):
            os.remove(os.path.join(dst_dir, name))
    for name in os.listdir(src_dir):
        if not name.endswith(".mp4"):
            continue
        if skip_demo and name.startswith("demo"):
            continue
        shutil.copy2(os.path.join(src_dir, name), os.path.join(dst_dir, name))


def main():
    tasks = load_tasks()
    wo_sa_tasks = load_wo_sa_tasks()
    manifest = {
        "robot": build_list(os.path.join(BASE, "wh0_video"), skip_demo=True),
        "wmh": build_list(os.path.join(BASE, "video"), tasks),
        "wmh_wo_sa": build_list(
            os.path.join(BASE, "wm-h-wo-sa"),
            wo_sa_tasks,
            task_key=lambda stem: stem[: -len("_video")] if stem.endswith("_video") else stem,
        ),
        "wmh_ea": build_list(os.path.join(BASE, "WM-H-EA"), tasks),
    }

    data_dir = os.path.join(WEB, "data")
    os.makedirs(data_dir, exist_ok=True)

    with open(os.path.join(data_dir, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)

    with open(os.path.join(data_dir, "manifest.js"), "w", encoding="utf-8") as handle:
        handle.write("window.VIDEO_MANIFEST = ")
        json.dump(manifest, handle, ensure_ascii=False)
        handle.write(";\n")

    sync_videos(os.path.join(BASE, "wh0_video"), os.path.join(WEB, "assets/video/wh0"), skip_demo=True)
    sync_videos(os.path.join(BASE, "video"), os.path.join(WEB, "assets/video/wmh"))
    sync_videos(os.path.join(BASE, "wm-h-wo-sa"), os.path.join(WEB, "assets/video/wmh-wo-sa"))
    sync_videos(os.path.join(BASE, "WM-H-EA"), os.path.join(WEB, "assets/video/wmh-ea"))
    sync_images()
    sync_pipeline_assets()
    sync_policy_assets()
    write_asset_versions()

    print("Synced manifest, videos, and images:")
    for key, items in manifest.items():
        print(f"  {key}: {len(items)}")


if __name__ == "__main__":
    main()
