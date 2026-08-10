import json
import shutil
import tempfile
import unittest
from pathlib import Path

from scripts.apply_verified_address_fixes import DEFAULT_FIXES, apply_manifest
from scripts.sync_naver_addresses import SyncError
from scripts.update_restaurants import (
    DEFAULT_ADMIN_DATA,
    DEFAULT_BASE_CSV,
    DEFAULT_OUTPUT,
    load_targets,
)


PROTECTED_FIELDS = (
    "name",
    "naverPlaceUrl",
    "imageUrl",
    "category",
    "categoryDetail",
    "mainDishes",
    "searchTags",
    "registrationType",
    "verifiedBadge",
    "evidenceUrl",
    "evidenceText",
)


class ApplyVerifiedAddressFixesTests(unittest.TestCase):
    def copy_preapply_output(self, output: Path) -> None:
        manifest = json.loads(DEFAULT_FIXES.read_text(encoding="utf-8"))
        fix_keys = {item["targetKey"] for item in manifest["fixes"]}
        overrides = json.loads(DEFAULT_OUTPUT.read_text(encoding="utf-8"))
        preapply = [item for item in overrides if item.get("targetKey") not in fix_keys]
        output.write_text(
            json.dumps(preapply, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def test_manifest_updates_only_22_addresses_and_regions(self) -> None:
        manifest = json.loads(DEFAULT_FIXES.read_text(encoding="utf-8"))
        fix_by_key = {item["targetKey"]: item for item in manifest["fixes"]}
        self.assertEqual(22, len(fix_by_key))

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "restaurant-overrides.json"
            self.copy_preapply_output(output)
            before, _ = load_targets(DEFAULT_BASE_CSV, DEFAULT_ADMIN_DATA, output)

            result = apply_manifest(DEFAULT_FIXES, output=output)

            after, _ = load_targets(DEFAULT_BASE_CSV, DEFAULT_ADMIN_DATA, output)
            self.assertEqual(22, result["updated"])
            self.assertEqual(len(before), len(after))
            for key, current in before.items():
                updated = after[key]
                for field in PROTECTED_FIELDS:
                    self.assertEqual(current.get(field), updated.get(field), (key, field))
                if key in fix_by_key:
                    fix = fix_by_key[key]
                    self.assertEqual(fix["address"], updated["address"])
                    self.assertEqual(fix["region"], updated["region"])
                    self.assertEqual("github-naver-address-sync", updated["updateSource"])
                else:
                    self.assertEqual(current, updated, key)

    def test_manifest_rejects_current_address_drift_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            output = directory_path / "restaurant-overrides.json"
            fixes = directory_path / "verified-address-fixes.json"
            self.copy_preapply_output(output)
            manifest = json.loads(DEFAULT_FIXES.read_text(encoding="utf-8"))
            manifest["fixes"][0]["currentAddress"] = "감사 이후 바뀐 주소"
            fixes.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            original = output.read_bytes()

            with self.assertRaisesRegex(SyncError, "현재 주소가 감사 이후 변경"):
                apply_manifest(fixes, output=output)

            self.assertEqual(original, output.read_bytes())

    def test_manifest_is_a_noop_after_all_fixes_are_applied(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "restaurant-overrides.json"
            shutil.copyfile(DEFAULT_OUTPUT, output)
            original = output.read_bytes()

            result = apply_manifest(DEFAULT_FIXES, output=output)

            self.assertEqual(0, result["updated"])
            self.assertEqual(original, output.read_bytes())


if __name__ == "__main__":
    unittest.main()
