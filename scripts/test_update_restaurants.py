import csv
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.update_restaurants import (
    UpdateError,
    load_targets,
    target_key,
    update_restaurants,
)


class UpdateRestaurantsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.base_csv = self.root / "base.csv"
        self.admin_data = self.root / "admin.json"
        self.output = self.root / "overrides.json"
        fieldnames = [
            "상호명",
            "대표주소",
            "네이버플레이스",
            "이미지",
            "지역_시도",
            "지역_시군구",
            "지역_읍면동",
            "식당유형_대",
            "식당유형_세부",
            "주요리_대표",
            "검색태그",
        ]
        with self.base_csv.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerow(
                {
                    "상호명": "기존식당",
                    "대표주소": "서울 강남구 테헤란로 1",
                    "네이버플레이스": "https://map.naver.com/p/entry/place/1284913565",
                    "이미지": "https://example.com/old.jpg",
                    "지역_시도": "서울특별시",
                    "지역_시군구": "강남구",
                    "지역_읍면동": "역삼동",
                    "식당유형_대": "한식",
                    "식당유형_세부": "솥밥",
                    "주요리_대표": "솥밥,제육볶음",
                    "검색태그": "한식,좋은쌀",
                }
            )
        self.admin_data.write_text(
            json.dumps(
                [
                    {
                        "id": "admin-123",
                        "name": "관리자추가식당",
                        "address": "부산 해운대구 2",
                        "naverPlaceUrl": "https://map.naver.com/p/entry/place/777777777",
                        "verifiedBadge": True,
                    }
                ],
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.output.write_text("[]\n", encoding="utf-8")
        self.now = datetime(2026, 8, 8, tzinfo=timezone.utc)
        self.base_key = target_key(
            {
                "name": "기존식당",
                "address": "서울 강남구 테헤란로 1",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/1284913565",
            }
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_updates_base_restaurant_without_changing_csv(self):
        before = self.base_csv.read_bytes()
        payload = json.dumps(
            {
                "targetKey": self.base_key,
                "name": "수정식당",
                "address": "서울 강남구 테헤란로 10",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/1284913565",
                "imageUrl": "https://example.com/new.jpg",
                "region": {"sido": "서울특별시", "sigungu": "강남구", "eupmyeondong": "역삼동"},
                "category": "음식점",
                "categoryDetail": "한식 > 솥밥",
                "mainDishes": ["솥밥", "안키모 솥밥 <feat.달고기>"],
                "searchTags": ["한식", "좋은쌀"],
                "registrationType": "ozicme",
            },
            ensure_ascii=False,
        )
        result = update_restaurants(
            payload, self.base_csv, self.admin_data, self.output, now=self.now
        )
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(result["updated"], 1)
        self.assertEqual(saved[0]["name"], "수정식당")
        self.assertEqual(saved[0]["categoryDetail"], "한식 > 솥밥")
        self.assertEqual(saved[0]["mainDishes"][1], "안키모 솥밥 <feat.달고기>")
        self.assertEqual(saved[0]["source"], "base")
        self.assertEqual(before, self.base_csv.read_bytes())

    def test_upserts_existing_override(self):
        base = {
            "targetKey": self.base_key,
            "name": "첫수정",
            "address": "서울 강남구 테헤란로 1",
            "naverPlaceUrl": "https://map.naver.com/p/entry/place/1284913565",
            "region": {"sido": "서울특별시", "sigungu": "강남구", "eupmyeondong": ""},
            "registrationType": "ozicme",
        }
        update_restaurants(
            json.dumps(base, ensure_ascii=False),
            self.base_csv,
            self.admin_data,
            self.output,
            now=self.now,
        )
        base["name"] = "두번째수정"
        result = update_restaurants(
            json.dumps(base, ensure_ascii=False),
            self.base_csv,
            self.admin_data,
            self.output,
            now=self.now,
        )
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(result["totalOverrides"], 1)
        self.assertEqual(saved[0]["name"], "두번째수정")

    def test_updates_admin_added_restaurant_by_id(self):
        payload = {
            "targetKey": "id:admin-123",
            "name": "관리자추가식당 수정",
            "address": "부산 해운대구 20",
            "naverPlaceUrl": "https://map.naver.com/p/entry/place/777777777",
            "region": {"sido": "부산광역시", "sigungu": "해운대구", "eupmyeondong": ""},
            "registrationType": "ozicme",
        }
        update_restaurants(
            json.dumps(payload, ensure_ascii=False),
            self.base_csv,
            self.admin_data,
            self.output,
            now=self.now,
        )
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(saved[0]["source"], "admin")
        self.assertEqual(saved[0]["name"], "관리자추가식당 수정")

    def test_accepts_external_restaurant_without_evidence(self):
        payload = {
            "targetKey": self.base_key,
            "name": "외부식당",
            "address": "서울 강남구 테헤란로 1",
            "naverPlaceUrl": "https://map.naver.com/p/entry/place/1284913565",
            "region": {"sido": "서울특별시", "sigungu": "강남구", "eupmyeondong": ""},
            "registrationType": "external",
        }
        result = update_restaurants(
            json.dumps(payload, ensure_ascii=False),
            self.base_csv,
            self.admin_data,
            self.output,
            now=self.now,
        )
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(result["updated"], 1)
        self.assertFalse(saved[0]["verifiedBadge"])
        self.assertEqual(saved[0]["evidenceUrl"], "")
        self.assertEqual(saved[0]["evidenceText"], "")

    def test_rejects_unknown_target_and_html(self):
        unknown = {
            "targetKey": "place:999999999",
            "name": "없는식당",
            "address": "서울 중구 1",
            "registrationType": "ozicme",
        }
        with self.assertRaisesRegex(UpdateError, "대상을 찾지 못했습니다"):
            update_restaurants(
                json.dumps(unknown, ensure_ascii=False),
                self.base_csv,
                self.admin_data,
                self.output,
                now=self.now,
            )

        malicious = {
            "targetKey": self.base_key,
            "name": "<script>식당</script>",
            "address": "서울 강남구 1",
            "registrationType": "ozicme",
        }
        with self.assertRaisesRegex(UpdateError, "HTML 태그"):
            update_restaurants(
                json.dumps(malicious, ensure_ascii=False),
                self.base_csv,
                self.admin_data,
                self.output,
                now=self.now,
            )

        broken_image = {
            "targetKey": self.base_key,
            "name": "기존식당",
            "address": "서울 강남구 테헤란로 1",
            "imageUrl": "https://search.pstatic.net/common/?autoRotate=true…thumb.jpg",
            "registrationType": "ozicme",
        }
        with self.assertRaisesRegex(UpdateError, "잘렸습니다"):
            update_restaurants(
                json.dumps(broken_image, ensure_ascii=False),
                self.base_csv,
                self.admin_data,
                self.output,
                now=self.now,
            )

    def test_target_key_prefers_admin_id_then_place_id(self):
        self.assertEqual(target_key({"id": "admin-1", "naverPlaceUrl": "https://map.naver.com/p/entry/place/1"}), "id:admin-1")
        self.assertEqual(
            target_key(
                {
                    "name": "기존식당",
                    "address": "서울 강남구 테헤란로 1",
                    "naverPlaceUrl": "https://map.naver.com/p/entry/place/1284913565",
                }
            ),
            "place:1284913565:edef5861",
        )
        self.assertEqual(
            target_key({"name": "URL 없는 식당", "address": "서울 중구 1"}),
            "record:fb0955ba",
        )

    def test_duplicate_targets_receive_stable_occurrence_suffix(self):
        with self.base_csv.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            fieldnames = reader.fieldnames
            duplicate = next(reader)
        with self.base_csv.open("a", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writerow(duplicate)

        targets, _ = load_targets(self.base_csv, self.admin_data, self.output)
        self.assertIn(self.base_key, targets)
        self.assertIn(f"{self.base_key}:duplicate:2", targets)
        self.assertEqual(len(targets), 3)


if __name__ == "__main__":
    unittest.main()
