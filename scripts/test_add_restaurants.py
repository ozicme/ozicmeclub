import csv
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.add_restaurants import (
    NAVER_LOCAL_SEARCH_URL,
    NAVER_PLACE_DETAIL_URL,
    RegistrationError,
    fetch_naver_place,
    register,
    search_naver_local,
)


class AddRestaurantsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.base_csv = self.root / "base.csv"
        self.output = self.root / "admin.json"
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
                    "이미지": "https://example.com/existing.jpg",
                    "지역_시도": "서울특별시",
                    "지역_시군구": "강남구",
                    "지역_읍면동": "역삼동",
                    "식당유형_대": "한식",
                    "식당유형_세부": "솥밥",
                    "주요리_대표": "솥밥,제육볶음",
                    "검색태그": "한식,좋은쌀",
                }
            )
        self.output.write_text("[]\n", encoding="utf-8")
        self.now = datetime(2026, 8, 8, tzinfo=timezone.utc)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_adds_full_ozicme_restaurant_for_backward_compatibility(self):
        payload = json.dumps(
            {
                "name": "새식당",
                "address": "서울 마포구 월드컵로 10",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/999999999",
                "registrationType": "ozicme",
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

    def test_minimal_record_is_auto_filled_from_catalog(self):
        payload = json.dumps(
            {
                "name": "기존식당",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/1284913565?placePath=home",
                "registrationType": "ozicme",
            },
            ensure_ascii=False,
        )
        result = register(payload, self.base_csv, self.output, now=self.now)
        self.assertEqual(result["added"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["details"][0]["lookup"], "catalog")
        self.assertEqual(result["details"][0]["address"], "서울 강남구 테헤란로 1")

    def test_minimal_new_record_is_auto_filled_from_naver_api(self):
        payload = json.dumps(
            {
                "name": "새로운식당",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/777777777",
                "imageUrl": "https://example.com/new.jpg",
                "registrationType": "ozicme",
            },
            ensure_ascii=False,
        )

        def fake_lookup(name, client_id, client_secret, submitted_url):
            self.assertEqual((name, client_id, client_secret), ("새로운식당", "id", "secret"))
            self.assertEqual(
                submitted_url,
                "https://map.naver.com/p/entry/place/777777777",
            )
            return {
                "title": "<b>새로운식당</b>",
                "roadAddress": "부산 해운대구 해운대로 2",
                "category": "음식점>한식>솥밥",
                "description": "솥밥 전문점.",
            }

        with patch.dict(
            os.environ,
            {"NAVER_CLIENT_ID": "id", "NAVER_CLIENT_SECRET": "secret"},
        ):
            result = register(
                payload,
                self.base_csv,
                self.output,
                now=self.now,
                naver_lookup=fake_lookup,
            )
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(result["added"], 1)
        self.assertEqual(result["details"][0]["lookup"], "naver-api")
        self.assertEqual(saved[0]["address"], "부산 해운대구 해운대로 2")
        self.assertEqual(saved[0]["category"], "한식")
        self.assertEqual(saved[0]["categoryDetail"], "솥밥")
        self.assertEqual(saved[0]["mainDishes"], ["솥밥"])

    def test_kazkazhan_category_and_supplied_menus_are_preserved(self):
        payload = json.dumps(
            {
                "name": "카즈카잔",
                "naverPlaceUrl": "https://map.naver.com/p/search/카즈카잔",
                "registrationType": "1",
                "mainDishes": ["돈까스", "모듬초밥", "회덮밥"],
            },
            ensure_ascii=False,
        )

        def fake_lookup(*_args):
            return {
                "title": "카즈카잔",
                "roadAddress": "서울특별시 중구 세종대로 17",
                "category": "음식점>일식>일식당",
                "description": "",
            }

        with patch.dict(
            os.environ,
            {"NAVER_CLIENT_ID": "id", "NAVER_CLIENT_SECRET": "secret"},
        ):
            result = register(
                payload,
                self.base_csv,
                self.output,
                now=self.now,
                naver_lookup=fake_lookup,
            )
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(result["added"], 1)
        self.assertEqual(saved[0]["category"], "일식")
        self.assertEqual(saved[0]["categoryDetail"], "일식당")
        self.assertEqual(saved[0]["mainDishes"], ["돈까스", "모듬초밥", "회덮밥"])

    def test_naver_lookup_uses_api_hub_endpoint_and_headers(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return io.BytesIO(
                    json.dumps(
                        {
                            "items": [
                                {
                                    "title": "카즈카잔",
                                    "roadAddress": "서울 마포구 월드컵로 10",
                                    "category": "음식점>아시아음식",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                ).read()

        def fake_urlopen(request, timeout):
            self.assertEqual(timeout, 15)
            self.assertTrue(request.full_url.startswith(f"{NAVER_LOCAL_SEARCH_URL}?"))
            headers = {key.lower(): value for key, value in request.header_items()}
            self.assertEqual(headers["x-ncp-apigw-api-key-id"], "hub-id")
            self.assertEqual(headers["x-ncp-apigw-api-key"], "hub-secret")
            self.assertNotIn("x-naver-client-id", headers)
            return FakeResponse()

        with patch("scripts.add_restaurants.urlopen", side_effect=fake_urlopen):
            item = search_naver_local("카즈카잔", "hub-id", "hub-secret")
        self.assertEqual(item["title"], "카즈카잔")

    def test_exact_place_id_disambiguates_same_name_results(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(
                    {
                        "items": [
                            {
                                "title": "통영바다장어",
                                "roadAddress": "경남 통영시 산양읍 1",
                                "address": "경남 통영시 산양읍 10",
                                "category": "음식점>한식>장어,먹장어요리",
                            },
                            {
                                "title": "통영바다장어",
                                "roadAddress": "경상북도 안동시 강남로 287",
                                "address": "경상북도 안동시 정하동 313-4",
                                "category": "음식점>한식>장어,먹장어요리",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ).encode("utf-8")

        place_detail = {
            "title": "통영바다장어",
            "roadAddress": "경북 안동시 강남로 287 2층, 3층 통영바다장어",
            "address": "경북 안동시 정하동 313-4",
            "category": "장어,먹장어요리",
            "description": "",
            "placeId": "15375170",
            "mainDishes": ["양념구이 (1인분)", "소금구이 (1인분)", "장어국"],
        }
        with patch(
            "scripts.add_restaurants.fetch_naver_place",
            return_value=place_detail,
        ), patch("scripts.add_restaurants.urlopen", return_value=FakeResponse()):
            item = search_naver_local(
                "통영바다장어",
                "hub-id",
                "hub-secret",
                "https://map.naver.com/p/entry/place/15375170",
            )
        self.assertEqual(item["address"], "경북 안동시 정하동 313-4")
        self.assertEqual(item["category"], "음식점>한식>장어,먹장어요리")
        self.assertEqual(item["mainDishes"][0], "양념구이 (1인분)")

    def test_fetch_naver_place_reads_exact_address_and_real_menus(self):
        state = {
            "PlaceDetailBase:15375170": {
                "id": "15375170",
                "name": "통영바다장어",
                "roadAddress": "경북 안동시 강남로 287",
                "address": "경북 안동시 정하동 313-4",
                "category": "장어,먹장어요리",
                "microReviews": ["가성비 최고의 소금구이 세트"],
            },
            "Menu:15375170_0": {
                "id": "15375170_0",
                "name": "양념구이 (1인분)",
            },
            "Menu:15375170_1": {
                "id": "15375170_1",
                "name": "장어국",
            },
        }

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return (
                    "<script>\nwindow.__APOLLO_STATE__ = "
                    + json.dumps(state, ensure_ascii=False)
                    + ";\n</script>"
                ).encode("utf-8")

        def fake_urlopen(request, timeout):
            self.assertEqual(timeout, 20)
            self.assertEqual(
                request.full_url,
                NAVER_PLACE_DETAIL_URL.format(place_id="15375170"),
            )
            return FakeResponse()

        with patch("scripts.add_restaurants.urlopen", side_effect=fake_urlopen):
            item = fetch_naver_place("15375170")
        self.assertEqual(item["title"], "통영바다장어")
        self.assertEqual(item["address"], "경북 안동시 정하동 313-4")
        self.assertEqual(item["mainDishes"], ["양념구이 (1인분)", "장어국"])

    def test_new_minimal_record_requires_naver_secrets(self):
        payload = json.dumps(
            {
                "name": "새로운식당",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/777777777",
                "registrationType": "ozicme",
            },
            ensure_ascii=False,
        )
        with patch.dict(
            os.environ,
            {"NAVER_CLIENT_ID": "", "NAVER_CLIENT_SECRET": ""},
        ):
            with self.assertRaisesRegex(RegistrationError, "NAVER_CLIENT_ID"):
                register(payload, self.base_csv, self.output, now=self.now)

    def test_rejects_non_naver_url(self):
        payload = json.dumps(
            {
                "name": "잘못된링크식당",
                "naverPlaceUrl": "https://example.com/place/123456",
                "registrationType": "ozicme",
            },
            ensure_ascii=False,
        )
        with self.assertRaises(RegistrationError):
            register(payload, self.base_csv, self.output, now=self.now)

    def test_rejects_actual_html_tag_in_submitted_name(self):
        payload = json.dumps(
            {
                "name": "<script>잘못된식당</script>",
                "address": "서울 마포구 월드컵로 10",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/999999999",
                "registrationType": "ozicme",
            },
            ensure_ascii=False,
        )
        with self.assertRaisesRegex(RegistrationError, "HTML 태그"):
            register(payload, self.base_csv, self.output, now=self.now)

    def test_rejects_cut_representative_image_url(self):
        payload = json.dumps(
            {
                "name": "잘린이미지식당",
                "address": "서울 마포구 월드컵로 11",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/999999998",
                "imageUrl": "https://search.pstatic.net/common/?autoRotate=true…thumb.jpg",
                "registrationType": "ozicme",
            },
            ensure_ascii=False,
        )
        with self.assertRaisesRegex(RegistrationError, "잘렸습니다"):
            register(payload, self.base_csv, self.output, now=self.now)

    def test_accepts_external_restaurant_without_evidence(self):
        payload = json.dumps(
            {
                "name": "외부식당",
                "address": "경기 수원시 팔달구 1",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/666666666",
                "registrationType": "external",
            },
            ensure_ascii=False,
        )
        result = register(payload, self.base_csv, self.output, now=self.now)
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(result["added"], 1)
        self.assertFalse(saved[0]["verifiedBadge"])
        self.assertEqual(saved[0]["evidenceUrl"], "")
        self.assertEqual(saved[0]["evidenceText"], "")

    def test_accepts_numeric_external_registration_type(self):
        payload = json.dumps(
            {
                "name": "숫자외부식당",
                "address": "경기 수원시 팔달구 2",
                "naverPlaceUrl": "https://map.naver.com/p/entry/place/666666667",
                "registrationType": "2",
            },
            ensure_ascii=False,
        )
        result = register(payload, self.base_csv, self.output, now=self.now)
        saved = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(result["added"], 1)
        self.assertFalse(saved[0]["verifiedBadge"])

    def test_adds_multiple_and_skips_duplicate_in_batch(self):
        record = {
            "name": "외부좋은쌀식당",
            "address": "부산 해운대구 해운대로 2",
            "naverPlaceUrl": "https://map.naver.com/p/entry/place/555555555",
            "registrationType": "external",
            "evidenceUrl": "https://example.com/evidence",
            "evidenceText": "단일품종 쌀 사용",
        }
        payload = json.dumps([record, record], ensure_ascii=False)
        result = register(payload, self.base_csv, self.output, now=self.now)
        self.assertEqual(result["added"], 1)
        self.assertEqual(result["skipped"], 1)


if __name__ == "__main__":
    unittest.main()
