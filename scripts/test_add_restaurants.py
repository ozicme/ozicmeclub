import csv
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.add_restaurants import RegistrationError, register


class AddRestaurantsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.base_csv = self.root / "base.csv"
        self.output = self.root / "admin.json"
        with self.base_csv.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["상호명", "대표주소"])
            writer.writeheader()
            writer.writerow({"상호명": "기존식당", "대표주소": "서울 강남구 테헤란로 1"})
        self.output.write_text("[]\n", encoding="utf-8")
        self.now = datetime(2026, 8, 8, tzinfo=timezone.utc)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_adds_single_ozicme_restaurant(self):
        payload = json.dumps(
            {
                "name": "새식당",
                "address": "서울 마포구 월드컵로 10",
                "isOzicmeCustomer": True,
                "mainDishes": ["솥밥"],
            },
            ensure_ascii=False,
        )
        result = register(payload, self.base_csv, self.output, now=self.now)
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(result["added"], 1)
        self.assertTrue(saved[0]["verifiedBadge"])
        self.assertEqual(saved[0]["region"]["sido"], "서울특별시")
        self.assertEqual(saved[0]["badgeLabel"], "오직미클럽")

    def test_skips_duplicate_in_base(self):
        payload = json.dumps(
            {
                "name": "기존 식당",
                "address": "서울특별시 강남구 테헤란로 1",
                "isOzicmeCustomer": True,
            },
            ensure_ascii=False,
        )
        result = register(payload, self.base_csv, self.output, now=self.now)
        self.assertEqual(result["added"], 0)
        self.assertEqual(result["skipped"], 1)

    def test_rejects_non_http_url(self):
        payload = json.dumps(
            {
                "name": "잘못된링크식당",
                "address": "서울 종로구 종로 1",
                "naverPlaceUrl": "javascript:alert(1)",
                "isOzicmeCustomer": True,
            },
            ensure_ascii=False,
        )
        with self.assertRaises(RegistrationError):
            register(payload, self.base_csv, self.output, now=self.now)

    def test_requires_evidence_for_external_restaurant(self):
        payload = json.dumps(
            {
                "name": "외부식당",
                "address": "경기 수원시 팔달구 1",
                "isOzicmeCustomer": False,
            },
            ensure_ascii=False,
        )
        with self.assertRaises(RegistrationError):
            register(payload, self.base_csv, self.output, now=self.now)

    def test_adds_multiple_and_skips_duplicate_in_batch(self):
        record = {
            "name": "외부좋은쌀식당",
            "address": "부산 해운대구 해운대로 2",
            "isOzicmeCustomer": False,
            "evidenceUrl": "https://example.com/evidence",
            "evidenceText": "단일품종 쌀 사용",
        }
        payload = json.dumps([record, record], ensure_ascii=False)
        result = register(payload, self.base_csv, self.output, now=self.now)
        self.assertEqual(result["added"], 1)
        self.assertEqual(result["skipped"], 1)


if __name__ == "__main__":
    unittest.main()
